// Bug management operations
import { formatBugs, formatBulkUpdateResults } from './format.js';
import { TokenUsageTracker } from './token-usage-tracker.js';
import sqlite3 from 'sqlite3';

// Bug interface
export interface Bug {
  id: string;
  status: 'Open' | 'In Progress' | 'Fixed' | 'Closed' | 'Temporarily Resolved';
  priority: 'Low' | 'Medium' | 'High' | 'Critical';
  dateReported: string;
  component: string;
  title: string;
  description: string;
  expectedBehavior: string;
  actualBehavior: string;
  potentialRootCause?: string;
  filesLikelyInvolved?: string[];
  stepsToReproduce?: string[];
  verification?: string[];
  humanVerified?: boolean;
}

export class BugManager {
  private tokenTracker: TokenUsageTracker;

  constructor() {
    this.tokenTracker = TokenUsageTracker.getInstance();
  }

  /**
   * Create a new bug
   */
  async createBug(db: sqlite3.Database, args: any): Promise<string> {
    const startTime = Date.now();
    this.tokenTracker.startOperation('create_bug');
    
    const bug: Bug = {
      id: args.bugId || await this.generateNextId(db, 'bug'),
      status: 'Open',
      priority: args.priority || 'Medium',
      dateReported: new Date().toISOString().split('T')[0],
      component: args.component || 'General',
      title: args.title,
      description: args.description,
      expectedBehavior: args.expectedBehavior,
      actualBehavior: args.actualBehavior,
      potentialRootCause: args.potentialRootCause,
      filesLikelyInvolved: args.filesLikelyInvolved || [],
      stepsToReproduce: args.stepsToReproduce || [],
      verification: [],
      humanVerified: false
    };

    return new Promise((resolve, reject) => {
      const insertQuery = `
        INSERT INTO bugs (
          id, status, priority, dateReported, component, title, description, 
          expectedBehavior, actualBehavior, potentialRootCause, filesLikelyInvolved, 
          stepsToReproduce, verification, humanVerified
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      db.run(insertQuery, [
        bug.id,
        bug.status,
        bug.priority,
        bug.dateReported,
        bug.component,
        bug.title,
        bug.description,
        bug.expectedBehavior,
        bug.actualBehavior,
        bug.potentialRootCause,
        JSON.stringify(bug.filesLikelyInvolved),
        JSON.stringify(bug.stepsToReproduce),
        JSON.stringify(bug.verification),
        bug.humanVerified ? 1 : 0
      ], (err) => {
        if (err) {
          reject(new Error(`Failed to create bug: ${err.message}`));
        } else {
          // Record token usage
          const endTime = Date.now();
          const inputText = JSON.stringify(args);
          const outputText = `Created bug ${bug.id}`;
          const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'create_bug');
          
          resolve(`Bug ${bug.id} created successfully.\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`);
        }
      });
    });
  }

  /**
   * List bugs with filtering options
   */
  async listBugs(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('list_bugs');
    
    let query = 'SELECT * FROM bugs';
    const params: any[] = [];
    const conditions: string[] = [];

    if (args.status) {
      conditions.push('status = ?');
      params.push(args.status);
    }

    if (args.priority) {
      conditions.push('priority = ?');
      params.push(args.priority);
    }

    if (args.component) {
      conditions.push('component = ?');
      params.push(args.component);
    }

    if (args.humanVerified !== undefined) {
      conditions.push('humanVerified = ?');
      params.push(args.humanVerified ? 1 : 0);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY dateReported DESC';

    return new Promise((resolve, reject) => {
      db.all(query, params, (err, rows: any[]) => {
        if (err) {
          reject(new Error(`Failed to list bugs: ${err.message}`));
        } else {
          const bugs = rows.map(row => ({
            ...row,
            filesLikelyInvolved: JSON.parse(row.filesLikelyInvolved || '[]'),
            stepsToReproduce: JSON.parse(row.stepsToReproduce || '[]'),
            verification: JSON.parse(row.verification || '[]'),
            humanVerified: row.humanVerified === 1
          }));

          // Record token usage
          const inputText = JSON.stringify(args);
          const outputText = formatBugs(bugs);
          const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'list_bugs');
          
          resolve(`${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`);
        }
      });
    });
  }

  /**
   * Update bug status
   */
  async updateBugStatus(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('update_bug_status');
    // Added comment to test context change detection
    
    const { itemId, status, humanVerified } = args;

    const validStatuses = ['Open', 'In Progress', 'Fixed', 'Closed', 'Temporarily Resolved'];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}`);
    }

    return new Promise((resolve, reject) => {
      let updateQuery = 'UPDATE bugs SET status = ?';
      const params = [status];

      if (humanVerified !== undefined) {
        updateQuery += ', humanVerified = ?';
        params.push(humanVerified ? 1 : 0);
      }

      updateQuery += ' WHERE id = ?';
      params.push(itemId);

      db.run(updateQuery, params, (err: any, result: any) => {
        if (err) {
          reject(new Error(`Failed to update bug status: ${err.message}`));
        } else if (result && (result as any).changes === 0) {
          reject(new Error(`Bug ${itemId} not found`));
        } else {
          // Record token usage
          const inputText = JSON.stringify(args);
          const outputText = `Updated bug ${itemId} to ${status}`;
          const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'update_bug_status');
          
          resolve(`Bug ${itemId} updated to ${status}.\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`);
        }
      });
    });
  }

  /**
   * Search bugs
   */
  async searchBugs(db: sqlite3.Database, query: string, args: any): Promise<any[]> {
    this.tokenTracker.startOperation('search_bugs');
    
    const searchFields = args.searchFields || ['title', 'description', 'component'];
    const limit = args.limit || 50;
    const offset = args.offset || 0;
    
    let sql = 'SELECT * FROM bugs WHERE ';
    const conditions: string[] = [];
    const params: any[] = [];

    // Add search conditions
    if (query) {
      const searchConditions = searchFields.map((field: string) => `${field} LIKE ?`);
      conditions.push(`(${searchConditions.join(' OR ')})`);
      searchFields.forEach(() => params.push(`%${query}%`));
    }

    // Add filters
    if (args.status) {
      if (Array.isArray(args.status)) {
        conditions.push(`status IN (${args.status.map(() => '?').join(', ')})`);
        params.push(...args.status);
      } else {
        conditions.push('status = ?');
        params.push(args.status);
      }
    }

    if (args.priority) {
      if (Array.isArray(args.priority)) {
        conditions.push(`priority IN (${args.priority.map(() => '?').join(', ')})`);
        params.push(...args.priority);
      } else {
        conditions.push('priority = ?');
        params.push(args.priority);
      }
    }

    if (args.component) {
      conditions.push('component LIKE ?');
      params.push(`%${args.component}%`);
    }

    if (args.humanVerified !== undefined) {
      conditions.push('humanVerified = ?');
      params.push(args.humanVerified ? 1 : 0);
    }

    // Date range filter
    if (args.dateFrom) {
      conditions.push('dateReported >= ?');
      params.push(args.dateFrom);
    }

    if (args.dateTo) {
      conditions.push('dateReported <= ?');
      params.push(args.dateTo);
    }

    if (conditions.length === 0) {
      sql = 'SELECT * FROM bugs';
    } else {
      sql += conditions.join(' AND ');
    }

    // Add sorting
    const sortBy = args.sortBy || 'dateReported';
    const sortOrder = args.sortOrder || 'desc';
    sql += ` ORDER BY ${sortBy} ${sortOrder}`;

    // Add pagination
    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows: any[]) => {
        if (err) {
          reject(new Error(`Failed to search bugs: ${err.message}`));
        } else {
          const bugs = rows.map(row => ({
            ...row,
            type: 'bug',
            filesLikelyInvolved: JSON.parse(row.filesLikelyInvolved || '[]'),
            stepsToReproduce: JSON.parse(row.stepsToReproduce || '[]'),
            verification: JSON.parse(row.verification || '[]'),
            humanVerified: row.humanVerified === 1
          }));

          resolve(bugs);
        }
      });
    });
  }

  /**
   * Bulk update bug status
   */
  async bulkUpdateBugStatus(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('bulk_update_bug_status');
    
    const { updates } = args;
    const results: any[] = [];

    for (const update of updates) {
      try {
        const result = await this.updateBugStatus(db, update);
        results.push({
          status: 'success',
          bugId: update.itemId,
          message: `Updated to ${update.status}`,
          humanVerified: update.humanVerified
        });
      } catch (error) {
        results.push({
          status: 'error',
          bugId: update.itemId,
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Record token usage
    const inputText = JSON.stringify(args);
    const outputText = formatBulkUpdateResults(results, 'bugs');
    const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'bulk_update_bug_status');
    
    return `${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`;
  }

  /**
   * Generate next ID for bug
   */
  private async generateNextId(db: sqlite3.Database, type: 'bug'): Promise<string> {
    return new Promise((resolve, reject) => {
      db.get('SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) as maxId FROM bugs', [], (err, row: any) => {
        if (err) {
          reject(new Error(`Failed to generate ID: ${err.message}`));
        } else {
          const nextNum = (row?.maxId || 0) + 1;
          resolve(`Bug #${nextNum.toString().padStart(3, '0')}`);
        }
      });
    });
  }
}