// Subtasks management operations
import { TokenUsageTracker } from './token-usage-tracker.js';
import { formatTokenUsage, getStatusFormatter } from './format.js';
import sqlite3 from 'sqlite3';

export interface Subtask {
  id: string;
  parentId: string;
  parentType: 'bug' | 'feature' | 'improvement';
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'done' | 'blocked';
  priority: 'low' | 'medium' | 'high';
  assignee?: string;
  estimatedHours?: number;
  actualHours?: number;
  dependencies?: string[];
  dateCreated: string;
  dateCompleted?: string;
  orderIndex: number;
}

export class SubtaskManager {
  private tokenTracker: TokenUsageTracker;

  constructor() {
    this.tokenTracker = TokenUsageTracker.getInstance();
  }

  /**
   * Initialize subtasks database table
   */
  async initSubtasksTable(db: sqlite3.Database): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS subtasks (
          id TEXT PRIMARY KEY,
          parentId TEXT NOT NULL,
          parentType TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL,
          priority TEXT,
          assignee TEXT,
          estimatedHours REAL,
          actualHours REAL,
          dependencies TEXT,
          dateCreated TEXT NOT NULL,
          dateCompleted TEXT,
          orderIndex INTEGER
        )
      `;

      db.run(createTableQuery, (err) => {
        if (err) {
          reject(new Error(`Failed to create subtasks table: ${err.message}`));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Create a new subtask
   */
  async createSubtask(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('create_subtask');

    const {
      parentId,
      parentType,
      title,
      description,
      status = 'todo',
      priority = 'medium',
      assignee,
      estimatedHours,
      dependencies = []
    } = args;

    // Validate required fields
    if (!parentId || !parentType || !title) {
      throw new Error('parentId, parentType, and title are required');
    }

    // Validate parent type
    if (!['bug', 'feature', 'improvement'].includes(parentType)) {
      throw new Error('parentType must be one of: bug, feature, improvement');
    }

    try {
      // Generate subtask ID
      const subtaskId = await this.generateNextSubtaskId(db, parentId);

      // Get highest order index for this parent
      const orderIndex = await this.getNextOrderIndex(db, parentId);

      // Create subtask
      const now = new Date().toISOString();

      await new Promise<void>((resolve, reject) => {
        const insertQuery = `
          INSERT INTO subtasks (
            id, parentId, parentType, title, description, status, priority,
            assignee, estimatedHours, actualHours, dependencies, 
            dateCreated, dateCompleted, orderIndex
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        db.run(insertQuery, [
          subtaskId,
          parentId,
          parentType,
          title,
          description || '',
          status,
          priority,
          assignee || null,
          estimatedHours || null,
          null, // actualHours starts as null
          JSON.stringify(dependencies),
          now,
          null, // dateCompleted starts as null
          orderIndex
        ], function (err) {
          if (err) {
            reject(new Error(`Failed to create subtask: ${err.message}`));
          } else {
            resolve();
          }
        });
      });

      // Record token usage
      const inputText = JSON.stringify(args);
      const outputText = `Subtask ${subtaskId} created successfully.`;
      const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'create_subtask');

      return `${outputText}${formatTokenUsage(tokenUsage)}`;
    } catch (error) {
      throw new Error(`Failed to create subtask: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * List subtasks for a parent item
   */
  async listSubtasks(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('list_subtasks');

    const { parentId, status } = args;

    if (!parentId) {
      throw new Error('parentId is required');
    }

    try {
      let query = 'SELECT * FROM subtasks WHERE parentId = ?';
      const params: any[] = [parentId];

      if (status) {
        query += ' AND status = ?';
        params.push(status);
      }

      query += ' ORDER BY orderIndex ASC';

      let subtasks = await new Promise<Subtask[]>((resolve, reject) => {
        db.all(query, params, (err, rows: any[]) => {
          if (err) {
            reject(new Error(`Failed to list subtasks: ${err.message}`));
          } else {
            // Parse dependencies JSON
            const subtasks = rows.map(row => ({
              ...row,
              dependencies: row.dependencies ? JSON.parse(row.dependencies) : []
            }));
            resolve(subtasks);
          }
        });
      });

      // Auto-generate subtasks if none exist
      if (subtasks.length === 0) {
        subtasks = await this.autoGenerateSubtasks(db, parentId);
      }

      // Format output
      const formattedOutput = this.formatSubtasksList(subtasks, parentId);

      // Record token usage
      const inputText = JSON.stringify(args);
      const outputText = formattedOutput;
      const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'list_subtasks');

      return `${outputText}${formatTokenUsage(tokenUsage)}`;
    } catch (error) {
      throw new Error(`Failed to list subtasks: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update subtask status
   */
  async updateSubtaskStatus(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('update_subtask_status');

    const { subtaskId, status } = args;

    if (!subtaskId || !status) {
      throw new Error('subtaskId and status are required');
    }

    // Validate status
    if (!['todo', 'in_progress', 'done', 'blocked'].includes(status)) {
      throw new Error('status must be one of: todo, in_progress, done, blocked');
    }

    try {
      let updateQuery = 'UPDATE subtasks SET status = ?';
      const params: any[] = [status];

      // If status is 'done', set dateCompleted
      if (status === 'done') {
        updateQuery += ', dateCompleted = ?';
        params.push(new Date().toISOString());
      } else {
        // If moving from done to another status, clear dateCompleted
        updateQuery += ', dateCompleted = NULL';
      }

      updateQuery += ' WHERE id = ?';
      params.push(subtaskId);

      await new Promise<void>((resolve, reject) => {
        db.run(updateQuery, params, function (err) {
          if (err) {
            reject(new Error(`Failed to update subtask status: ${err.message}`));
          } else if (this.changes === 0) {
            reject(new Error(`Subtask ${subtaskId} not found`));
          } else {
            resolve();
          }
        });
      });

      // Record token usage
      const inputText = JSON.stringify(args);
      const outputText = `Subtask ${subtaskId} status updated to ${status}.`;
      const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'update_subtask_status');

      return `${outputText}${formatTokenUsage(tokenUsage)}`;
    } catch (error) {
      throw new Error(`Failed to update subtask status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get subtask progress statistics
   */
  async getSubtaskProgress(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('get_subtask_progress');

    const { parentId } = args;

    if (!parentId) {
      throw new Error('parentId is required');
    }

    try {
      const stats = await new Promise<any>((resolve, reject) => {
        const query = `
          SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
            SUM(CASE WHEN status = 'todo' THEN 1 ELSE 0 END) as todo,
            SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) as blocked,
            SUM(estimatedHours) as totalEstimatedHours,
            SUM(actualHours) as totalActualHours
          FROM subtasks
          WHERE parentId = ?
        `;

        db.get(query, [parentId], (err, row) => {
          if (err) {
            reject(new Error(`Failed to get subtask progress: ${err.message}`));
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
      const formattedOutput = this.formatProgressStats(stats, completionPercentage, parentId);

      // Record token usage
      const inputText = JSON.stringify(args);
      const outputText = formattedOutput;
      const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'get_subtask_progress');

      return `${outputText}${formatTokenUsage(tokenUsage)}`;
    } catch (error) {
      throw new Error(`Failed to get subtask progress: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Reorder subtasks
   */
  async reorderSubtasks(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('reorder_subtasks');

    const { parentId, subtaskOrder } = args;

    if (!parentId || !subtaskOrder || !Array.isArray(subtaskOrder)) {
      throw new Error('parentId and subtaskOrder array are required');
    }

    try {
      // Begin transaction
      await new Promise<void>((resolve, reject) => {
        db.run('BEGIN TRANSACTION', (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Update each subtask's order
      for (let i = 0; i < subtaskOrder.length; i++) {
        const subtaskId = subtaskOrder[i];
        await new Promise<void>((resolve, reject) => {
          db.run(
            'UPDATE subtasks SET orderIndex = ? WHERE id = ? AND parentId = ?',
            [i, subtaskId, parentId],
            function (err) {
              if (err) {
                reject(err);
              } else if (this.changes === 0) {
                reject(new Error(`Subtask ${subtaskId} not found or doesn't belong to ${parentId}`));
              } else {
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

      // Record token usage
      const inputText = JSON.stringify(args);
      const outputText = `Subtasks for ${parentId} reordered successfully.`;
      const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'reorder_subtasks');

      return `${outputText}${formatTokenUsage(tokenUsage)}`;
    } catch (error) {
      // Rollback on error
      await new Promise<void>((resolve) => {
        db.run('ROLLBACK', () => resolve());
      });

      throw new Error(`Failed to reorder subtasks: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete a subtask
   */
  async deleteSubtask(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('delete_subtask');

    const { subtaskId } = args;

    if (!subtaskId) {
      throw new Error('subtaskId is required');
    }

    try {
      await new Promise<void>((resolve, reject) => {
        db.run('DELETE FROM subtasks WHERE id = ?', [subtaskId], function (err) {
          if (err) {
            reject(new Error(`Failed to delete subtask: ${err.message}`));
          } else if (this.changes === 0) {
            reject(new Error(`Subtask ${subtaskId} not found`));
          } else {
            resolve();
          }
        });
      });

      // Record token usage
      const inputText = JSON.stringify(args);
      const outputText = `Subtask ${subtaskId} deleted successfully.`;
      const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'delete_subtask');

      return `${outputText}${formatTokenUsage(tokenUsage)}`;
    } catch (error) {
      throw new Error(`Failed to delete subtask: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Helper methods

  /**
   * Generate next subtask ID
   */
  private async generateNextSubtaskId(db: sqlite3.Database, parentId: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const query = 'SELECT COUNT(*) as count FROM subtasks WHERE parentId = ?';

      db.get(query, [parentId], (err, row: any) => {
        if (err) {
          reject(new Error(`Failed to generate subtask ID: ${err.message}`));
        } else {
          const nextNum = (row?.count || 0) + 1;
          resolve(`${parentId}-${nextNum.toString().padStart(2, '0')}`);
        }
      });
    });
  }

  /**
   * Get next order index for a parent
   */
  private async getNextOrderIndex(db: sqlite3.Database, parentId: string): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const query = 'SELECT MAX(orderIndex) as maxOrder FROM subtasks WHERE parentId = ?';

      db.get(query, [parentId], (err, row: any) => {
        if (err) {
          reject(new Error(`Failed to get next order index: ${err.message}`));
        } else {
          resolve((row?.maxOrder || -1) + 1);
        }
      });
    });
  }


  /**
   * Format progress statistics
   */
  private formatProgressStats(stats: any, completionPercentage: number, parentId: string): string {
    let output = `Progress for ${parentId}:\n\n`;
    output += `Completion: ${completionPercentage}% (${stats.completed}/${stats.total})\n\n`;
    output += `Status Breakdown:\n`;
    output += `- ✅ Done: ${stats.completed}\n`;
    output += `- 🔄 In Progress: ${stats.in_progress}\n`;
    output += `- 📋 Todo: ${stats.todo}\n`;
    output += `- 🚫 Blocked: ${stats.blocked}\n\n`;

    if (stats.totalEstimatedHours) {
      output += `Time Tracking:\n`;
      output += `- Estimated: ${stats.totalEstimatedHours || 0} hours\n`;
      output += `- Actual: ${stats.totalActualHours || 0} hours\n`;

      const timeVariance = stats.totalActualHours && stats.totalEstimatedHours
        ? stats.totalActualHours - stats.totalEstimatedHours
        : 0;

      if (timeVariance > 0) {
        output += `- Variance: +${timeVariance} hours (over estimate)\n`;
      } else if (timeVariance < 0) {
        output += `- Variance: ${timeVariance} hours (under estimate)\n`;
      } else {
        output += `- Variance: 0 hours (on target)\n`;
      }
    }

    return output;
  }

  /**
   * Auto-generate subtasks based on parent task and contexts
   */
  async autoGenerateSubtasks(db: sqlite3.Database, parentId: string, parentType?: string, taskData?: any): Promise<Subtask[]> {
    try {
      // Get parent task details
      const parentTask = await this.getParentTaskDetails(db, parentId);
      if (!parentTask) {
        return []; // No parent task found, return empty array
      }

      // Generate subtasks based on task type and description
      const generatedSubtasks = this.generateSubtasksForTaskType(parentTask);
      
      // Create subtasks in database
      const createdSubtasks: Subtask[] = [];
      
      for (let i = 0; i < generatedSubtasks.length; i++) {
        const subtaskData = generatedSubtasks[i];
        const subtaskId = await this.generateNextSubtaskId(db, parentId);
        const now = new Date().toISOString();
        
        const subtask: Subtask = {
          id: subtaskId,
          parentId: parentId,
          parentType: parentTask.type,
          title: subtaskData.title,
          description: subtaskData.description,
          status: 'todo',
          priority: subtaskData.priority,
          estimatedHours: subtaskData.estimatedHours,
          dependencies: [],
          dateCreated: now,
          orderIndex: i
        };

        // Insert into database
        await new Promise<void>((resolve, reject) => {
          const insertQuery = `
            INSERT INTO subtasks (
              id, parentId, parentType, title, description, status, priority,
              assignee, estimatedHours, actualHours, dependencies, 
              dateCreated, dateCompleted, orderIndex
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;

          db.run(insertQuery, [
            subtask.id,
            subtask.parentId,
            subtask.parentType,
            subtask.title,
            subtask.description,
            subtask.status,
            subtask.priority,
            null, // assignee
            subtask.estimatedHours,
            null, // actualHours
            JSON.stringify(subtask.dependencies),
            subtask.dateCreated,
            null, // dateCompleted
            subtask.orderIndex
          ], function(err) {
            if (err) {
              reject(new Error(`Failed to create auto-generated subtask: ${err.message}`));
            } else {
              resolve();
            }
          });
        });

        createdSubtasks.push(subtask);
      }

      return createdSubtasks;
    } catch (error) {
      console.error('Error auto-generating subtasks:', error);
      return []; // Return empty array on error, don't fail the whole operation
    }
  }

  /**
   * Get parent task details from database
   */
  private async getParentTaskDetails(db: sqlite3.Database, parentId: string): Promise<any> {
    // Determine table based on parentId prefix
    let tableName: string;
    let type: string;
    
    if (parentId.startsWith('Bug')) {
      tableName = 'bugs';
      type = 'bug';
    } else if (parentId.startsWith('FR-')) {
      tableName = 'feature_requests';
      type = 'feature';
    } else if (parentId.startsWith('IMP-')) {
      tableName = 'improvements';
      type = 'improvement';
    } else {
      return null;
    }

    return new Promise((resolve, reject) => {
      const query = `SELECT * FROM ${tableName} WHERE id = ?`;
      
      db.get(query, [parentId], (err, row: any) => {
        if (err) {
          reject(new Error(`Failed to get parent task: ${err.message}`));
        } else {
          resolve(row ? { ...row, type } : null);
        }
      });
    });
  }

  /**
   * Generate subtasks based on task type and content
   */
  private generateSubtasksForTaskType(parentTask: any): any[] {
    const taskType = parentTask.type;
    const title = parentTask.title || '';
    const description = parentTask.description || '';
    
    // Combine title and description for analysis
    const content = `${title} ${description}`.toLowerCase();

    switch (taskType) {
      case 'bug':
        return this.generateBugSubtasks(content, parentTask);
      case 'feature':
        return this.generateFeatureSubtasks(content, parentTask);
      case 'improvement':
        return this.generateImprovementSubtasks(content, parentTask);
      default:
        return this.generateGenericSubtasks(content, parentTask);
    }
  }

  /**
   * Generate subtasks for bug fixes
   */
  private generateBugSubtasks(content: string, parentTask: any): any[] {
    const subtasks = [];

    // Always start with investigation
    subtasks.push({
      title: 'Investigate and reproduce the issue',
      description: 'Analyze the problem, understand the root cause, and create reliable reproduction steps',
      priority: 'high',
      estimatedHours: 1.5
    });

    // Code analysis based on content
    if (content.includes('performance') || content.includes('slow') || content.includes('timeout')) {
      subtasks.push({
        title: 'Profile and identify performance bottlenecks',
        description: 'Use profiling tools to identify the specific performance issues and measure current metrics',
        priority: 'high',
        estimatedHours: 2
      });
    }

    if (content.includes('database') || content.includes('query') || content.includes('sql')) {
      subtasks.push({
        title: 'Optimize database operations',
        description: 'Review and optimize database queries, indexes, and transaction handling',
        priority: 'high',
        estimatedHours: 3
      });
    }

    if (content.includes('api') || content.includes('endpoint') || content.includes('request')) {
      subtasks.push({
        title: 'Fix API endpoint logic',
        description: 'Update the API endpoint to handle the identified issues correctly',
        priority: 'high',
        estimatedHours: 2.5
      });
    }

    // Always include implementation and testing
    subtasks.push({
      title: 'Implement the fix',
      description: 'Apply the necessary code changes to resolve the identified issue',
      priority: 'high',
      estimatedHours: 2
    });

    subtasks.push({
      title: 'Write tests and verify fix',
      description: 'Create tests to prevent regression and verify the fix works as expected',
      priority: 'medium',
      estimatedHours: 1.5
    });

    return subtasks;
  }

  /**
   * Generate subtasks for new features
   */
  private generateFeatureSubtasks(content: string, parentTask: any): any[] {
    const subtasks = [];

    // Design phase
    subtasks.push({
      title: 'Design feature architecture and API',
      description: 'Plan the technical approach, API design, and integration points',
      priority: 'high',
      estimatedHours: 2
    });

    // UI/Frontend work
    if (content.includes('ui') || content.includes('interface') || content.includes('component') || content.includes('theme')) {
      subtasks.push({
        title: 'Create UI components and styling',
        description: 'Build the user interface components and implement the visual design',
        priority: 'high',
        estimatedHours: 3
      });
    }

    // Backend/API work
    if (content.includes('api') || content.includes('backend') || content.includes('database') || content.includes('server')) {
      subtasks.push({
        title: 'Implement backend logic and API endpoints',
        description: 'Create the server-side functionality and API endpoints for the feature',
        priority: 'high',
        estimatedHours: 3.5
      });
    }

    // Data/Storage
    if (content.includes('data') || content.includes('storage') || content.includes('database') || content.includes('persist')) {
      subtasks.push({
        title: 'Set up data storage and persistence',
        description: 'Implement data models, database schema changes, and persistence logic',
        priority: 'medium',
        estimatedHours: 2
      });
    }

    // Integration and testing
    subtasks.push({
      title: 'Integrate components and test functionality',
      description: 'Connect all parts of the feature and perform comprehensive testing',
      priority: 'medium',
      estimatedHours: 2.5
    });

    subtasks.push({
      title: 'Write documentation and user guides',
      description: 'Create technical documentation and user-facing guides for the new feature',
      priority: 'low',
      estimatedHours: 1
    });

    return subtasks;
  }

  /**
   * Generate subtasks for improvements
   */
  private generateImprovementSubtasks(content: string, parentTask: any): any[] {
    const subtasks = [];

    // Analysis phase
    subtasks.push({
      title: 'Analyze current implementation',
      description: 'Review the existing code and identify specific areas for improvement',
      priority: 'high',
      estimatedHours: 1.5
    });

    // Specific improvement types
    if (content.includes('performance') || content.includes('optimize') || content.includes('speed')) {
      subtasks.push({
        title: 'Implement performance optimizations',
        description: 'Apply performance improvements and optimize critical code paths',
        priority: 'high',
        estimatedHours: 3
      });
    }

    if (content.includes('refactor') || content.includes('clean') || content.includes('structure')) {
      subtasks.push({
        title: 'Refactor and clean up code',
        description: 'Improve code structure, readability, and maintainability',
        priority: 'medium',
        estimatedHours: 2.5
      });
    }

    if (content.includes('security') || content.includes('vulnerability') || content.includes('auth')) {
      subtasks.push({
        title: 'Enhance security measures',
        description: 'Implement security improvements and address potential vulnerabilities',
        priority: 'high',
        estimatedHours: 2
      });
    }

    if (content.includes('test') || content.includes('coverage') || content.includes('quality')) {
      subtasks.push({
        title: 'Improve test coverage and quality',
        description: 'Add missing tests and improve overall test quality and coverage',
        priority: 'medium',
        estimatedHours: 2
      });
    }

    // Validation and documentation
    subtasks.push({
      title: 'Validate improvements and measure impact',
      description: 'Test the improvements and measure their impact on the system',
      priority: 'medium',
      estimatedHours: 1.5
    });

    return subtasks;
  }

  /**
   * Generate generic subtasks for unknown types
   */
  private generateGenericSubtasks(content: string, parentTask: any): any[] {
    return [
      {
        title: 'Plan and analyze requirements',
        description: 'Break down the task requirements and plan the implementation approach',
        priority: 'high',
        estimatedHours: 1
      },
      {
        title: 'Implement core functionality',
        description: 'Build the main functionality required for this task',
        priority: 'high',
        estimatedHours: 3
      },
      {
        title: 'Test and validate implementation',
        description: 'Test the implementation and ensure it meets the requirements',
        priority: 'medium',
        estimatedHours: 1.5
      }
    ];
  }

  /**
   * Generate subtasks by grouping existing todos
   */
  async generateSubtasksFromTodos(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('generate_subtasks_from_todos');
    
    const { parentId, parentType } = args;

    if (!parentId || !parentType) {
      throw new Error('parentId and parentType are required');
    }

    try {
      // Check if subtasks already exist for this task
      const existingSubtasks = await this.getExistingSubtasks(db, parentId);
      if (existingSubtasks.length > 0) {
        return this.formatSubtasksList(existingSubtasks, parentId);
      }

      // Get existing todos for this task
      const todos = await this.getTodosForTask(db, parentId);
      if (todos.length === 0) {
        throw new Error(`No todos found for task ${parentId}. Generate todos first.`);
      }

      // Group todos into logical subtasks
      const subtaskGroups = this.groupTodosIntoSubtasks(todos, parentType);
      
      // Create subtasks in database
      const createdSubtasks: Subtask[] = [];
      
      for (let i = 0; i < subtaskGroups.length; i++) {
        const group = subtaskGroups[i];
        const subtaskId = await this.generateNextSubtaskId(db, parentId);
        const now = new Date().toISOString();
        
        const subtask: Subtask = {
          id: subtaskId,
          parentId: parentId,
          parentType: parentType as 'bug' | 'feature' | 'improvement',
          title: group.title,
          description: group.description,
          status: 'todo',
          priority: group.priority,
          estimatedHours: group.estimatedHours,
          dependencies: [],
          dateCreated: now,
          orderIndex: i
        };

        // Insert subtask into database
        await new Promise<void>((resolve, reject) => {
          const insertQuery = `
            INSERT INTO subtasks (
              id, parentId, parentType, title, description, status, priority,
              assignee, estimatedHours, actualHours, dependencies, 
              dateCreated, dateCompleted, orderIndex
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;

          db.run(insertQuery, [
            subtask.id,
            subtask.parentId,
            subtask.parentType,
            subtask.title,
            subtask.description,
            subtask.status,
            subtask.priority,
            null, // assignee
            subtask.estimatedHours,
            null, // actualHours
            JSON.stringify(subtask.dependencies || []),
            subtask.dateCreated,
            null, // dateCompleted
            subtask.orderIndex
          ], function(err) {
            if (err) {
              reject(new Error(`Failed to create subtask: ${err.message}`));
            } else {
              resolve();
            }
          });
        });

        // Update todos to assign them to this subtask
        await this.assignTodosToSubtask(db, group.todoIds, subtaskId);

        createdSubtasks.push(subtask);
      }

      // Format and return the list
      const formattedOutput = this.formatSubtasksList(createdSubtasks, parentId);
      
      // Record token usage
      const inputText = JSON.stringify(args);
      const outputText = formattedOutput;
      const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'generate_subtasks_from_todos');
      
      return `${outputText}${formatTokenUsage(tokenUsage)}`;
    } catch (error) {
      throw new Error(`Failed to generate subtasks from todos: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get existing subtasks for a task
   */
  private async getExistingSubtasks(db: sqlite3.Database, parentId: string): Promise<Subtask[]> {
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM subtasks WHERE parentId = ? ORDER BY orderIndex';
      
      db.all(query, [parentId], (err, rows: any[]) => {
        if (err) {
          reject(new Error(`Failed to get existing subtasks: ${err.message}`));
        } else {
          const subtasks: Subtask[] = rows.map(row => ({
            id: row.id,
            parentId: row.parentId,
            parentType: row.parentType,
            title: row.title,
            description: row.description,
            status: row.status,
            priority: row.priority,
            assignee: row.assignee,
            estimatedHours: row.estimatedHours,
            actualHours: row.actualHours,
            dependencies: row.dependencies ? JSON.parse(row.dependencies) : [],
            dateCreated: row.dateCreated,
            dateCompleted: row.dateCompleted,
            orderIndex: row.orderIndex
          }));
          resolve(subtasks);
        }
      });
    });
  }

  /**
   * Get todos for a task
   */
  private async getTodosForTask(db: sqlite3.Database, parentId: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM todo_items WHERE parentId = ? ORDER BY orderIndex';
      
      db.all(query, [parentId], (err, rows: any[]) => {
        if (err) {
          reject(new Error(`Failed to get todos: ${err.message}`));
        } else {
          resolve(rows);
        }
      });
    });
  }

  /**
   * Group todos into logical subtasks
   */
  private groupTodosIntoSubtasks(todos: any[], parentType: string): any[] {
    const groups: any[] = [];
    
    if (parentType === 'bug') {
      // Group bug todos into: Investigation, Implementation, Testing
      const investigationTodos = todos.filter(todo => 
        todo.description.toLowerCase().includes('reproduce') ||
        todo.description.toLowerCase().includes('analyze') ||
        todo.description.toLowerCase().includes('gather') ||
        todo.description.toLowerCase().includes('logs')
      );
      
      const implementationTodos = todos.filter(todo => 
        todo.description.toLowerCase().includes('fix') ||
        todo.description.toLowerCase().includes('implement') ||
        todo.description.toLowerCase().includes('optimize') ||
        todo.description.toLowerCase().includes('profile')
      );
      
      const testingTodos = todos.filter(todo => 
        todo.description.toLowerCase().includes('test') ||
        todo.description.toLowerCase().includes('verify') ||
        todo.description.toLowerCase().includes('validate')
      );
      
      const remainingTodos = todos.filter(todo => 
        !investigationTodos.includes(todo) && 
        !implementationTodos.includes(todo) && 
        !testingTodos.includes(todo)
      );

      if (investigationTodos.length > 0) {
        groups.push({
          title: 'Investigation and Analysis',
          description: 'Investigate the issue and identify root causes',
          priority: 'high',
          estimatedHours: investigationTodos.length * 0.5,
          todoIds: investigationTodos.map(t => t.id)
        });
      }

      if (implementationTodos.length > 0) {
        groups.push({
          title: 'Implementation and Fix',
          description: 'Implement the solution and fix the issue',
          priority: 'high',
          estimatedHours: implementationTodos.length * 1.0,
          todoIds: implementationTodos.map(t => t.id)
        });
      }

      if (testingTodos.length > 0) {
        groups.push({
          title: 'Testing and Validation',
          description: 'Test the fix and validate the solution',
          priority: 'medium',
          estimatedHours: testingTodos.length * 0.5,
          todoIds: testingTodos.map(t => t.id)
        });
      }

      if (remainingTodos.length > 0) {
        groups.push({
          title: 'Additional Tasks',
          description: 'Other related tasks',
          priority: 'medium',
          estimatedHours: remainingTodos.length * 0.5,
          todoIds: remainingTodos.map(t => t.id)
        });
      }
    } else if (parentType === 'feature') {
      // Group feature todos into: Planning, Frontend, Backend, Testing
      const planningTodos = todos.filter(todo => 
        todo.description.toLowerCase().includes('define') ||
        todo.description.toLowerCase().includes('design') ||
        todo.description.toLowerCase().includes('plan') ||
        todo.description.toLowerCase().includes('requirements')
      );
      
      const frontendTodos = todos.filter(todo => 
        todo.description.toLowerCase().includes('ui') ||
        todo.description.toLowerCase().includes('frontend') ||
        todo.description.toLowerCase().includes('interface') ||
        todo.description.toLowerCase().includes('mockup')
      );
      
      const backendTodos = todos.filter(todo => 
        todo.description.toLowerCase().includes('api') ||
        todo.description.toLowerCase().includes('backend') ||
        todo.description.toLowerCase().includes('database') ||
        todo.description.toLowerCase().includes('server')
      );
      
      const testingTodos = todos.filter(todo => 
        todo.description.toLowerCase().includes('test') ||
        todo.description.toLowerCase().includes('integration') ||
        todo.description.toLowerCase().includes('documentation')
      );
      
      const remainingTodos = todos.filter(todo => 
        !planningTodos.includes(todo) && 
        !frontendTodos.includes(todo) && 
        !backendTodos.includes(todo) && 
        !testingTodos.includes(todo)
      );

      if (planningTodos.length > 0) {
        groups.push({
          title: 'Planning and Design',
          description: 'Plan the feature and design the architecture',
          priority: 'high',
          estimatedHours: planningTodos.length * 1.0,
          todoIds: planningTodos.map(t => t.id)
        });
      }

      if (frontendTodos.length > 0) {
        groups.push({
          title: 'Frontend Implementation',
          description: 'Implement the user interface and frontend components',
          priority: 'high',
          estimatedHours: frontendTodos.length * 1.5,
          todoIds: frontendTodos.map(t => t.id)
        });
      }

      if (backendTodos.length > 0) {
        groups.push({
          title: 'Backend Implementation',
          description: 'Implement the backend logic and data layer',
          priority: 'high',
          estimatedHours: backendTodos.length * 1.5,
          todoIds: backendTodos.map(t => t.id)
        });
      }

      if (testingTodos.length > 0) {
        groups.push({
          title: 'Testing and Documentation',
          description: 'Test the feature and update documentation',
          priority: 'medium',
          estimatedHours: testingTodos.length * 0.75,
          todoIds: testingTodos.map(t => t.id)
        });
      }

      if (remainingTodos.length > 0) {
        groups.push({
          title: 'Additional Tasks',
          description: 'Other feature-related tasks',
          priority: 'medium',
          estimatedHours: remainingTodos.length * 0.75,
          todoIds: remainingTodos.map(t => t.id)
        });
      }
    } else if (parentType === 'improvement') {
      // Group improvement todos into: Analysis, Implementation, Validation
      const analysisTodos = todos.filter(todo => 
        todo.description.toLowerCase().includes('analyze') ||
        todo.description.toLowerCase().includes('research') ||
        todo.description.toLowerCase().includes('identify') ||
        todo.description.toLowerCase().includes('profile')
      );
      
      const implementationTodos = todos.filter(todo => 
        todo.description.toLowerCase().includes('implement') ||
        todo.description.toLowerCase().includes('refactor') ||
        todo.description.toLowerCase().includes('optimize') ||
        todo.description.toLowerCase().includes('improve')
      );
      
      const validationTodos = todos.filter(todo => 
        todo.description.toLowerCase().includes('test') ||
        todo.description.toLowerCase().includes('validate') ||
        todo.description.toLowerCase().includes('measure') ||
        todo.description.toLowerCase().includes('monitor')
      );
      
      const remainingTodos = todos.filter(todo => 
        !analysisTodos.includes(todo) && 
        !implementationTodos.includes(todo) && 
        !validationTodos.includes(todo)
      );

      if (analysisTodos.length > 0) {
        groups.push({
          title: 'Analysis and Research',
          description: 'Analyze current state and research improvements',
          priority: 'high',
          estimatedHours: analysisTodos.length * 1.0,
          todoIds: analysisTodos.map(t => t.id)
        });
      }

      if (implementationTodos.length > 0) {
        groups.push({
          title: 'Implementation',
          description: 'Implement the improvements',
          priority: 'high',
          estimatedHours: implementationTodos.length * 1.5,
          todoIds: implementationTodos.map(t => t.id)
        });
      }

      if (validationTodos.length > 0) {
        groups.push({
          title: 'Validation and Testing',
          description: 'Validate improvements and test changes',
          priority: 'medium',
          estimatedHours: validationTodos.length * 0.75,
          todoIds: validationTodos.map(t => t.id)
        });
      }

      if (remainingTodos.length > 0) {
        groups.push({
          title: 'Additional Tasks',
          description: 'Other improvement-related tasks',
          priority: 'medium',
          estimatedHours: remainingTodos.length * 0.5,
          todoIds: remainingTodos.map(t => t.id)
        });
      }
    }

    return groups;
  }

  /**
   * Assign todos to a subtask
   */
  private async assignTodosToSubtask(db: sqlite3.Database, todoIds: string[], subtaskId: string): Promise<void> {
    for (const todoId of todoIds) {
      await new Promise<void>((resolve, reject) => {
        db.run('UPDATE todo_items SET subtaskId = ? WHERE id = ?', [subtaskId, todoId], function(err) {
          if (err) {
            reject(new Error(`Failed to assign todo to subtask: ${err.message}`));
          } else {
            resolve();
          }
        });
      });
    }
  }

  /**
   * Format subtasks list for display
   */
  private formatSubtasksList(subtasks: Subtask[], parentId: string): string {
    if (subtasks.length === 0) {
      return `No subtasks found for ${parentId}.`;
    }

    let output = `Subtasks for ${parentId}:\n\n`;
    
    subtasks.forEach((subtask, index) => {
      const statusFormatter = getStatusFormatter();
      const formattedStatus = statusFormatter(subtask.status);
      const priority = subtask.priority?.toUpperCase() || 'MEDIUM';
      const hours = subtask.estimatedHours ? `${subtask.estimatedHours}h` : 'TBD';
      
      output += `${index + 1}. ${formattedStatus} ${subtask.title} [${subtask.id}]\n`;
      output += `   Status: ${subtask.status.toUpperCase()}\n`;
      output += `   Priority: ${priority}\n`;
      output += `   Estimated: ${hours}\n`;
      
      if (subtask.description) {
        output += `   Description: ${subtask.description}\n`;
      }
      
      output += '\n';
    });

    return output;
  }

}