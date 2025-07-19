// Improvement management operations
import { formatImprovements, formatImprovementsWithContext, formatBulkUpdateResults, formatTokenUsage } from './format.js';
import { TokenUsageTracker } from './token-usage-tracker.js';
import sqlite3 from 'sqlite3';
import * as fs from 'fs';

// Improvement interface
export interface Improvement {
  id: string;
  status: 'Proposed' | 'In Discussion' | 'Approved' | 'In Development' | 'Completed (Awaiting Human Verification)' | 'Completed' | 'Rejected';
  priority: 'Low' | 'Medium' | 'High';
  dateRequested: string;
  dateCompleted?: string;
  category: string;
  requestedBy?: string;
  title: string;
  description: string;
  currentState: string;
  desiredState: string;
  acceptanceCriteria: string[];
  implementationDetails?: string;
  potentialImplementation?: string;
  filesLikelyInvolved?: string[];
  dependencies?: string[];
  effortEstimate?: 'Small' | 'Medium' | 'Large';
  benefits?: string[];
}

export class ImprovementManager {
  private tokenTracker: TokenUsageTracker;

  constructor() {
    this.tokenTracker = TokenUsageTracker.getInstance();
  }

  /**
   * Create a new improvement
   */
  async createImprovement(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('create_improvement');
    
    const improvement: Improvement = {
      id: args.improvementId || await this.generateNextIdWithRetry(db, 'improvement'),
      status: 'Proposed',
      priority: args.priority || 'Medium',
      dateRequested: new Date().toISOString().split('T')[0],
      category: args.category || 'General',
      requestedBy: args.requestedBy,
      title: args.title,
      description: args.description,
      currentState: args.currentState,
      desiredState: args.desiredState,
      acceptanceCriteria: args.acceptanceCriteria || [],
      implementationDetails: args.implementationDetails,
      potentialImplementation: args.potentialImplementation,
      filesLikelyInvolved: args.filesLikelyInvolved || [],
      dependencies: args.dependencies || [],
      effortEstimate: args.effortEstimate,
      benefits: args.benefits || []
    };

    return new Promise((resolve, reject) => {
      const insertQuery = `
        INSERT INTO improvements (
          id, status, priority, dateRequested, category, requestedBy, title, description, 
          currentState, desiredState, acceptanceCriteria, implementationDetails, 
          potentialImplementation, filesLikelyInvolved, dependencies, effortEstimate, benefits
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      db.run(insertQuery, [
        improvement.id,
        improvement.status,
        improvement.priority,
        improvement.dateRequested,
        improvement.category,
        improvement.requestedBy,
        improvement.title,
        improvement.description,
        improvement.currentState,
        improvement.desiredState,
        JSON.stringify(improvement.acceptanceCriteria),
        improvement.implementationDetails,
        improvement.potentialImplementation,
        JSON.stringify(improvement.filesLikelyInvolved),
        JSON.stringify(improvement.dependencies),
        improvement.effortEstimate,
        JSON.stringify(improvement.benefits)
      ], async (err) => {
        if (err) {
          reject(new Error(`Failed to create improvement: ${err.message}`));
        } else {
          // Record token usage
          const inputText = JSON.stringify(args);
          const outputText = `Improvement ${improvement.id} created successfully.`;
          const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'create_improvement');
          
          resolve(`${outputText}${formatTokenUsage(tokenUsage)}`);
        }
      });
    });
  }

  /**
   * List improvements with filtering options
   */
  async listImprovements(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('list_improvements');
    
    let query = 'SELECT * FROM improvements';
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
      db.all(query, params, async (err, rows: any[]) => {
        if (err) {
          reject(new Error(`Failed to list improvements: ${err.message}`));
        } else {
          const improvements = rows.map(row => ({
            ...row,
            acceptanceCriteria: JSON.parse(row.acceptanceCriteria || '[]'),
            filesLikelyInvolved: JSON.parse(row.filesLikelyInvolved || '[]'),
            dependencies: JSON.parse(row.dependencies || '[]'),
            benefits: JSON.parse(row.benefits || '[]')
          }));

          let output: string;
          if (args.includeCodeContext) {
            // Get code context for each improvement
            const improvementsWithContext = await Promise.all(
              improvements.map(async (improvement) => {
                const codeContext = await this.getCodeContextForImprovement(improvement);
                return { ...improvement, codeContext };
              })
            );
            output = formatImprovementsWithContext(improvementsWithContext);
          } else {
            output = formatImprovements(improvements);
          }

          // Record token usage
          const inputText = JSON.stringify(args);
          const tokenUsage = this.tokenTracker.recordUsage(inputText, output, 'list_improvements');
          
          resolve(`${output}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`);
        }
      });
    });
  }

  /**
   * Update improvement status
   */
  async updateImprovementStatus(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('update_improvement_status');
    
    const { itemId, status, dateCompleted } = args;

    const validStatuses = ['Proposed', 'In Discussion', 'Approved', 'In Development', 'Completed (Awaiting Human Verification)', 'Completed', 'Rejected'];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}`);
    }

    return new Promise((resolve, reject) => {
      let updateQuery = 'UPDATE improvements SET status = ?';
      const params = [status];

      if (dateCompleted) {
        updateQuery += ', dateCompleted = ?';
        params.push(dateCompleted);
      }

      updateQuery += ' WHERE id = ?';
      params.push(itemId);

      db.run(updateQuery, params, (err: any, result: any) => {
        if (err) {
          reject(new Error(`Failed to update improvement status: ${err.message}`));
        } else if (result && (result as any).changes === 0) {
          reject(new Error(`Improvement ${itemId} not found`));
        } else {
          // Record token usage
          const inputText = JSON.stringify(args);
          const outputText = `Updated improvement ${itemId} to ${status}`;
          const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'update_improvement_status');
          
          resolve(`Improvement ${itemId} updated to ${status}.\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`);
        }
      });
    });
  }

  /**
   * Search improvements
   */
  async searchImprovements(db: sqlite3.Database, query: string, args: any): Promise<any[]> {
    this.tokenTracker.startOperation('search_improvements');
    
    const searchFields = args.searchFields || ['title', 'description', 'category'];
    const limit = args.limit || 50;
    const offset = args.offset || 0;
    
    let sql = 'SELECT * FROM improvements WHERE ';
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
      sql = 'SELECT * FROM improvements';
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
          reject(new Error(`Failed to search improvements: ${err.message}`));
        } else {
          const improvements = rows.map(row => ({
            ...row,
            type: 'improvement',
            acceptanceCriteria: JSON.parse(row.acceptanceCriteria || '[]'),
            filesLikelyInvolved: JSON.parse(row.filesLikelyInvolved || '[]'),
            dependencies: JSON.parse(row.dependencies || '[]'),
            benefits: JSON.parse(row.benefits || '[]')
          }));

          resolve(improvements);
        }
      });
    });
  }

  /**
   * Bulk update improvement status
   */
  async bulkUpdateImprovementStatus(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('bulk_update_improvement_status');
    
    const { updates } = args;
    const results: any[] = [];

    for (const update of updates) {
      try {
        const result = await this.updateImprovementStatus(db, update);
        results.push({
          status: 'success',
          improvementId: update.itemId,
          message: `Updated to ${update.status}`,
          dateCompleted: update.dateCompleted
        });
      } catch (error) {
        results.push({
          status: 'error',
          improvementId: update.itemId,
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Record token usage
    const inputText = JSON.stringify(args);
    const outputText = formatBulkUpdateResults(results, 'improvements');
    const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'bulk_update_improvement_status');
    
    return `${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`;
  }

  /**
   * Get code context for improvement
   */
  async getCodeContextForImprovement(improvement: any): Promise<any[]> {
    const codeContext: any[] = [];
    
    if (improvement.filesLikelyInvolved && improvement.filesLikelyInvolved.length > 0) {
      for (const file of improvement.filesLikelyInvolved) {
        try {
          if (fs.existsSync(file)) {
            const content = fs.readFileSync(file, 'utf8');
            const relevantSection = this.extractRelevantSections(content, improvement);
            
            codeContext.push({
              file: file,
              content: relevantSection || content.substring(0, 2000) + (content.length > 2000 ? '...' : ''),
              relevanceScore: relevantSection ? 0.8 : 0.5
            });
          } else {
            codeContext.push({
              file: file,
              error: 'File not found',
              relevanceScore: 0
            });
          }
        } catch (error) {
          codeContext.push({
            file: file,
            error: `Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}`,
            relevanceScore: 0
          });
        }
      }
    }
    
    return codeContext;
  }

  /**
   * Extract relevant sections from file content
   */
  private extractRelevantSections(content: string, improvement: any): string | null {
    const keywords = this.extractKeywords(improvement.currentState + ' ' + improvement.desiredState + ' ' + improvement.description);
    const lines = content.split('\n');
    const relevantLines: { line: number; content: string; score: number }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let score = 0;

      for (const keyword of keywords) {
        if (line.toLowerCase().includes(keyword.toLowerCase())) {
          score += 1;
        }
      }

      if (score > 0) {
        relevantLines.push({ line: i, content: line, score });
      }
    }

    if (relevantLines.length === 0) {
      return null;
    }

    // Sort by score and get top relevant lines
    relevantLines.sort((a, b) => b.score - a.score);
    const topLines = relevantLines.slice(0, 10);

    // Get context around each relevant line
    const contextLines: string[] = [];
    const contextSize = 3;

    for (const relevantLine of topLines) {
      const start = Math.max(0, relevantLine.line - contextSize);
      const end = Math.min(lines.length, relevantLine.line + contextSize + 1);
      
      const section = lines.slice(start, end).join('\n');
      if (!contextLines.includes(section)) {
        contextLines.push(section);
      }
    }

    return contextLines.join('\n\n---\n\n');
  }

  /**
   * Extract keywords from text
   */
  private extractKeywords(text: string): string[] {
    const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
    const stopWords = ['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'this', 'that', 'which', 'who', 'what', 'where', 'when', 'why', 'how', 'can', 'could', 'should', 'would', 'will', 'have', 'has', 'had', 'do', 'does', 'did', 'is', 'are', 'was', 'were', 'be', 'been', 'being'];
    
    return words.filter(word => !stopWords.includes(word)).slice(0, 20);
  }


  /**
   * Generate next ID for improvement with retry mechanism for race conditions
   */
  private async generateNextIdWithRetry(db: sqlite3.Database, type: 'improvement', retryCount = 0): Promise<string> {
    const maxRetries = 3;
    
    try {
      return await this.generateNextId(db, type);
    } catch (error) {
      if (retryCount < maxRetries && error instanceof Error && error.message.includes('UNIQUE constraint')) {
        // Wait a bit and retry
        await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));
        return this.generateNextIdWithRetry(db, type, retryCount + 1);
      }
      throw error;
    }
  }

  /**
   * Generate next ID for improvement
   */
  private async generateNextId(db: sqlite3.Database, type: 'improvement'): Promise<string> {
    return new Promise((resolve, reject) => {
      db.get('SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) as maxId FROM improvements', [], (err, row: any) => {
        if (err) {
          reject(new Error(`Failed to generate ID: ${err.message}`));
        } else {
          const nextNum = (row?.maxId || 0) + 1;
          resolve(`IMP-${nextNum.toString().padStart(3, '0')}`);
        }
      });
    });
  }
}