// Context management operations
import { ContextCollectionEngine, TaskAnalysisInput, ContextCollectionResult, CodeContext } from './context-collection-engine.js';
import { TokenUsageTracker } from './token-usage-tracker.js';
import sqlite3 from 'sqlite3';

export class ContextManager {
  private tokenTracker: TokenUsageTracker;
  private contextEngine: ContextCollectionEngine;

  constructor() {
    this.tokenTracker = TokenUsageTracker.getInstance();
    this.contextEngine = new ContextCollectionEngine(process.cwd(), {
      maxTokensPerTask: 2000,
      maxTokensPerContext: 200,
      enableIntelligentSummarization: true,
      enableContentDeduplication: true,
      taskTypeTokenLimits: {
        bug: 1500,
        feature: 2500,
        improvement: 2000,
      }
    });
  }

  /**
   * Manage contexts with various operations
   */
  async manageContexts(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('manage_contexts');
    
    const { operation, taskId } = args;

    switch (operation) {
      case 'collect':
        return this.collectContextForTask(db, args);
      case 'get':
        return this.getTaskContexts(db, args);
      case 'check_freshness':
        return this.checkContextFreshness(db, args);
      case 'add':
        return this.addManualContext(db, args);
      case 'update':
        return this.updateContext(db, args);
      case 'remove':
        return this.removeContext(db, args);
      default:
        throw new Error(`Unknown context operation: ${operation}`);
    }
  }

  /**
   * Collect context for a task
   */
  private async collectContextForTask(db: sqlite3.Database, args: any): Promise<string> {
    const { taskId, taskType, title, description, currentState, desiredState, expectedBehavior, actualBehavior, filesLikelyInvolved, keywords, entities } = args;

    if (!taskId || !taskType || !title || !description) {
      throw new Error('taskId, taskType, title, and description are required for context collection');
    }

    try {
      const input: TaskAnalysisInput = {
        taskId,
        taskType,
        title,
        description,
        currentState,
        desiredState,
        expectedBehavior,
        actualBehavior,
        filesLikelyInvolved,
        keywords,
        entities
      };

      const result = await this.contextEngine.collectContexts(input);
      
      // Store contexts in database
      await this.storeContextsInDatabase(db, result.contexts);

      // Record token usage
      const inputText = JSON.stringify(args);
      const outputText = this.formatContextCollectionResult(result);
      const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'collect_context');
      
      return `${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`;
    } catch (error) {
      throw new Error(`Context collection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get task contexts
   */
  private async getTaskContexts(db: sqlite3.Database, args: any): Promise<string> {
    const { taskId } = args;

    if (!taskId) {
      throw new Error('taskId is required');
    }

    try {
      const contexts = await this.getContextsFromDatabase(db, taskId);
      
      // Record token usage
      const inputText = JSON.stringify(args);
      const outputText = this.formatContexts(contexts);
      const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'get_contexts');
      
      return `${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`;
    } catch (error) {
      throw new Error(`Failed to get contexts: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check context freshness
   */
  private async checkContextFreshness(db: sqlite3.Database, args: any): Promise<string> {
    const { taskId } = args;

    if (!taskId) {
      throw new Error('taskId is required');
    }

    try {
      const contexts = await this.getContextsFromDatabase(db, taskId);
      const now = Date.now();
      const stalenessThreshold = 24 * 60 * 60 * 1000; // 24 hours

      let freshCount = 0;
      let staleCount = 0;
      const staleContexts: CodeContext[] = [];

      for (const context of contexts) {
        const lastChecked = context.dateLastChecked ? new Date(context.dateLastChecked).getTime() : new Date(context.dateCollected).getTime();
        const age = now - lastChecked;

        if (age > stalenessThreshold) {
          staleCount++;
          staleContexts.push(context);
        } else {
          freshCount++;
        }
      }

      const summary = `Context freshness check for task ${taskId}:\n` +
                     `- Fresh contexts: ${freshCount}\n` +
                     `- Stale contexts: ${staleCount}\n` +
                     `- Total contexts: ${contexts.length}`;

      if (staleContexts.length > 0) {
        const staleDetails = staleContexts.map(ctx => 
          `  - ${ctx.id}: ${ctx.description} (last checked: ${ctx.dateLastChecked || ctx.dateCollected})`
        ).join('\n');
        
        return `${summary}\n\nStale contexts:\n${staleDetails}`;
      }

      // Record token usage
      const inputText = JSON.stringify(args);
      const outputText = summary;
      const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'check_freshness');
      
      return `${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`;
    } catch (error) {
      throw new Error(`Failed to check context freshness: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Add manual context
   */
  private async addManualContext(db: sqlite3.Database, args: any): Promise<string> {
    const { taskId, taskType, contextType, filePath, startLine, endLine, content, description, relevanceScore, keywords } = args;

    if (!taskId || !taskType || !contextType || !filePath || !content || !description) {
      throw new Error('taskId, taskType, contextType, filePath, content, and description are required');
    }

    try {
      const context: CodeContext = {
        id: `${taskId}_manual_${Date.now()}`,
        taskId,
        taskType,
        contextType,
        source: 'manual',
        filePath,
        startLine,
        endLine,
        content,
        description,
        relevanceScore: relevanceScore || 0.8,
        keywords: keywords || [],
        dateCollected: new Date().toISOString(),
        isStale: false
      };

      await this.storeContextsInDatabase(db, [context]);

      // Record token usage
      const inputText = JSON.stringify(args);
      const outputText = `Manual context added successfully: ${context.id}`;
      const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'add_manual_context');
      
      return `${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`;
    } catch (error) {
      throw new Error(`Failed to add manual context: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update context
   */
  private async updateContext(db: sqlite3.Database, args: any): Promise<string> {
    const { contextId, updates } = args;

    if (!contextId || !updates) {
      throw new Error('contextId and updates are required');
    }

    try {
      await this.updateContextInDatabase(db, contextId, updates);

      // Record token usage
      const inputText = JSON.stringify(args);
      const outputText = `Context ${contextId} updated successfully`;
      const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'update_context');
      
      return `${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`;
    } catch (error) {
      throw new Error(`Failed to update context: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Remove context
   */
  private async removeContext(db: sqlite3.Database, args: any): Promise<string> {
    const { contextId } = args;

    if (!contextId) {
      throw new Error('contextId is required');
    }

    try {
      await this.removeContextFromDatabase(db, contextId);

      // Record token usage
      const inputText = JSON.stringify(args);
      const outputText = `Context ${contextId} removed successfully`;
      const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'remove_context');
      
      return `${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`;
    } catch (error) {
      throw new Error(`Failed to remove context: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Store contexts in database
   */
  private async storeContextsInDatabase(db: sqlite3.Database, contexts: CodeContext[]): Promise<void> {
    const insertQuery = `
      INSERT OR REPLACE INTO code_contexts (
        id, taskId, taskType, contextType, source, filePath, startLine, endLine, 
        content, description, relevanceScore, keywords, dateCollected, 
        dateLastChecked, isStale
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    for (const context of contexts) {
      await new Promise<void>((resolve, reject) => {
        db.run(insertQuery, [
          context.id,
          context.taskId,
          context.taskType,
          context.contextType,
          context.source,
          context.filePath,
          context.startLine,
          context.endLine,
          context.content,
          context.description,
          context.relevanceScore,
          JSON.stringify(context.keywords),
          context.dateCollected,
          context.dateLastChecked,
          context.isStale ? 1 : 0
        ], function(err) {
          if (err) {
            reject(new Error(`Failed to store context: ${err.message}`));
          } else {
            resolve();
          }
        });
      });
    }
  }

  /**
   * Get contexts from database
   */
  private async getContextsFromDatabase(db: sqlite3.Database, taskId: string): Promise<CodeContext[]> {
    return new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM code_contexts WHERE taskId = ? ORDER BY relevanceScore DESC',
        [taskId],
        (err, rows: any[]) => {
          if (err) {
            reject(new Error(`Failed to get contexts: ${err.message}`));
          } else {
            const contexts = rows.map(row => ({
              ...row,
              keywords: JSON.parse(row.keywords || '[]'),
              isStale: row.isStale === 1
            }));
            resolve(contexts);
          }
        }
      );
    });
  }

  /**
   * Update context in database
   */
  private async updateContextInDatabase(db: sqlite3.Database, contextId: string, updates: any): Promise<void> {
    const allowedUpdates = ['content', 'description', 'relevanceScore', 'keywords', 'isStale'];
    const updateFields: string[] = [];
    const updateValues: any[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedUpdates.includes(key)) {
        updateFields.push(`${key} = ?`);
        if (key === 'keywords') {
          updateValues.push(JSON.stringify(value));
        } else if (key === 'isStale') {
          updateValues.push(value ? 1 : 0);
        } else {
          updateValues.push(value);
        }
      }
    }

    if (updateFields.length === 0) {
      throw new Error('No valid update fields provided');
    }

    updateFields.push('dateLastChecked = ?');
    updateValues.push(new Date().toISOString());
    updateValues.push(contextId);

    const updateQuery = `UPDATE code_contexts SET ${updateFields.join(', ')} WHERE id = ?`;

    return new Promise<void>((resolve, reject) => {
      db.run(updateQuery, updateValues, function(err) {
        if (err) {
          reject(new Error(`Failed to update context: ${err.message}`));
        } else if (this.changes === 0) {
          reject(new Error(`Context ${contextId} not found`));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Remove context from database
   */
  private async removeContextFromDatabase(db: sqlite3.Database, contextId: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      db.run('DELETE FROM code_contexts WHERE id = ?', [contextId], function(err) {
        if (err) {
          reject(new Error(`Failed to remove context: ${err.message}`));
        } else if (this.changes === 0) {
          reject(new Error(`Context ${contextId} not found`));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Format context collection result
   */
  private formatContextCollectionResult(result: ContextCollectionResult): string {
    const { contexts, summary, recommendations, potentialIssues } = result;

    let output = `Context Collection Summary:\n`;
    output += `- Total contexts collected: ${summary.totalContexts}\n`;
    output += `- High relevance contexts: ${summary.highRelevanceContexts}\n`;
    output += `- Medium relevance contexts: ${summary.mediumRelevanceContexts}\n`;
    output += `- Low relevance contexts: ${summary.lowRelevanceContexts}\n`;
    output += `- Average relevance score: ${summary.averageRelevanceScore.toFixed(2)}\n`;
    output += `- Processing time: ${summary.processingTimeMs}ms\n`;
    output += `- Files analyzed: ${summary.filesAnalyzed}\n`;
    output += `- Patterns found: ${summary.patternsFound}\n`;
    output += `- Dependencies analyzed: ${summary.dependenciesAnalyzed}\n\n`;

    if (contexts.length > 0) {
      output += `Collected Contexts:\n`;
      output += this.formatContexts(contexts);
      output += '\n';
    }

    if (recommendations.length > 0) {
      output += `Recommendations:\n`;
      recommendations.forEach(rec => {
        output += `- ${rec}\n`;
      });
      output += '\n';
    }

    if (potentialIssues.length > 0) {
      output += `Potential Issues:\n`;
      potentialIssues.forEach(issue => {
        output += `- ${issue}\n`;
      });
    }

    return output;
  }

  /**
   * Format contexts for display
   */
  private formatContexts(contexts: CodeContext[]): string {
    if (contexts.length === 0) {
      return 'No contexts found.';
    }

    let output = '';
    
    contexts.forEach((context, index) => {
      output += `${index + 1}. ${context.description}\n`;
      output += `   ID: ${context.id}\n`;
      output += `   Type: ${context.contextType}\n`;
      output += `   Source: ${context.source}\n`;
      output += `   File: ${context.filePath}\n`;
      if (context.startLine && context.endLine) {
        output += `   Lines: ${context.startLine}-${context.endLine}\n`;
      }
      output += `   Relevance: ${context.relevanceScore.toFixed(2)}\n`;
      output += `   Keywords: ${context.keywords.join(', ')}\n`;
      output += `   Collected: ${context.dateCollected}\n`;
      if (context.isStale) {
        output += `   Status: STALE\n`;
      }
      output += '\n';
    });

    return output;
  }
}