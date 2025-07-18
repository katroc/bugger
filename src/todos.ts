// Todo management operations for subtasks
import { TokenUsageTracker } from './token-usage-tracker.js';
import sqlite3 from 'sqlite3';

export interface Todo {
  id: string;
  subtaskId: string;
  parentId: string; // Bug #001, FR-001, etc. for easy querying
  description: string;
  completed: boolean;
  dateCreated: string;
  dateCompleted?: string;
  orderIndex: number;
}

export class TodoManager {
  private tokenTracker: TokenUsageTracker;

  constructor() {
    this.tokenTracker = TokenUsageTracker.getInstance();
  }

  /**
   * Initialize todos database table
   */
  async initTodosTable(db: sqlite3.Database): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS todo_items (
          id TEXT PRIMARY KEY,
          subtaskId TEXT NOT NULL,
          parentId TEXT NOT NULL,
          description TEXT NOT NULL,
          completed INTEGER DEFAULT 0,
          dateCreated TEXT NOT NULL,
          dateCompleted TEXT,
          orderIndex INTEGER
        )
      `;

      db.run(createTableQuery, (err) => {
        if (err) {
          reject(new Error(`Failed to create todo_items table: ${err.message}`));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Manage todos with various operations
   */
  async manageTodos(db: sqlite3.Database, args: any): Promise<string> {
    const { operation } = args;

    switch (operation) {
      case 'list':
        return this.listTodos(db, args);
      case 'create':
        return this.createTodo(db, args);
      case 'toggle':
        return this.toggleTodo(db, args);
      case 'update':
        return this.updateTodo(db, args);
      case 'delete':
        return this.deleteTodo(db, args);
      case 'bulk_toggle':
        return this.bulkToggleTodos(db, args);
      case 'get_completion':
        return this.getTodoCompletion(db, args);
      case 'generate_from_task':
        return this.generateTodosFromTask(db, args);
      default:
        throw new Error(`Unknown todo operation: ${operation}`);
    }
  }

  /**
   * List todos for a subtask (auto-generates if none exist)
   */
  async listTodos(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('list_todos');
    
    const { subtaskId, parentId, showCompleted = true } = args;

    if (!subtaskId && !parentId) {
      throw new Error('Either subtaskId or parentId is required');
    }

    try {
      let query = 'SELECT * FROM todo_items WHERE ';
      const params: any[] = [];
      
      if (subtaskId) {
        query += 'subtaskId = ?';
        params.push(subtaskId);
      } else {
        query += 'parentId = ?';
        params.push(parentId);
      }
      
      if (!showCompleted) {
        query += ' AND completed = 0';
      }
      
      query += ' ORDER BY orderIndex ASC';
      
      let todos = await new Promise<Todo[]>((resolve, reject) => {
        db.all(query, params, (err, rows: any[]) => {
          if (err) {
            reject(new Error(`Failed to list todos: ${err.message}`));
          } else {
            const todos = rows.map(row => ({
              ...row,
              completed: row.completed === 1
            }));
            resolve(todos);
          }
        });
      });

      // Auto-generate todos if none exist and we have a specific subtaskId
      if (todos.length === 0 && subtaskId) {
        todos = await this.autoGenerateTodos(db, subtaskId);
      }

      // Format output
      const formattedOutput = this.formatTodosList(todos, subtaskId || parentId);
      
      // Record token usage
      const inputText = JSON.stringify(args);
      const outputText = formattedOutput;
      const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'list_todos');
      
      return `${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`;
    } catch (error) {
      throw new Error(`Failed to list todos: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Create a new todo
   */
  async createTodo(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('create_todo');
    
    const { subtaskId, description } = args;

    if (!subtaskId || !description) {
      throw new Error('subtaskId and description are required');
    }

    try {
      // Get parent ID from subtask
      const parentId = await this.getParentIdFromSubtask(db, subtaskId);
      if (!parentId) {
        throw new Error(`Subtask ${subtaskId} not found`);
      }

      // Generate todo ID and get next order index
      const todoId = await this.generateNextTodoId(db, subtaskId);
      const orderIndex = await this.getNextTodoOrderIndex(db, subtaskId);
      
      const now = new Date().toISOString();
      
      await new Promise<void>((resolve, reject) => {
        const insertQuery = `
          INSERT INTO todo_items (
            id, subtaskId, parentId, description, completed, 
            dateCreated, dateCompleted, orderIndex
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        db.run(insertQuery, [
          todoId,
          subtaskId,
          parentId,
          description,
          0, // completed = false
          now,
          null, // dateCompleted
          orderIndex
        ], function(err) {
          if (err) {
            reject(new Error(`Failed to create todo: ${err.message}`));
          } else {
            resolve();
          }
        });
      });

      // Record token usage
      const inputText = JSON.stringify(args);
      const outputText = `Todo ${todoId} created successfully.`;
      const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'create_todo');
      
      return `${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`;
    } catch (error) {
      throw new Error(`Failed to create todo: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Toggle todo completion status
   */
  async toggleTodo(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('toggle_todo');
    
    const { todoId } = args;

    if (!todoId) {
      throw new Error('todoId is required');
    }

    try {
      // Get current status
      const currentTodo = await new Promise<any>((resolve, reject) => {
        db.get('SELECT * FROM todo_items WHERE id = ?', [todoId], (err, row) => {
          if (err) {
            reject(new Error(`Failed to get todo: ${err.message}`));
          } else if (!row) {
            reject(new Error(`Todo ${todoId} not found`));
          } else {
            resolve(row);
          }
        });
      });

      const newCompleted = currentTodo.completed === 0 ? 1 : 0;
      const dateCompleted = newCompleted === 1 ? new Date().toISOString() : null;

      await new Promise<void>((resolve, reject) => {
        const updateQuery = 'UPDATE todo_items SET completed = ?, dateCompleted = ? WHERE id = ?';
        
        db.run(updateQuery, [newCompleted, dateCompleted, todoId], function(err) {
          if (err) {
            reject(new Error(`Failed to toggle todo: ${err.message}`));
          } else {
            resolve();
          }
        });
      });

      const status = newCompleted === 1 ? 'completed' : 'reopened';
      
      // Record token usage
      const inputText = JSON.stringify(args);
      const outputText = `Todo ${todoId} ${status}.`;
      const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'toggle_todo');
      
      return `${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`;
    } catch (error) {
      throw new Error(`Failed to toggle todo: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update todo description
   */
  async updateTodo(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('update_todo');
    
    const { todoId, description } = args;

    if (!todoId || !description) {
      throw new Error('todoId and description are required');
    }

    try {
      await new Promise<void>((resolve, reject) => {
        db.run('UPDATE todo_items SET description = ? WHERE id = ?', [description, todoId], function(err) {
          if (err) {
            reject(new Error(`Failed to update todo: ${err.message}`));
          } else if (this.changes === 0) {
            reject(new Error(`Todo ${todoId} not found`));
          } else {
            resolve();
          }
        });
      });

      // Record token usage
      const inputText = JSON.stringify(args);
      const outputText = `Todo ${todoId} updated successfully.`;
      const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'update_todo');
      
      return `${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`;
    } catch (error) {
      throw new Error(`Failed to update todo: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete a todo
   */
  async deleteTodo(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('delete_todo');
    
    const { todoId } = args;

    if (!todoId) {
      throw new Error('todoId is required');
    }

    try {
      await new Promise<void>((resolve, reject) => {
        db.run('DELETE FROM todo_items WHERE id = ?', [todoId], function(err) {
          if (err) {
            reject(new Error(`Failed to delete todo: ${err.message}`));
          } else if (this.changes === 0) {
            reject(new Error(`Todo ${todoId} not found`));
          } else {
            resolve();
          }
        });
      });

      // Record token usage
      const inputText = JSON.stringify(args);
      const outputText = `Todo ${todoId} deleted successfully.`;
      const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'delete_todo');
      
      return `${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`;
    } catch (error) {
      throw new Error(`Failed to delete todo: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Bulk toggle multiple todos
   */
  async bulkToggleTodos(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('bulk_toggle_todos');
    
    const { todoIds, completed } = args;

    if (!todoIds || !Array.isArray(todoIds)) {
      throw new Error('todoIds array is required');
    }

    if (completed === undefined) {
      throw new Error('completed status is required');
    }

    try {
      const completedValue = completed ? 1 : 0;
      const dateCompleted = completed ? new Date().toISOString() : null;
      let updatedCount = 0;

      // Begin transaction
      await new Promise<void>((resolve, reject) => {
        db.run('BEGIN TRANSACTION', (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Update each todo
      for (const todoId of todoIds) {
        await new Promise<void>((resolve, reject) => {
          db.run(
            'UPDATE todo_items SET completed = ?, dateCompleted = ? WHERE id = ?',
            [completedValue, dateCompleted, todoId],
            function(err) {
              if (err) {
                reject(err);
              } else {
                updatedCount += this.changes;
                resolve();
              }
            }
          );
        });
      }

      // Commit transaction
      await new Promise<void>((resolve, reject) => {
        db.run('COMMIT', (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const status = completed ? 'completed' : 'reopened';
      
      // Record token usage
      const inputText = JSON.stringify(args);
      const outputText = `${updatedCount} todos ${status} successfully.`;
      const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'bulk_toggle_todos');
      
      return `${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`;
    } catch (error) {
      // Rollback on error
      await new Promise<void>((resolve) => {
        db.run('ROLLBACK', () => resolve());
      });
      
      throw new Error(`Failed to bulk toggle todos: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get todo completion statistics
   */
  async getTodoCompletion(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('get_todo_completion');
    
    const { subtaskId, parentId } = args;

    if (!subtaskId && !parentId) {
      throw new Error('Either subtaskId or parentId is required');
    }

    try {
      let query = `
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN completed = 0 THEN 1 ELSE 0 END) as remaining
        FROM todo_items
        WHERE `;
      
      const params: any[] = [];
      
      if (subtaskId) {
        query += 'subtaskId = ?';
        params.push(subtaskId);
      } else {
        query += 'parentId = ?';
        params.push(parentId);
      }

      const stats = await new Promise<any>((resolve, reject) => {
        db.get(query, params, (err, row) => {
          if (err) {
            reject(new Error(`Failed to get todo completion: ${err.message}`));
          } else {
            resolve(row);
          }
        });
      });

      // Calculate completion percentage
      const completionPercentage = stats.total > 0 
        ? Math.round((stats.completed / stats.total) * 100) 
        : 0;

      // Format output
      const target = subtaskId || parentId;
      const formattedOutput = this.formatCompletionStats(stats, completionPercentage, target);
      
      // Record token usage
      const inputText = JSON.stringify(args);
      const outputText = formattedOutput;
      const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'get_todo_completion');
      
      return `${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`;
    } catch (error) {
      throw new Error(`Failed to get todo completion: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate todos directly from a task (Bug/Feature/Improvement)
   */
  async generateTodosFromTask(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('generate_todos_from_task');
    
    const { parentId, parentType } = args;

    if (!parentId || !parentType) {
      throw new Error('parentId and parentType are required');
    }

    try {
      // Check if todos already exist for this task
      const existingTodos = await this.getExistingTodosForTask(db, parentId);
      if (existingTodos.length > 0) {
        return this.formatTodoList(existingTodos, parentId);
      }

      // Get parent task details
      const parentTask = await this.getParentTaskDetails(db, parentId, parentType);
      if (!parentTask) {
        throw new Error(`Task ${parentId} not found`);
      }

      // Generate todos based on task content
      const generatedTodos = this.generateTodosForTask(parentTask);
      
      // Create todos in database
      const createdTodos: Todo[] = [];
      
      for (let i = 0; i < generatedTodos.length; i++) {
        const todoData = generatedTodos[i];
        const todoId = await this.generateNextTodoIdForTask(db, parentId);
        const now = new Date().toISOString();
        
        const todo: Todo = {
          id: todoId,
          subtaskId: '', // Will be assigned when subtasks are generated
          parentId: parentId,
          description: todoData.description,
          completed: false,
          dateCreated: now,
          orderIndex: i
        };

        // Insert into database
        await new Promise<void>((resolve, reject) => {
          const insertQuery = `
            INSERT INTO todo_items (
              id, subtaskId, parentId, description, completed, 
              dateCreated, dateCompleted, orderIndex
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `;

          db.run(insertQuery, [
            todo.id,
            todo.subtaskId,
            todo.parentId,
            todo.description,
            0, // completed = false
            todo.dateCreated,
            null, // dateCompleted
            todo.orderIndex
          ], function(err) {
            if (err) {
              reject(new Error(`Failed to create todo: ${err.message}`));
            } else {
              resolve();
            }
          });
        });

        createdTodos.push(todo);
      }

      // Format and return the list
      const formattedOutput = this.formatTodoList(createdTodos, parentId);
      
      // Record token usage
      const inputText = JSON.stringify(args);
      const outputText = formattedOutput;
      const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'generate_todos_from_task');
      
      return `${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`;
    } catch (error) {
      throw new Error(`Failed to generate todos from task: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Helper methods

  /**
   * Auto-generate todos for a subtask based on its content
   */
  private async autoGenerateTodos(db: sqlite3.Database, subtaskId: string): Promise<Todo[]> {
    try {
      // Get subtask details
      const subtask = await this.getSubtaskDetails(db, subtaskId);
      if (!subtask) {
        return [];
      }

      // Generate todos based on subtask content
      const generatedTodos = this.generateTodosForSubtask(subtask);
      
      // Create todos in database
      const createdTodos: Todo[] = [];
      
      for (let i = 0; i < generatedTodos.length; i++) {
        const todoData = generatedTodos[i];
        const todoId = await this.generateNextTodoId(db, subtaskId);
        const now = new Date().toISOString();
        
        const todo: Todo = {
          id: todoId,
          subtaskId: subtaskId,
          parentId: subtask.parentId,
          description: todoData.description,
          completed: false,
          dateCreated: now,
          orderIndex: i
        };

        // Insert into database
        await new Promise<void>((resolve, reject) => {
          const insertQuery = `
            INSERT INTO todo_items (
              id, subtaskId, parentId, description, completed, 
              dateCreated, dateCompleted, orderIndex
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `;

          db.run(insertQuery, [
            todo.id,
            todo.subtaskId,
            todo.parentId,
            todo.description,
            0, // completed = false
            todo.dateCreated,
            null, // dateCompleted
            todo.orderIndex
          ], function(err) {
            if (err) {
              reject(new Error(`Failed to create auto-generated todo: ${err.message}`));
            } else {
              resolve();
            }
          });
        });

        createdTodos.push(todo);
      }

      return createdTodos;
    } catch (error) {
      console.error('Error auto-generating todos:', error);
      return [];
    }
  }

  /**
   * Get subtask details from database
   */
  private async getSubtaskDetails(db: sqlite3.Database, subtaskId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM subtasks WHERE id = ?';
      
      db.get(query, [subtaskId], (err, row: any) => {
        if (err) {
          reject(new Error(`Failed to get subtask: ${err.message}`));
        } else {
          resolve(row);
        }
      });
    });
  }

  /**
   * Generate todos based on subtask content and type
   */
  private generateTodosForSubtask(subtask: any): any[] {
    const title = subtask.title || '';
    const description = subtask.description || '';
    const content = `${title} ${description}`.toLowerCase();

    // Common patterns for different types of subtasks
    if (content.includes('investigate') || content.includes('analyze') || content.includes('research')) {
      return [
        { description: 'Review existing code and documentation' },
        { description: 'Identify root cause of the issue' },
        { description: 'Document findings and create reproduction steps' },
        { description: 'Research potential solutions and approaches' }
      ];
    }

    if (content.includes('design') || content.includes('architecture') || content.includes('plan')) {
      return [
        { description: 'Define requirements and constraints' },
        { description: 'Create technical design document' },
        { description: 'Design API interfaces and data models' },
        { description: 'Review design with team and get approval' }
      ];
    }

    if (content.includes('implement') || content.includes('build') || content.includes('create')) {
      return [
        { description: 'Set up development environment and dependencies' },
        { description: 'Implement core functionality' },
        { description: 'Add error handling and validation' },
        { description: 'Perform initial testing and debugging' }
      ];
    }

    if (content.includes('test') || content.includes('verify') || content.includes('validate')) {
      return [
        { description: 'Write unit tests for new functionality' },
        { description: 'Create integration tests' },
        { description: 'Perform manual testing and edge case validation' },
        { description: 'Update test documentation' }
      ];
    }

    if (content.includes('performance') || content.includes('optimize') || content.includes('speed')) {
      return [
        { description: 'Profile current performance and identify bottlenecks' },
        { description: 'Implement performance optimizations' },
        { description: 'Measure and compare performance improvements' },
        { description: 'Document performance gains and best practices' }
      ];
    }

    if (content.includes('ui') || content.includes('component') || content.includes('interface')) {
      return [
        { description: 'Create component structure and basic layout' },
        { description: 'Implement styling and responsive design' },
        { description: 'Add interactive functionality and event handlers' },
        { description: 'Test across different browsers and devices' }
      ];
    }

    if (content.includes('database') || content.includes('storage') || content.includes('data')) {
      return [
        { description: 'Design database schema and relationships' },
        { description: 'Create migration scripts' },
        { description: 'Implement data access layer' },
        { description: 'Test data integrity and performance' }
      ];
    }

    if (content.includes('documentation') || content.includes('guide') || content.includes('manual')) {
      return [
        { description: 'Outline documentation structure and content' },
        { description: 'Write technical documentation' },
        { description: 'Create user guides and examples' },
        { description: 'Review and publish documentation' }
      ];
    }

    // Generic todos for unrecognized patterns
    return [
      { description: 'Break down the task into smaller steps' },
      { description: 'Complete the main implementation' },
      { description: 'Test and validate the results' },
      { description: 'Clean up and finalize the work' }
    ];
  }

  /**
   * Get parent ID from subtask
   */
  private async getParentIdFromSubtask(db: sqlite3.Database, subtaskId: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
      db.get('SELECT parentId FROM subtasks WHERE id = ?', [subtaskId], (err, row: any) => {
        if (err) {
          reject(new Error(`Failed to get parent ID: ${err.message}`));
        } else {
          resolve(row ? row.parentId : null);
        }
      });
    });
  }

  /**
   * Generate next todo ID
   */
  private async generateNextTodoId(db: sqlite3.Database, subtaskId: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const query = 'SELECT COUNT(*) as count FROM todo_items WHERE subtaskId = ?';
      
      db.get(query, [subtaskId], (err, row: any) => {
        if (err) {
          reject(new Error(`Failed to generate todo ID: ${err.message}`));
        } else {
          const nextNum = (row?.count || 0) + 1;
          resolve(`${subtaskId}-T${nextNum.toString().padStart(2, '0')}`);
        }
      });
    });
  }

  /**
   * Get next order index for todos in a subtask
   */
  private async getNextTodoOrderIndex(db: sqlite3.Database, subtaskId: string): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const query = 'SELECT MAX(orderIndex) as maxOrder FROM todo_items WHERE subtaskId = ?';
      
      db.get(query, [subtaskId], (err, row: any) => {
        if (err) {
          reject(new Error(`Failed to get next todo order index: ${err.message}`));
        } else {
          resolve((row?.maxOrder || -1) + 1);
        }
      });
    });
  }

  /**
   * Format todos list for display
   */
  private formatTodosList(todos: Todo[], target: string): string {
    if (todos.length === 0) {
      return `No todos found for ${target}.`;
    }

    let output = `Todos for ${target}:\n\n`;
    
    todos.forEach((todo, index) => {
      const checkbox = todo.completed ? '✅' : '☐';
      output += `${index + 1}. ${checkbox} ${todo.description} [${todo.id}]\n`;
      
      if (todo.completed && todo.dateCompleted) {
        const completedDate = new Date(todo.dateCompleted).toLocaleDateString();
        output += `   Completed: ${completedDate}\n`;
      }
      
      output += '\n';
    });

    return output;
  }

  /**
   * Format completion statistics
   */
  private formatCompletionStats(stats: any, completionPercentage: number, target: string): string {
    let output = `Todo completion for ${target}:\n\n`;
    output += `Progress: ${completionPercentage}% (${stats.completed}/${stats.total})\n\n`;
    output += `Status:\n`;
    output += `- ✅ Completed: ${stats.completed}\n`;
    output += `- ☐ Remaining: ${stats.remaining}\n`;
    
    return output;
  }

  /**
   * Get existing todos for a task
   */
  private async getExistingTodosForTask(db: sqlite3.Database, parentId: string): Promise<Todo[]> {
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM todo_items WHERE parentId = ? ORDER BY orderIndex';
      
      db.all(query, [parentId], (err, rows: any[]) => {
        if (err) {
          reject(new Error(`Failed to get existing todos: ${err.message}`));
        } else {
          const todos: Todo[] = rows.map(row => ({
            id: row.id,
            subtaskId: row.subtaskId,
            parentId: row.parentId,
            description: row.description,
            completed: row.completed === 1,
            dateCreated: row.dateCreated,
            dateCompleted: row.dateCompleted,
            orderIndex: row.orderIndex
          }));
          resolve(todos);
        }
      });
    });
  }

  /**
   * Get parent task details by ID and type
   */
  private async getParentTaskDetails(db: sqlite3.Database, parentId: string, parentType: string): Promise<any> {
    return new Promise((resolve, reject) => {
      let table: string;
      
      switch (parentType) {
        case 'bug':
          table = 'bugs';
          break;
        case 'feature':
          table = 'feature_requests';
          break;
        case 'improvement':
          table = 'improvements';
          break;
        default:
          reject(new Error(`Unknown parent type: ${parentType}`));
          return;
      }

      const query = `SELECT *, '${parentType}' as type FROM ${table} WHERE id = ?`;
      
      db.get(query, [parentId], (err, row: any) => {
        if (err) {
          reject(new Error(`Failed to get parent task: ${err.message}`));
        } else {
          resolve(row);
        }
      });
    });
  }

  /**
   * Generate todos based on task content (direct from task, not subtask)
   */
  private generateTodosForTask(parentTask: any): any[] {
    const title = parentTask.title || '';
    const description = parentTask.description || '';
    const taskType = parentTask.type || '';
    const content = `${title} ${description}`.toLowerCase();

    // Type-specific patterns
    if (taskType === 'bug') {
      return this.generateBugTodos(content);
    } else if (taskType === 'feature') {
      return this.generateFeatureTodos(content);
    } else if (taskType === 'improvement') {
      return this.generateImprovementTodos(content);
    }

    // Generic fallback
    return [
      { description: 'Analyze the requirements and current state' },
      { description: 'Plan the implementation approach' },
      { description: 'Implement the solution' },
      { description: 'Test and validate the implementation' },
      { description: 'Document the changes' }
    ];
  }

  /**
   * Generate bug-specific todos
   */
  private generateBugTodos(content: string): any[] {
    let todos = [];

    // Investigation phase
    todos.push({ description: 'Reproduce the issue and gather details' });
    todos.push({ description: 'Analyze logs and error messages' });
    
    // Root cause analysis
    if (content.includes('performance') || content.includes('slow')) {
      todos.push({ description: 'Profile performance and identify bottlenecks' });
      todos.push({ description: 'Optimize slow queries or operations' });
    } else if (content.includes('database') || content.includes('data')) {
      todos.push({ description: 'Check database integrity and indexes' });
      todos.push({ description: 'Fix data consistency issues' });
    } else if (content.includes('api') || content.includes('endpoint')) {
      todos.push({ description: 'Review API endpoint logic and validation' });
      todos.push({ description: 'Fix API response handling' });
    } else {
      todos.push({ description: 'Identify the root cause of the issue' });
      todos.push({ description: 'Implement the fix' });
    }

    // Testing and validation
    todos.push({ description: 'Write regression tests' });
    todos.push({ description: 'Test the fix in different scenarios' });
    todos.push({ description: 'Verify the fix resolves the original issue' });

    return todos;
  }

  /**
   * Generate feature-specific todos
   */
  private generateFeatureTodos(content: string): any[] {
    let todos = [];

    // Planning phase
    todos.push({ description: 'Define feature requirements and acceptance criteria' });
    todos.push({ description: 'Design the feature architecture and user flow' });
    
    // Implementation phase
    if (content.includes('ui') || content.includes('frontend') || content.includes('interface')) {
      todos.push({ description: 'Design the user interface mockups' });
      todos.push({ description: 'Implement the frontend components' });
      todos.push({ description: 'Add interactive functionality and event handlers' });
    } else if (content.includes('api') || content.includes('backend')) {
      todos.push({ description: 'Design the API endpoints and data models' });
      todos.push({ description: 'Implement the backend logic' });
      todos.push({ description: 'Add input validation and error handling' });
    } else if (content.includes('database') || content.includes('data')) {
      todos.push({ description: 'Design the database schema changes' });
      todos.push({ description: 'Create migration scripts' });
      todos.push({ description: 'Implement data access layer' });
    } else {
      todos.push({ description: 'Implement the core feature functionality' });
      todos.push({ description: 'Add proper error handling and validation' });
    }

    // Testing and integration
    todos.push({ description: 'Write comprehensive tests for the feature' });
    todos.push({ description: 'Integrate with existing systems' });
    todos.push({ description: 'Test edge cases and error scenarios' });
    todos.push({ description: 'Update documentation and user guides' });

    return todos;
  }

  /**
   * Generate improvement-specific todos
   */
  private generateImprovementTodos(content: string): any[] {
    let todos = [];

    // Analysis phase
    todos.push({ description: 'Analyze current implementation and identify pain points' });
    todos.push({ description: 'Research best practices and alternative approaches' });
    
    // Implementation phase
    if (content.includes('performance') || content.includes('optimize')) {
      todos.push({ description: 'Profile current performance metrics' });
      todos.push({ description: 'Implement performance optimizations' });
      todos.push({ description: 'Measure and compare performance improvements' });
    } else if (content.includes('refactor') || content.includes('code')) {
      todos.push({ description: 'Refactor legacy code for better maintainability' });
      todos.push({ description: 'Improve code organization and structure' });
      todos.push({ description: 'Add better documentation and comments' });
    } else if (content.includes('security') || content.includes('vulnerability')) {
      todos.push({ description: 'Identify security vulnerabilities' });
      todos.push({ description: 'Implement security improvements' });
      todos.push({ description: 'Perform security testing and validation' });
    } else {
      todos.push({ description: 'Implement the improvement changes' });
      todos.push({ description: 'Test the improvements' });
    }

    // Validation and documentation
    todos.push({ description: 'Validate that improvements meet the goals' });
    todos.push({ description: 'Update tests and documentation' });
    todos.push({ description: 'Monitor the impact of changes' });

    return todos;
  }

  /**
   * Generate next todo ID for a task
   */
  private async generateNextTodoIdForTask(db: sqlite3.Database, parentId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const query = 'SELECT COUNT(*) as count FROM todo_items WHERE parentId = ?';
      
      db.get(query, [parentId], (err, row: any) => {
        if (err) {
          reject(new Error(`Failed to count todos: ${err.message}`));
        } else {
          const count = row.count + 1;
          const todoId = `${parentId}-T${count.toString().padStart(2, '0')}`;
          resolve(todoId);
        }
      });
    });
  }

  /**
   * Format todo list for display
   */
  private formatTodoList(todos: Todo[], target: string): string {
    if (todos.length === 0) {
      return `No todos found for ${target}.`;
    }

    let output = `Todos for ${target}:\n\n`;
    
    todos.forEach((todo, index) => {
      const checkbox = todo.completed ? '✅' : '☐';
      output += `${index + 1}. ${checkbox} ${todo.description} [${todo.id}]\n`;
      
      if (todo.completed && todo.dateCompleted) {
        const completedDate = new Date(todo.dateCompleted).toLocaleDateString();
        output += `   Completed: ${completedDate}\n`;
      }
      
      output += '\n';
    });

    return output;
  }
}