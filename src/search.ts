// Search and semantic operations
import { formatSearchResults, formatStatistics } from './format.js';
import { TokenUsageTracker } from './token-usage-tracker.js';
import { BugManager } from './bugs.js';
import { FeatureManager } from './features.js';
import { ImprovementManager } from './improvements.js';
import sqlite3 from 'sqlite3';

export class SearchManager {
  private tokenTracker: TokenUsageTracker;
  private bugManager: BugManager;
  private featureManager: FeatureManager;
  private improvementManager: ImprovementManager;

  constructor() {
    this.tokenTracker = TokenUsageTracker.getInstance();
    this.bugManager = new BugManager();
    this.featureManager = new FeatureManager();
    this.improvementManager = new ImprovementManager();
  }

  /**
   * Perform semantic search across all item types
   */
  async performSemanticSearch(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('semantic_search');
    
    const { query, limit = 10, minSimilarity = 0.3 } = args;
    
    if (!query) {
      throw new Error('Query is required for semantic search');
    }

    const results: any[] = [];

    try {
      // Search bugs
      const bugs = await this.searchAllBugs(db, query);
      for (const bug of bugs) {
        const similarity = this.calculateSimilarity(query, `${bug.title} ${bug.description}`);
        if (similarity >= minSimilarity) {
          results.push({
            ...bug,
            type: 'bug',
            similarity,
            matchedFields: this.getMatchedFields(query, bug, ['title', 'description', 'component'])
          });
        }
      }

      // Search features
      const features = await this.searchAllFeatures(db, query);
      for (const feature of features) {
        const similarity = this.calculateSimilarity(query, `${feature.title} ${feature.description}`);
        if (similarity >= minSimilarity) {
          results.push({
            ...feature,
            type: 'feature',
            similarity,
            matchedFields: this.getMatchedFields(query, feature, ['title', 'description', 'category'])
          });
        }
      }

      // Search improvements
      const improvements = await this.searchAllImprovements(db, query);
      for (const improvement of improvements) {
        const similarity = this.calculateSimilarity(query, `${improvement.title} ${improvement.description}`);
        if (similarity >= minSimilarity) {
          results.push({
            ...improvement,
            type: 'improvement',
            similarity,
            matchedFields: this.getMatchedFields(query, improvement, ['title', 'description', 'category'])
          });
        }
      }

      // Sort by similarity and limit results
      results.sort((a, b) => b.similarity - a.similarity);
      const limitedResults = results.slice(0, limit);

      // Record token usage
      const inputText = JSON.stringify(args);
      const outputText = formatSearchResults(limitedResults, {
        total: results.length,
        showing: limitedResults.length,
        offset: 0
      });
      const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'semantic_search');
      
      return `${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`;
    } catch (error) {
      throw new Error(`Semantic search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * General search across all item types
   */
  async searchItems(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('search_items');
    
    const { query, type, limit = 50, offset = 0 } = args;
    let results: any[] = [];

    try {
      if (type === 'bugs' || type === 'all') {
        const bugs = await this.bugManager.searchBugs(db, query, args);
        results.push(...bugs);
      }

      if (type === 'features' || type === 'all') {
        const features = await this.featureManager.searchFeatures(db, query, args);
        results.push(...features);
      }

      if (type === 'improvements' || type === 'all') {
        const improvements = await this.improvementManager.searchImprovements(db, query, args);
        results.push(...improvements);
      }

      // Apply global sorting if type is 'all'
      if (type === 'all') {
        const sortBy = args.sortBy || 'dateReported';
        const sortOrder = args.sortOrder || 'desc';
        
        results.sort((a, b) => {
          const aValue = a[sortBy] || a.dateRequested || '';
          const bValue = b[sortBy] || b.dateRequested || '';
          
          if (sortOrder === 'asc') {
            return aValue.localeCompare(bValue);
          } else {
            return bValue.localeCompare(aValue);
          }
        });

        // Apply pagination for 'all' type
        results = results.slice(offset, offset + limit);
      }

      // Record token usage
      const inputText = JSON.stringify(args);
      const outputText = formatSearchResults(results, {
        total: results.length,
        showing: results.length,
        offset: offset
      });
      const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'search_items');
      
      return `${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`;
    } catch (error) {
      throw new Error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get project statistics
   */
  async getStatistics(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('get_statistics');
    
    const { type = 'all' } = args;
    const stats: any = {};

    try {
      if (type === 'bugs' || type === 'all') {
        stats.bugs = await this.getBugStatistics(db);
      }

      if (type === 'features' || type === 'all') {
        stats.features = await this.getFeatureStatistics(db);
      }

      if (type === 'improvements' || type === 'all') {
        stats.improvements = await this.getImprovementStatistics(db);
      }

      // Record token usage
      const inputText = JSON.stringify(args);
      const outputText = formatStatistics(stats);
      const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'get_statistics');
      
      return `${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`;
    } catch (error) {
      throw new Error(`Failed to get statistics: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Calculate similarity between two texts using Jaccard similarity
   */
  private calculateSimilarity(text1: string, text2: string): number {
    const normalize = (text: string) => 
      text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(word => word.length > 0);
    
    const words1 = new Set(normalize(text1));
    const words2 = new Set(normalize(text2));
    
    const intersection = new Set([...words1].filter(word => words2.has(word)));
    const union = new Set([...words1, ...words2]);
    
    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  /**
   * Get matched fields for search results
   */
  private getMatchedFields(query: string, item: any, fields: string[]): string[] {
    const queryWords = query.toLowerCase().split(/\s+/);
    const matchedFields: string[] = [];

    for (const field of fields) {
      const fieldValue = item[field] || '';
      const fieldWords = fieldValue.toLowerCase().split(/\s+/);
      
      for (const queryWord of queryWords) {
        if (fieldWords.some((word: string) => word.includes(queryWord))) {
          matchedFields.push(field);
          break;
        }
      }
    }

    return matchedFields;
  }

  /**
   * Search all bugs (helper method)
   */
  private async searchAllBugs(db: sqlite3.Database, query: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM bugs', [], (err, rows: any[]) => {
        if (err) {
          reject(new Error(`Failed to search bugs: ${err.message}`));
        } else {
          const bugs = rows.map(row => ({
            ...row,
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
   * Search all features (helper method)
   */
  private async searchAllFeatures(db: sqlite3.Database, query: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM feature_requests', [], (err, rows: any[]) => {
        if (err) {
          reject(new Error(`Failed to search features: ${err.message}`));
        } else {
          const features = rows.map(row => ({
            ...row,
            acceptanceCriteria: JSON.parse(row.acceptanceCriteria || '[]'),
            dependencies: JSON.parse(row.dependencies || '[]')
          }));
          resolve(features);
        }
      });
    });
  }

  /**
   * Search all improvements (helper method)
   */
  private async searchAllImprovements(db: sqlite3.Database, query: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM improvements', [], (err, rows: any[]) => {
        if (err) {
          reject(new Error(`Failed to search improvements: ${err.message}`));
        } else {
          const improvements = rows.map(row => ({
            ...row,
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
   * Get bug statistics
   */
  private async getBugStatistics(db: sqlite3.Database): Promise<any> {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          COUNT(*) as total,
          status,
          priority,
          COUNT(*) as count
        FROM bugs 
        GROUP BY status, priority
      `, [], (err, rows: any[]) => {
        if (err) {
          reject(new Error(`Failed to get bug statistics: ${err.message}`));
        } else {
          const byStatus: any = {};
          const byPriority: any = {};
          let total = 0;

          for (const row of rows) {
            byStatus[row.status] = (byStatus[row.status] || 0) + row.count;
            byPriority[row.priority] = (byPriority[row.priority] || 0) + row.count;
            total += row.count;
          }

          resolve({ total, byStatus, byPriority });
        }
      });
    });
  }

  /**
   * Get feature statistics
   */
  private async getFeatureStatistics(db: sqlite3.Database): Promise<any> {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          COUNT(*) as total,
          status,
          priority,
          COUNT(*) as count
        FROM feature_requests 
        GROUP BY status, priority
      `, [], (err, rows: any[]) => {
        if (err) {
          reject(new Error(`Failed to get feature statistics: ${err.message}`));
        } else {
          const byStatus: any = {};
          const byPriority: any = {};
          let total = 0;

          for (const row of rows) {
            byStatus[row.status] = (byStatus[row.status] || 0) + row.count;
            byPriority[row.priority] = (byPriority[row.priority] || 0) + row.count;
            total += row.count;
          }

          resolve({ total, byStatus, byPriority });
        }
      });
    });
  }

  /**
   * Get improvement statistics
   */
  private async getImprovementStatistics(db: sqlite3.Database): Promise<any> {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          COUNT(*) as total,
          status,
          priority,
          COUNT(*) as count
        FROM improvements 
        GROUP BY status, priority
      `, [], (err, rows: any[]) => {
        if (err) {
          reject(new Error(`Failed to get improvement statistics: ${err.message}`));
        } else {
          const byStatus: any = {};
          const byPriority: any = {};
          let total = 0;

          for (const row of rows) {
            byStatus[row.status] = (byStatus[row.status] || 0) + row.count;
            byPriority[row.priority] = (byPriority[row.priority] || 0) + row.count;
            total += row.count;
          }

          resolve({ total, byStatus, byPriority });
        }
      });
    });
  }
}