// Feature request management operations
import { formatFeatureRequests, formatBulkUpdateResults, formatTokenUsage } from './format.js';
import { TokenUsageTracker } from './token-usage-tracker.js';
import { SubtaskManager } from './subtasks.js';
import { TodoManager } from './todos.js';
import sqlite3 from 'sqlite3';

// Feature request interface
export interface FeatureRequest {
  id: string;
  status: 'Proposed' | 'In Discussion' | 'Approved' | 'In Development' | 'Research Phase' | 'Partially Implemented' | 'Completed' | 'Rejected';
  priority: 'Low' | 'Medium' | 'High' | 'Critical';
  dateRequested: string;
  category: string;
  requestedBy?: string;
  title: string;
  description: string;
  userStory: string;
  currentBehavior: string;
  expectedBehavior: string;
  acceptanceCriteria: string[];
  potentialImplementation?: string;
  dependencies?: string[];
  effortEstimate?: 'Small' | 'Medium' | 'Large' | 'XL';
}

export class FeatureManager {
  private tokenTracker: TokenUsageTracker;

  constructor() {
    this.tokenTracker = TokenUsageTracker.getInstance();
  }

  /**
   * Create a new feature request
   */
  async createFeatureRequest(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('create_feature_request');
    
    const feature: FeatureRequest = {
      id: args.featureId || await this.generateNextId(db, 'feature'),
      status: 'Proposed',
      priority: args.priority || 'Medium',
      dateRequested: new Date().toISOString().split('T')[0],
      category: args.category || 'General',
      requestedBy: args.requestedBy,
      title: args.title,
      description: args.description,
      userStory: args.userStory,
      currentBehavior: args.currentBehavior,
      expectedBehavior: args.expectedBehavior,
      acceptanceCriteria: args.acceptanceCriteria || [],
      potentialImplementation: args.potentialImplementation,
      dependencies: args.dependencies || [],
      effortEstimate: args.effortEstimate
    };

    return new Promise((resolve, reject) => {
      const insertQuery = `
        INSERT INTO feature_requests (
          id, status, priority, dateRequested, category, requestedBy, title, description, 
          userStory, currentBehavior, expectedBehavior, acceptanceCriteria, 
          potentialImplementation, dependencies, effortEstimate
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      db.run(insertQuery, [
        feature.id,
        feature.status,
        feature.priority,
        feature.dateRequested,
        feature.category,
        feature.requestedBy,
        feature.title,
        feature.description,
        feature.userStory,
        feature.currentBehavior,
        feature.expectedBehavior,
        JSON.stringify(feature.acceptanceCriteria),
        feature.potentialImplementation,
        JSON.stringify(feature.dependencies),
        feature.effortEstimate
      ], async (err) => {
        if (err) {
          reject(new Error(`Failed to create feature request: ${err.message}`));
        } else {
          try {
            // Auto-generate subtasks and todos immediately after feature creation
            const subtaskManager = new SubtaskManager();
            const todoManager = new TodoManager();
            
            // Generate subtasks for the new feature
            await subtaskManager.autoGenerateSubtasks(db, feature.id, 'feature', {
              title: feature.title,
              description: feature.description,
              userStory: feature.userStory,
              currentBehavior: feature.currentBehavior,
              expectedBehavior: feature.expectedBehavior,
              acceptanceCriteria: feature.acceptanceCriteria,
              potentialImplementation: feature.potentialImplementation
            });
            
            // Get the generated subtasks to create todos for each
            const subtasks = await this.getSubtasksForFeature(db, feature.id);
            
            // Generate todos for each subtask
            for (const subtask of subtasks) {
              await todoManager.autoGenerateTodos(db, subtask.id, feature.id, 'feature', {
                title: subtask.title,
                description: subtask.description
              });
            }
            
            // Record token usage
            const inputText = JSON.stringify(args);
            const outputText = `Created feature request ${feature.id} with ${subtasks.length} subtasks and associated todos`;
            const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'create_feature_request');
            
            resolve(`Feature request ${feature.id} created successfully with ${subtasks.length} subtasks and associated todos.${formatTokenUsage(tokenUsage)}`);
          } catch (autoGenError) {
            // If auto-generation fails, still return success for the feature creation
            console.warn(`Auto-generation failed for feature ${feature.id}:`, autoGenError);
            
            const inputText = JSON.stringify(args);
            const outputText = `Created feature request ${feature.id} (auto-generation failed)`;
            const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'create_feature_request');
            
            resolve(`Feature request ${feature.id} created successfully (note: auto-generation of subtasks/todos failed).${formatTokenUsage(tokenUsage)}`);
          }
        }
      });
    });
  }

  /**
   * List feature requests with filtering options
   */
  async listFeatureRequests(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('list_feature_requests');
    
    let query = 'SELECT * FROM feature_requests';
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

    if (args.category) {
      conditions.push('category = ?');
      params.push(args.category);
    }

    if (args.requestedBy) {
      conditions.push('requestedBy = ?');
      params.push(args.requestedBy);
    }

    if (args.effortEstimate) {
      conditions.push('effortEstimate = ?');
      params.push(args.effortEstimate);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY dateRequested DESC';

    return new Promise((resolve, reject) => {
      db.all(query, params, (err, rows: any[]) => {
        if (err) {
          reject(new Error(`Failed to list feature requests: ${err.message}`));
        } else {
          const features = rows.map(row => ({
            ...row,
            acceptanceCriteria: JSON.parse(row.acceptanceCriteria || '[]'),
            dependencies: JSON.parse(row.dependencies || '[]')
          }));

          // Record token usage
          const inputText = JSON.stringify(args);
          const outputText = formatFeatureRequests(features);
          const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'list_feature_requests');
          
          resolve(`${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`);
        }
      });
    });
  }

  /**
   * Update feature request status
   */
  async updateFeatureStatus(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('update_feature_status');
    
    const { itemId, status } = args;

    const validStatuses = ['Proposed', 'In Discussion', 'Approved', 'In Development', 'Research Phase', 'Partially Implemented', 'Completed', 'Rejected'];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}`);
    }

    return new Promise((resolve, reject) => {
      const updateQuery = 'UPDATE feature_requests SET status = ? WHERE id = ?';
      
      db.run(updateQuery, [status, itemId], (err: any, result: any) => {
        if (err) {
          reject(new Error(`Failed to update feature request status: ${err.message}`));
        } else if (result && (result as any).changes === 0) {
          reject(new Error(`Feature request ${itemId} not found`));
        } else {
          // Record token usage
          const inputText = JSON.stringify(args);
          const outputText = `Updated feature request ${itemId} to ${status}`;
          const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'update_feature_status');
          
          resolve(`Feature request ${itemId} updated to ${status}.\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`);
        }
      });
    });
  }

  /**
   * Search feature requests
   */
  async searchFeatures(db: sqlite3.Database, query: string, args: any): Promise<any[]> {
    this.tokenTracker.startOperation('search_features');
    
    const searchFields = args.searchFields || ['title', 'description', 'category'];
    const limit = args.limit || 50;
    const offset = args.offset || 0;
    
    let sql = 'SELECT * FROM feature_requests WHERE ';
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

    if (args.category) {
      conditions.push('category LIKE ?');
      params.push(`%${args.category}%`);
    }

    if (args.effortEstimate) {
      if (Array.isArray(args.effortEstimate)) {
        conditions.push(`effortEstimate IN (${args.effortEstimate.map(() => '?').join(', ')})`);
        params.push(...args.effortEstimate);
      } else {
        conditions.push('effortEstimate = ?');
        params.push(args.effortEstimate);
      }
    }

    // Date range filter
    if (args.dateFrom) {
      conditions.push('dateRequested >= ?');
      params.push(args.dateFrom);
    }

    if (args.dateTo) {
      conditions.push('dateRequested <= ?');
      params.push(args.dateTo);
    }

    if (conditions.length === 0) {
      sql = 'SELECT * FROM feature_requests';
    } else {
      sql += conditions.join(' AND ');
    }

    // Add sorting
    const sortBy = args.sortBy || 'dateRequested';
    const sortOrder = args.sortOrder || 'desc';
    sql += ` ORDER BY ${sortBy} ${sortOrder}`;

    // Add pagination
    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows: any[]) => {
        if (err) {
          reject(new Error(`Failed to search feature requests: ${err.message}`));
        } else {
          const features = rows.map(row => ({
            ...row,
            type: 'feature',
            acceptanceCriteria: JSON.parse(row.acceptanceCriteria || '[]'),
            dependencies: JSON.parse(row.dependencies || '[]')
          }));

          resolve(features);
        }
      });
    });
  }

  /**
   * Bulk update feature request status
   */
  async bulkUpdateFeatureStatus(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('bulk_update_feature_status');
    
    const { updates } = args;
    const results: any[] = [];

    for (const update of updates) {
      try {
        const result = await this.updateFeatureStatus(db, update);
        results.push({
          status: 'success',
          featureId: update.itemId,
          message: `Updated to ${update.status}`
        });
      } catch (error) {
        results.push({
          status: 'error',
          featureId: update.itemId,
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Record token usage
    const inputText = JSON.stringify(args);
    const outputText = formatBulkUpdateResults(results, 'features');
    const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'bulk_update_feature_status');
    
    return `${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`;
  }

  /**
   * Get subtasks for a feature (helper for auto-generation)
   */
  private async getSubtasksForFeature(db: sqlite3.Database, featureId: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM subtasks WHERE parentId = ? ORDER BY orderIndex';
      db.all(query, [featureId], (err, rows) => {
        if (err) {
          reject(new Error(`Failed to get subtasks: ${err.message}`));
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  /**
   * Generate next ID for feature
   */
  private async generateNextId(db: sqlite3.Database, type: 'feature'): Promise<string> {
    return new Promise((resolve, reject) => {
      db.get('SELECT MAX(CAST(SUBSTR(id, 4) AS INTEGER)) as maxId FROM feature_requests', [], (err, row: any) => {
        if (err) {
          reject(new Error(`Failed to generate ID: ${err.message}`));
        } else {
          const nextNum = (row?.maxId || 0) + 1;
          resolve(`FR-${nextNum.toString().padStart(3, '0')}`);
        }
      });
    });
  }
}