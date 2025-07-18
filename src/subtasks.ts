// Subtasks management operations
import { TokenUsageTracker } from './token-usage-tracker.js';
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

      return `${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`;
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

      const subtasks = await new Promise<Subtask[]>((resolve, reject) => {
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

      // Format output
      const formattedOutput = this.formatSubtasksList(subtasks, parentId);

      // Record token usage
      const inputText = JSON.stringify(args);
      const outputText = formattedOutput;
      const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'list_subtasks');

      return `${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`;
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

      return `${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`;
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

      return `${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`;
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

      return `${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`;
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

      return `${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`;
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
   * Format subtasks list for display
   */
  private formatSubtasksList(subtasks: Subtask[], parentId: string): string {
    if (subtasks.length === 0) {
      return `No subtasks found for ${parentId}.`;
    }

    let output = `Subtasks for ${parentId}:\n\n`;

    subtasks.forEach((subtask, index) => {
      const statusEmoji = this.getStatusEmoji(subtask.status);
      output += `${index + 1}. ${statusEmoji} ${subtask.title} [${subtask.id}]\n`;
      output += `   Status: ${subtask.status.toUpperCase()}\n`;
      output += `   Priority: ${subtask.priority}\n`;

      if (subtask.assignee) {
        output += `   Assignee: ${subtask.assignee}\n`;
      }

      if (subtask.estimatedHours) {
        output += `   Estimated: ${subtask.estimatedHours} hours\n`;
      }

      if (subtask.actualHours) {
        output += `   Actual: ${subtask.actualHours} hours\n`;
      }

      if (subtask.dependencies && subtask.dependencies.length > 0) {
        output += `   Dependencies: ${subtask.dependencies.join(', ')}\n`;
      }

      output += '\n';
    });

    return output;
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
   * Get emoji for subtask status
   */
  private getStatusEmoji(status: string): string {
    switch (status) {
      case 'todo': return '📋';
      case 'in_progress': return '🔄';
      case 'done': return '✅';
      case 'blocked': return '🚫';
      default: return '❓';
    }
  }
}