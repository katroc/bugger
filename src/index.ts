#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { formatBugs, formatFeatureRequests, formatImprovements, formatImprovementsWithContext, formatSearchResults, formatStatistics, formatBulkUpdateResults } from './format.js';
import { TextAnalyzer, KeywordResult } from './text-analysis.js';
import { ContextCollectionEngine, TaskAnalysisInput, ContextCollectionResult, CodeContext } from './context-collection-engine.js';
import sqlite3 from 'sqlite3';
import * as fs from 'fs';
import * as path from 'path';

// Types based on your existing structure
interface Bug {
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

interface FeatureRequest {
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

interface Improvement {
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

// New interfaces for code context functionality
interface TaskWithContext {
  codeContexts: CodeContext[];
}

interface AnalysisResult {
  keywords: string[];
  entities: string[];
  intent: string;
  confidence: number;
}



interface EntityResult {
  entity: string;
  type: 'function' | 'class' | 'file' | 'variable';
  confidence: number;
}

interface IntentResult {
  intent: string;
  confidence: number;
  category: string;
}

interface FileMatch {
  filePath: string;
  relevanceScore: number;
  matchedKeywords: string[];
}

interface CodeSection {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  relevanceScore: number;
}

interface FunctionMatch {
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  signature: string;
}

interface PatternMatch {
  pattern: string;
  filePath: string;
  startLine: number;
  endLine: number;
  similarity: number;
}

interface ArchitecturalContext {
  configFiles: string[];
  dependencies: string[];
  relationships: Array<{
    from: string;
    to: string;
    type: string;
  }>;
}


class ProjectManagementServer {
  private server: Server;
  private db!: sqlite3.Database;
  private textAnalyzer: TextAnalyzer;
  private contextEngine: ContextCollectionEngine;

  constructor() {
    this.server = new Server(
      {
        name: 'bugger-mcp',
        version: '0.1.0',
        capabilities: {
          tools: {},
        },
      }
    );

    this.textAnalyzer = new TextAnalyzer();
    this.contextEngine = new ContextCollectionEngine(process.cwd(), {
      maxTokensPerTask: 2000,
      maxTokensPerContext: 200,
      enableIntelligentSummarization: true,
      enableContentDeduplication: true,
      compressionThreshold: 500
    });
    this.setupToolHandlers();
  }

  private async initDb() {
    return new Promise<void>((resolve, reject) => {
      this.db = new sqlite3.Database('./bugger.db', (err) => {
        if (err) {
          reject(new McpError(ErrorCode.InternalError, `Failed to initialize database: ${err.message}`));
          return;
        }

        this.db.serialize(() => {
          this.db.exec(`
            CREATE TABLE IF NOT EXISTS bugs (
              id TEXT PRIMARY KEY,
              status TEXT,
              priority TEXT,
              dateReported TEXT,
              component TEXT,
              title TEXT,
              description TEXT,
              expectedBehavior TEXT,
              actualBehavior TEXT,
              potentialRootCause TEXT,
              filesLikelyInvolved TEXT,
              stepsToReproduce TEXT,
              verification TEXT,
              humanVerified INTEGER
            );

            CREATE TABLE IF NOT EXISTS features (
              id TEXT PRIMARY KEY,
              status TEXT,
              priority TEXT,
              dateRequested TEXT,
              category TEXT,
              requestedBy TEXT,
              title TEXT,
              description TEXT,
              userStory TEXT,
              currentBehavior TEXT,
              expectedBehavior TEXT,
              acceptanceCriteria TEXT,
              potentialImplementation TEXT,
              dependencies TEXT,
              effortEstimate TEXT
            );

            CREATE TABLE IF NOT EXISTS improvements (
              id TEXT PRIMARY KEY,
              status TEXT,
              priority TEXT,
              dateRequested TEXT,
              dateCompleted TEXT,
              category TEXT,
              requestedBy TEXT,
              title TEXT,
              description TEXT,
              currentState TEXT,
              desiredState TEXT,
              acceptanceCriteria TEXT,
              implementationDetails TEXT,
              potentialImplementation TEXT,
              filesLikelyInvolved TEXT,
              dependencies TEXT,
              effortEstimate TEXT,
              benefits TEXT
            );

            CREATE TABLE IF NOT EXISTS relationships (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              fromItem TEXT NOT NULL,
              toItem TEXT NOT NULL,
              relationshipType TEXT NOT NULL,
              dateCreated TEXT NOT NULL,
              UNIQUE(fromItem, toItem, relationshipType)
            );

            CREATE TABLE IF NOT EXISTS code_contexts (
              id TEXT PRIMARY KEY,
              task_id TEXT NOT NULL,
              task_type TEXT NOT NULL,
              context_type TEXT NOT NULL,
              source TEXT NOT NULL,
              file_path TEXT NOT NULL,
              start_line INTEGER,
              end_line INTEGER,
              content TEXT,
              description TEXT NOT NULL,
              relevance_score REAL NOT NULL,
              keywords TEXT,
              date_collected TEXT NOT NULL,
              date_last_checked TEXT,
              is_stale INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS context_analysis_cache (
              id TEXT PRIMARY KEY,
              content_hash TEXT NOT NULL,
              analysis_result TEXT NOT NULL,
              date_created TEXT NOT NULL,
              expiry_date TEXT NOT NULL
            );
          `, (err) => {
            if (err) {
              reject(new McpError(ErrorCode.InternalError, `Failed to create tables: ${err.message}`));
            } else {
              resolve();
            }
          });
        });
      });
    });
  }

  private async withTransaction<T>(operation: (db: sqlite3.Database) => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run('BEGIN TRANSACTION', (err) => {
          if (err) {
            reject(new McpError(ErrorCode.InternalError, `Failed to begin transaction: ${err.message}`));
            return;
          }

          operation(this.db)
            .then(result => {
              this.db.run('COMMIT', (err) => {
                if (err) {
                  this.db.run('ROLLBACK');
                  reject(new McpError(ErrorCode.InternalError, `Failed to commit transaction: ${err.message}`));
                } else {
                  resolve(result);
                }
              });
            })
            .catch(error => {
              this.db.run('ROLLBACK');
              reject(error);
            });
        });
      });
    });
  }

  private async generateNextId(type: 'bug' | 'feature' | 'improvement'): Promise<string> {
    return new Promise((resolve, reject) => {
      const prefixes = { bug: 'Bug #', feature: 'FR-', improvement: 'IMP-' };
      const tableName = type === 'bug' ? 'bugs' : type === 'feature' ? 'features' : 'improvements';
      const prefix = prefixes[type];

      this.db.get(
        `SELECT MAX(CAST(SUBSTR(id, LENGTH(?) + 1) AS INTEGER)) as maxNum FROM ${tableName} WHERE id LIKE ? || '%'`,
        prefix, prefix,
        (err: any, result: any) => {
          if (err) {
            reject(new McpError(ErrorCode.InternalError, `Failed to generate ID: ${err.message}`));
            return;
          }

          const maxNum = result && result.maxNum ? result.maxNum : 0;
          const nextNumber = maxNum + 1;

          const newId = type === 'bug' ? `Bug #${nextNumber.toString().padStart(3, '0')}` :
            type === 'feature' ? `FR-${nextNumber.toString().padStart(3, '0')}` :
              `IMP-${nextNumber.toString().padStart(3, '0')}`;

          resolve(newId);
        }
      );
    });
  }

  private async createItem(args: any) {
    const { type, ...itemData } = args;
    
    try {
      switch (type) {
        case 'bug':
          return await this.createBug(itemData);
        case 'feature':
          return await this.createFeatureRequest(itemData);
        case 'improvement':
          return await this.createImprovement(itemData);
        default:
          throw new McpError(ErrorCode.InvalidParams, `Unknown item type: ${type}`);
      }
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to create ${type}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async listItems(args: any) {
    const { type, ...filters } = args;
    
    try {
      switch (type) {
        case 'bug':
          return await this.listBugs(filters);
        case 'feature':
          return await this.listFeatureRequests(filters);
        case 'improvement':
          return await this.listImprovements(filters);
        default:
          throw new McpError(ErrorCode.InvalidParams, `Unknown item type: ${type}`);
      }
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to list ${type}s: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async updateItemStatus(args: any) {
    const { itemId, status, humanVerified, dateCompleted } = args;
    
    try {
      // Determine item type from ID format
      if (itemId.startsWith('Bug #')) {
        return await this.updateBugStatus({ bugId: itemId, status, humanVerified });
      } else if (itemId.startsWith('FR-')) {
        return await this.updateFeatureStatus({ featureId: itemId, status });
      } else if (itemId.startsWith('IMP-')) {
        return await this.updateImprovementStatus({ improvementId: itemId, status, dateCompleted });
      } else {
        throw new McpError(ErrorCode.InvalidParams, `Unknown item ID format: ${itemId}`);
      }
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to update item status: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async createBug(args: any) {
    return this.withTransaction(async (db) => {
      const newBug: Bug = {
        id: await this.generateNextId('bug'),
        status: 'Open',
        priority: args.priority,
        dateReported: new Date().toISOString().split('T')[0],
        component: args.component,
        title: args.title,
        description: args.description,
        expectedBehavior: args.expectedBehavior,
        actualBehavior: args.actualBehavior,
        potentialRootCause: args.potentialRootCause,
        filesLikelyInvolved: args.filesLikelyInvolved || [],
        stepsToReproduce: args.stepsToReproduce || [],
        humanVerified: false
      };

      return new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO bugs (id, status, priority, dateReported, component, title, description, expectedBehavior, actualBehavior, potentialRootCause, filesLikelyInvolved, stepsToReproduce, humanVerified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [newBug.id, newBug.status, newBug.priority, newBug.dateReported, newBug.component, newBug.title, newBug.description, newBug.expectedBehavior, newBug.actualBehavior, newBug.potentialRootCause, JSON.stringify(newBug.filesLikelyInvolved), JSON.stringify(newBug.stepsToReproduce), newBug.humanVerified ? 1 : 0],
          (err: any) => {
            if (err) {
              reject(new McpError(ErrorCode.InternalError, `Failed to create bug: ${err.message}`));
              return;
            }

            resolve({
              content: [
                {
                  type: 'text',
                  text: `Created new bug: ${newBug.id} - ${newBug.title}`
                }
              ]
            });
          }
        );
      });
    });
  }

  private async createFeatureRequest(args: any) {
    return this.withTransaction(async (db) => {
      const newFeature: FeatureRequest = {
        id: await this.generateNextId('feature'),
        status: 'Proposed',
        priority: args.priority,
        dateRequested: new Date().toISOString().split('T')[0],
        category: args.category,
        requestedBy: args.requestedBy,
        title: args.title,
        description: args.description,
        userStory: args.userStory,
        currentBehavior: args.currentBehavior,
        expectedBehavior: args.expectedBehavior,
        acceptanceCriteria: args.acceptanceCriteria,
        effortEstimate: args.effortEstimate
      };

      return new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO features (id, status, priority, dateRequested, category, requestedBy, title, description, userStory, currentBehavior, expectedBehavior, acceptanceCriteria, effortEstimate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [newFeature.id, newFeature.status, newFeature.priority, newFeature.dateRequested, newFeature.category, newFeature.requestedBy, newFeature.title, newFeature.description, newFeature.userStory, newFeature.currentBehavior, newFeature.expectedBehavior, JSON.stringify(newFeature.acceptanceCriteria), newFeature.effortEstimate],
          (err: any) => {
            if (err) {
              reject(new McpError(ErrorCode.InternalError, `Failed to create feature request: ${err.message}`));
              return;
            }

            resolve({
              content: [
                {
                  type: 'text',
                  text: `Created new feature request: ${newFeature.id} - ${newFeature.title}`
                }
              ]
            });
          }
        );
      });
    });
  }

  private async createImprovement(args: any) {
    return this.withTransaction(async (db) => {
      const newImprovement: Improvement = {
        id: await this.generateNextId('improvement'),
        status: 'Proposed',
        priority: args.priority,
        dateRequested: new Date().toISOString().split('T')[0],
        category: args.category,
        requestedBy: args.requestedBy,
        title: args.title,
        description: args.description,
        currentState: args.currentState,
        desiredState: args.desiredState,
        acceptanceCriteria: args.acceptanceCriteria,
        filesLikelyInvolved: args.filesLikelyInvolved || [],
        effortEstimate: args.effortEstimate
      };

      return new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO improvements (id, status, priority, dateRequested, category, requestedBy, title, description, currentState, desiredState, acceptanceCriteria, filesLikelyInvolved, effortEstimate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [newImprovement.id, newImprovement.status, newImprovement.priority, newImprovement.dateRequested, newImprovement.category, newImprovement.requestedBy, newImprovement.title, newImprovement.description, newImprovement.currentState, newImprovement.desiredState, JSON.stringify(newImprovement.acceptanceCriteria), JSON.stringify(newImprovement.filesLikelyInvolved), newImprovement.effortEstimate],
          (err: any) => {
            if (err) {
              reject(new McpError(ErrorCode.InternalError, `Failed to create improvement: ${err.message}`));
              return;
            }

            resolve({
              content: [
                {
                  type: 'text',
                  text: `Created new improvement: ${newImprovement.id} - ${newImprovement.title}`
                }
              ]
            });
          }
        );
      });
    });
  }

  private async listBugs(args: any) {
    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM bugs WHERE 1=1';
      const params: any[] = [];

      if (args.status) {
        query += ' AND status = ?';
        params.push(args.status);
      }
      if (args.priority) {
        query += ' AND priority = ?';
        params.push(args.priority);
      }
      if (args.component) {
        query += ' AND component LIKE ?';
        params.push(`%${args.component}%`);
      }

      this.db.all(query, params, (err: any, rows: any[]) => {
        if (err) {
          reject(new McpError(ErrorCode.InternalError, `Failed to list bugs: ${err.message}`));
          return;
        }

        const bugs = rows.map((bug: any) => ({
          ...bug,
          filesLikelyInvolved: JSON.parse(bug.filesLikelyInvolved || '[]'),
          stepsToReproduce: JSON.parse(bug.stepsToReproduce || '[]'),
          verification: JSON.parse(bug.verification || '[]'),
          humanVerified: !!bug.humanVerified
        }));

        resolve({
          content: [
            {
              type: 'text',
              text: formatBugs(bugs)
            }
          ]
        });
      });
    });
  }

  private async listFeatureRequests(args: any) {
    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM features WHERE 1=1';
      const params: any[] = [];

      if (args.status) {
        query += ' AND status = ?';
        params.push(args.status);
      }
      if (args.priority) {
        query += ' AND priority = ?';
        params.push(args.priority);
      }
      if (args.category) {
        query += ' AND category LIKE ?';
        params.push(`%${args.category}%`);
      }

      this.db.all(query, params, (err: any, rows: any[]) => {
        if (err) {
          reject(new McpError(ErrorCode.InternalError, `Failed to list feature requests: ${err.message}`));
          return;
        }

        const features = rows.map((feature: any) => ({
          ...feature,
          acceptanceCriteria: JSON.parse(feature.acceptanceCriteria || '[]'),
          dependencies: JSON.parse(feature.dependencies || '[]')
        }));

        resolve({
          content: [
            {
              type: 'text',
              text: formatFeatureRequests(features)
            }
          ]
        });
      });
    });
  }

  private async getCodeContextForImprovement(improvement: any): Promise<any[]> {
    // Extract files from improvement data
    const filesLikelyInvolved = improvement.filesLikelyInvolved || [];
    const codeContexts: any[] = [];

    // Look for file mentions in description, currentState, and desiredState
    const textToAnalyze = [
      improvement.description || '',
      improvement.currentState || '',
      improvement.desiredState || ''
    ].join(' ');

    // Simple regex to find potential file paths in text
    const filePathRegex = /(?:\/|\\)?[\w\-\.\/\\]+\.(js|ts|jsx|tsx|py|java|rb|php|go|cs|html|css|json|md|yml|yaml)/g;
    const mentionedFiles = textToAnalyze.match(filePathRegex) || [];

    // Combine explicitly listed files with files mentioned in text
    const allFiles = [...new Set([...filesLikelyInvolved, ...mentionedFiles])];

    // Read content from each file
    for (const file of allFiles) {
      try {
        // Check if file exists
        if (fs.existsSync(file)) {
          // Read file content (limit to reasonable size)
          const content = fs.readFileSync(file, 'utf8');

          // Extract relevant sections based on keywords from improvement
          const relevantSections = this.extractRelevantSections(content, improvement);

          codeContexts.push({
            file,
            content: relevantSections || content.substring(0, 1000) + (content.length > 1000 ? '...' : '')
          });
        }
      } catch (error: any) {
        console.error(`Error reading file ${file}:`, error);
        // Add error info to context
        codeContexts.push({
          file,
          error: `Could not read file: ${error.message}`
        });
      }
    }

    return codeContexts;
  }

  private extractRelevantSections(content: string, improvement: any): string | null {
    // Extract keywords from improvement
    const keywords = this.extractKeywords([
      improvement.title,
      improvement.description,
      improvement.currentState,
      improvement.desiredState
    ].join(' '));

    if (keywords.length === 0) {
      return null;
    }

    // Split content into lines
    const lines = content.split('\n');
    const relevantLines: { line: number, content: string, score: number }[] = [];

    // Score each line based on keyword matches
    lines.forEach((line, index) => {
      const lowerLine = line.toLowerCase();
      let score = 0;

      keywords.forEach(keyword => {
        if (lowerLine.includes(keyword.toLowerCase())) {
          score += 1;
        }
      });

      if (score > 0) {
        relevantLines.push({
          line: index,
          content: line,
          score
        });
      }
    });

    // Sort by score (highest first)
    relevantLines.sort((a, b) => b.score - a.score);

    // Take top matches and include surrounding context
    const contextSize = 5; // Lines before and after
    const topMatches = relevantLines.slice(0, 3); // Top 3 matches

    if (topMatches.length === 0) {
      return null;
    }

    // Collect sections with context
    const sections: { start: number, end: number }[] = [];

    topMatches.forEach(match => {
      const start = Math.max(0, match.line - contextSize);
      const end = Math.min(lines.length - 1, match.line + contextSize);

      // Check if this section overlaps with any existing section
      const overlapping = sections.findIndex(section =>
        (start >= section.start && start <= section.end) ||
        (end >= section.start && end <= section.end) ||
        (start <= section.start && end >= section.end)
      );

      if (overlapping >= 0) {
        // Merge sections
        sections[overlapping] = {
          start: Math.min(start, sections[overlapping].start),
          end: Math.max(end, sections[overlapping].end)
        };
      } else {
        // Add new section
        sections.push({ start, end });
      }
    });

    // Sort sections by start line
    sections.sort((a, b) => a.start - b.start);

    // Build result with section markers
    let result = '';
    sections.forEach((section, index) => {
      if (index > 0) {
        result += '\n...\n';
      }

      result += `// Lines ${section.start + 1}-${section.end + 1}\n`;
      for (let i = section.start; i <= section.end; i++) {
        result += lines[i] + '\n';
      }
    });

    return result;
  }

  private extractKeywords(text: string): string[] {
    // Use the enhanced TextAnalyzer for keyword extraction
    const keywordResults = this.textAnalyzer.extractKeywords(text, 10);
    return keywordResults.map(result => result.keyword);
  }

  private async listImprovements(args: any) {
    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM improvements WHERE 1=1';
      const params: any[] = [];

      if (args.status) {
        query += ' AND status = ?';
        params.push(args.status);
      }
      if (args.priority) {
        query += ' AND priority = ?';
        params.push(args.priority);
      }
      if (args.category) {
        query += ' AND category LIKE ?';
        params.push(`%${args.category}%`);
      }

      this.db.all(query, params, async (err: any, rows: any[]) => {
        if (err) {
          reject(new McpError(ErrorCode.InternalError, `Failed to list improvements: ${err.message}`));
          return;
        }

        const improvements = rows.map((improvement: any) => ({
          ...improvement,
          acceptanceCriteria: JSON.parse(improvement.acceptanceCriteria || '[]'),
          filesLikelyInvolved: JSON.parse(improvement.filesLikelyInvolved || '[]'),
          dependencies: JSON.parse(improvement.dependencies || '[]'),
          benefits: JSON.parse(improvement.benefits || '[]')
        }));

        // Add code context if includeCodeContext is requested
        let formattedOutput = formatImprovements(improvements);

        if (args.includeCodeContext) {
          try {
            const improvementsWithContext = await Promise.all(
              improvements.map(async (improvement: any) => {
                const codeContext = await this.getCodeContextForImprovement(improvement);
                return { ...improvement, codeContext };
              })
            );
            formattedOutput = formatImprovementsWithContext(improvementsWithContext);
          } catch (contextError) {
            // If code context fails, fall back to regular formatting
            console.error('Failed to get code context:', contextError);
          }
        }

        resolve({
          content: [
            {
              type: 'text',
              text: formattedOutput
            }
          ]
        });
      });
    });
  }

  private async updateBugStatus(args: any) {
    return this.withTransaction(async (db) => {
      return new Promise((resolve, reject) => {
        db.get('SELECT * FROM bugs WHERE id = ?', [args.bugId], (err: any, bug: any) => {
          if (err) {
            reject(new McpError(ErrorCode.InternalError, `Failed to find bug: ${err.message}`));
            return;
          }

          if (!bug) {
            reject(new McpError(ErrorCode.InvalidParams, `Bug ${args.bugId} not found`));
            return;
          }

          const humanVerified = args.humanVerified !== undefined ? (args.humanVerified ? 1 : 0) : bug.humanVerified;

          db.run(
            'UPDATE bugs SET status = ?, humanVerified = ? WHERE id = ?',
            [args.status, humanVerified, args.bugId],
            (err: any) => {
              if (err) {
                reject(new McpError(ErrorCode.InternalError, `Failed to update bug status: ${err.message}`));
                return;
              }

              resolve({
                content: [
                  {
                    type: 'text',
                    text: `Updated ${args.bugId} status to ${args.status}`
                  }
                ]
              });
            }
          );
        });
      });
    });
  }

  private async updateFeatureStatus(args: any) {
    return this.withTransaction(async (db) => {
      return new Promise((resolve, reject) => {
        db.get('SELECT * FROM features WHERE id = ?', [args.featureId], (err: any, feature: any) => {
          if (err) {
            reject(new McpError(ErrorCode.InternalError, `Failed to find feature: ${err.message}`));
            return;
          }

          if (!feature) {
            reject(new McpError(ErrorCode.InvalidParams, `Feature ${args.featureId} not found`));
            return;
          }

          db.run(
            'UPDATE features SET status = ? WHERE id = ?',
            [args.status, args.featureId],
            (err: any) => {
              if (err) {
                reject(new McpError(ErrorCode.InternalError, `Failed to update feature status: ${err.message}`));
                return;
              }

              resolve({
                content: [
                  {
                    type: 'text',
                    text: `Updated ${args.featureId} status to ${args.status}`
                  }
                ]
              });
            }
          );
        });
      });
    });
  }

  private async updateImprovementStatus(args: any) {
    return this.withTransaction(async (db) => {
      return new Promise((resolve, reject) => {
        db.get('SELECT * FROM improvements WHERE id = ?', [args.improvementId], (err: any, improvement: any) => {
          if (err) {
            reject(new McpError(ErrorCode.InternalError, `Failed to find improvement: ${err.message}`));
            return;
          }

          if (!improvement) {
            reject(new McpError(ErrorCode.InvalidParams, `Improvement ${args.improvementId} not found`));
            return;
          }

          const dateCompleted = args.dateCompleted || improvement.dateCompleted;

          db.run(
            'UPDATE improvements SET status = ?, dateCompleted = ? WHERE id = ?',
            [args.status, dateCompleted, args.improvementId],
            (err: any) => {
              if (err) {
                reject(new McpError(ErrorCode.InternalError, `Failed to update improvement status: ${err.message}`));
                return;
              }

              resolve({
                content: [
                  {
                    type: 'text',
                    text: `Updated ${args.improvementId} status to ${args.status}`
                  }
                ]
              });
            }
          );
        });
      });
    });
  }

  private async searchItems(args: any) {
    return new Promise((resolve, reject) => {
      const query = args.query ? args.query.toLowerCase() : '';
      const searchType = args.type || 'all';
      const results: any[] = [];
      let completedQueries = 0;
      const totalQueries = searchType === 'all' ? 3 : 1;

      const finishSearch = () => {
        completedQueries++;
        if (completedQueries === totalQueries) {
          // Sort results by date (newest first) if no specific sort order
          const sortBy = args.sortBy || 'date';
          const sortOrder = args.sortOrder || 'desc';

          results.sort((a, b) => {
            let aValue, bValue;

            switch (sortBy) {
              case 'date':
                aValue = new Date(a.dateReported || a.dateRequested || 0);
                bValue = new Date(b.dateReported || b.dateRequested || 0);
                break;
              case 'priority':
                const priorityOrder = { 'Critical': 4, 'High': 3, 'Medium': 2, 'Low': 1 };
                aValue = priorityOrder[a.priority as keyof typeof priorityOrder] || 0;
                bValue = priorityOrder[b.priority as keyof typeof priorityOrder] || 0;
                break;
              case 'title':
                aValue = (a.title || '').toLowerCase();
                bValue = (b.title || '').toLowerCase();
                break;
              case 'status':
                aValue = (a.status || '').toLowerCase();
                bValue = (b.status || '').toLowerCase();
                break;
              default:
                aValue = (a.title || '').toLowerCase();
                bValue = (b.title || '').toLowerCase();
            }

            if (sortOrder === 'asc') {
              return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
            } else {
              return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
            }
          });

          // Apply limit if specified
          const limit = args.limit || results.length;
          const offset = args.offset || 0;
          const limitedResults = results.slice(offset, offset + limit);

          resolve({
            content: [
              {
                type: 'text',
                text: formatSearchResults(limitedResults, {
                  total: results.length,
                  showing: limitedResults.length,
                  offset: offset,
                  limit: limit
                })
              }
            ]
          });
        }
      };

      if (searchType === 'bugs' || searchType === 'all') {
        this.searchBugs(query, args).then(bugs => {
          results.push(...bugs);
          finishSearch();
        }).catch(reject);
      }

      if (searchType === 'features' || searchType === 'all') {
        this.searchFeatures(query, args).then(features => {
          results.push(...features);
          finishSearch();
        }).catch(reject);
      }

      if (searchType === 'improvements' || searchType === 'all') {
        this.searchImprovements(query, args).then(improvements => {
          results.push(...improvements);
          finishSearch();
        }).catch(reject);
      }

      if (searchType !== 'bugs' && searchType !== 'features' && searchType !== 'improvements' && searchType !== 'all') {
        reject(new McpError(ErrorCode.InvalidParams, `Invalid search type: ${searchType}`));
      }
    });
  }

  private async searchBugs(query: string, args: any): Promise<any[]> {
    return new Promise((resolve, reject) => {
      let sql = 'SELECT * FROM bugs WHERE 1=1';
      const params: any[] = [];

      // Text search
      if (query && query.trim()) {
        const searchFields = args.searchFields || ['title', 'description', 'component'];
        const searchConditions = searchFields.map((field: string) => `LOWER(${field}) LIKE ?`).join(' OR ');
        sql += ` AND (${searchConditions})`;
        searchFields.forEach(() => params.push(`%${query}%`));
      }

      // Status filter
      if (args.status) {
        if (Array.isArray(args.status)) {
          const placeholders = args.status.map(() => '?').join(', ');
          sql += ` AND status IN (${placeholders})`;
          params.push(...args.status);
        } else {
          sql += ` AND status = ?`;
          params.push(args.status);
        }
      }

      // Priority filter
      if (args.priority) {
        if (Array.isArray(args.priority)) {
          const placeholders = args.priority.map(() => '?').join(', ');
          sql += ` AND priority IN (${placeholders})`;
          params.push(...args.priority);
        } else {
          sql += ` AND priority = ?`;
          params.push(args.priority);
        }
      }

      // Date range filter
      if (args.dateFrom) {
        sql += ` AND dateReported >= ?`;
        params.push(args.dateFrom);
      }
      if (args.dateTo) {
        sql += ` AND dateReported <= ?`;
        params.push(args.dateTo);
      }

      // Component filter
      if (args.component) {
        sql += ` AND LOWER(component) LIKE ?`;
        params.push(`%${args.component.toLowerCase()}%`);
      }

      // Human verified filter
      if (args.humanVerified !== undefined) {
        sql += ` AND humanVerified = ?`;
        params.push(args.humanVerified ? 1 : 0);
      }

      this.db.all(sql, params, (err: any, rows: any[]) => {
        if (err) {
          reject(new McpError(ErrorCode.InternalError, `Failed to search bugs: ${err.message}`));
          return;
        }

        const bugs = rows.map((bug: any) => ({
          type: 'bug',
          ...bug,
          filesLikelyInvolved: JSON.parse(bug.filesLikelyInvolved || '[]'),
          stepsToReproduce: JSON.parse(bug.stepsToReproduce || '[]'),
          verification: JSON.parse(bug.verification || '[]'),
          humanVerified: !!bug.humanVerified
        }));

        resolve(bugs);
      });
    });
  }

  private async searchFeatures(query: string, args: any): Promise<any[]> {
    return new Promise((resolve, reject) => {
      let sql = 'SELECT * FROM features WHERE 1=1';
      const params: any[] = [];

      // Text search
      if (query && query.trim()) {
        const searchFields = args.searchFields || ['title', 'description', 'category'];
        const searchConditions = searchFields.map((field: string) => `LOWER(${field}) LIKE ?`).join(' OR ');
        sql += ` AND (${searchConditions})`;
        searchFields.forEach(() => params.push(`%${query}%`));
      }

      // Status filter
      if (args.status) {
        if (Array.isArray(args.status)) {
          const placeholders = args.status.map(() => '?').join(', ');
          sql += ` AND status IN (${placeholders})`;
          params.push(...args.status);
        } else {
          sql += ` AND status = ?`;
          params.push(args.status);
        }
      }

      // Priority filter
      if (args.priority) {
        if (Array.isArray(args.priority)) {
          const placeholders = args.priority.map(() => '?').join(', ');
          sql += ` AND priority IN (${placeholders})`;
          params.push(...args.priority);
        } else {
          sql += ` AND priority = ?`;
          params.push(args.priority);
        }
      }

      // Date range filter
      if (args.dateFrom) {
        sql += ` AND dateRequested >= ?`;
        params.push(args.dateFrom);
      }
      if (args.dateTo) {
        sql += ` AND dateRequested <= ?`;
        params.push(args.dateTo);
      }

      // Category filter
      if (args.category) {
        sql += ` AND LOWER(category) LIKE ?`;
        params.push(`%${args.category.toLowerCase()}%`);
      }

      // Effort estimate filter
      if (args.effortEstimate) {
        if (Array.isArray(args.effortEstimate)) {
          const placeholders = args.effortEstimate.map(() => '?').join(', ');
          sql += ` AND effortEstimate IN (${placeholders})`;
          params.push(...args.effortEstimate);
        } else {
          sql += ` AND effortEstimate = ?`;
          params.push(args.effortEstimate);
        }
      }

      this.db.all(sql, params, (err: any, rows: any[]) => {
        if (err) {
          reject(new McpError(ErrorCode.InternalError, `Failed to search features: ${err.message}`));
          return;
        }

        const features = rows.map((feature: any) => ({
          type: 'feature',
          ...feature,
          acceptanceCriteria: JSON.parse(feature.acceptanceCriteria || '[]'),
          dependencies: JSON.parse(feature.dependencies || '[]')
        }));

        resolve(features);
      });
    });
  }

  private async searchImprovements(query: string, args: any): Promise<any[]> {
    return new Promise((resolve, reject) => {
      let sql = 'SELECT * FROM improvements WHERE 1=1';
      const params: any[] = [];

      // Text search
      if (query && query.trim()) {
        const searchFields = args.searchFields || ['title', 'description', 'category'];
        const searchConditions = searchFields.map((field: string) => `LOWER(${field}) LIKE ?`).join(' OR ');
        sql += ` AND (${searchConditions})`;
        searchFields.forEach(() => params.push(`%${query}%`));
      }

      // Status filter
      if (args.status) {
        if (Array.isArray(args.status)) {
          const placeholders = args.status.map(() => '?').join(', ');
          sql += ` AND status IN (${placeholders})`;
          params.push(...args.status);
        } else {
          sql += ` AND status = ?`;
          params.push(args.status);
        }
      }

      // Priority filter
      if (args.priority) {
        if (Array.isArray(args.priority)) {
          const placeholders = args.priority.map(() => '?').join(', ');
          sql += ` AND priority IN (${placeholders})`;
          params.push(...args.priority);
        } else {
          sql += ` AND priority = ?`;
          params.push(args.priority);
        }
      }

      // Date range filter
      if (args.dateFrom) {
        sql += ` AND dateRequested >= ?`;
        params.push(args.dateFrom);
      }
      if (args.dateTo) {
        sql += ` AND dateRequested <= ?`;
        params.push(args.dateTo);
      }

      // Category filter
      if (args.category) {
        sql += ` AND LOWER(category) LIKE ?`;
        params.push(`%${args.category.toLowerCase()}%`);
      }

      // Effort estimate filter
      if (args.effortEstimate) {
        if (Array.isArray(args.effortEstimate)) {
          const placeholders = args.effortEstimate.map(() => '?').join(', ');
          sql += ` AND effortEstimate IN (${placeholders})`;
          params.push(...args.effortEstimate);
        } else {
          sql += ` AND effortEstimate = ?`;
          params.push(args.effortEstimate);
        }
      }

      this.db.all(sql, params, (err: any, rows: any[]) => {
        if (err) {
          reject(new McpError(ErrorCode.InternalError, `Failed to search improvements: ${err.message}`));
          return;
        }

        const improvements = rows.map((improvement: any) => ({
          type: 'improvement',
          ...improvement,
          acceptanceCriteria: JSON.parse(improvement.acceptanceCriteria || '[]'),
          filesLikelyInvolved: JSON.parse(improvement.filesLikelyInvolved || '[]'),
          dependencies: JSON.parse(improvement.dependencies || '[]'),
          benefits: JSON.parse(improvement.benefits || '[]')
        }));

        resolve(improvements);
      });
    });
  }

  private async getStatistics(args: any) {
    return new Promise((resolve, reject) => {
      const type = args.type || 'all';
      const stats: any = {};
      let completedQueries = 0;
      const totalQueries = type === 'all' ? 3 : 1;

      const finishStats = () => {
        completedQueries++;
        if (completedQueries === totalQueries) {
          resolve({
            content: [
              {
                type: 'text',
                text: formatStatistics(stats)
              }
            ]
          });
        }
      };

      if (type === 'bugs' || type === 'all') {
        this.db.all('SELECT status, priority FROM bugs', (err: any, rows: any[]) => {
          if (err) {
            reject(new McpError(ErrorCode.InternalError, `Failed to get bug statistics: ${err.message}`));
            return;
          }

          stats.bugs = {
            total: rows.length,
            byStatus: rows.reduce((acc: any, bug: any) => {
              acc[bug.status] = (acc[bug.status] || 0) + 1;
              return acc;
            }, {}),
            byPriority: rows.reduce((acc: any, bug: any) => {
              acc[bug.priority] = (acc[bug.priority] || 0) + 1;
              return acc;
            }, {})
          };

          finishStats();
        });
      }

      if (type === 'features' || type === 'all') {
        this.db.all('SELECT status, priority FROM features', (err: any, rows: any[]) => {
          if (err) {
            reject(new McpError(ErrorCode.InternalError, `Failed to get feature statistics: ${err.message}`));
            return;
          }

          stats.features = {
            total: rows.length,
            byStatus: rows.reduce((acc: any, feature: any) => {
              acc[feature.status] = (acc[feature.status] || 0) + 1;
              return acc;
            }, {}),
            byPriority: rows.reduce((acc: any, feature: any) => {
              acc[feature.priority] = (acc[feature.priority] || 0) + 1;
              return acc;
            }, {})
          };

          finishStats();
        });
      }

      if (type === 'improvements' || type === 'all') {
        this.db.all('SELECT status, priority FROM improvements', (err: any, rows: any[]) => {
          if (err) {
            reject(new McpError(ErrorCode.InternalError, `Failed to get improvement statistics: ${err.message}`));
            return;
          }

          stats.improvements = {
            total: rows.length,
            byStatus: rows.reduce((acc: any, improvement: any) => {
              acc[improvement.status] = (acc[improvement.status] || 0) + 1;
              return acc;
            }, {}),
            byPriority: rows.reduce((acc: any, improvement: any) => {
              acc[improvement.priority] = (acc[improvement.priority] || 0) + 1;
              return acc;
            }, {})
          };

          finishStats();
        });
      }

      if (type !== 'bugs' && type !== 'features' && type !== 'improvements' && type !== 'all') {
        reject(new McpError(ErrorCode.InvalidParams, `Invalid statistics type: ${type}`));
      }
    });
  }

  private async syncFromMarkdown(args: any) {
    return {
      content: [
        {
          type: 'text',
          text: 'Markdown sync not yet implemented - would parse existing .md files and import data'
        }
      ]
    };
  }

  private async linkItems(args: any) {
    const { fromItem, toItem, relationshipType } = args;

    // Validate that both items exist
    const fromExists = await this.itemExists(fromItem);
    const toExists = await this.itemExists(toItem);

    if (!fromExists) {
      throw new McpError(ErrorCode.InvalidParams, `Source item ${fromItem} does not exist`);
    }
    if (!toExists) {
      throw new McpError(ErrorCode.InvalidParams, `Target item ${toItem} does not exist`);
    }

    return this.withTransaction(async (db) => {
      return new Promise((resolve, reject) => {
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO relationships 
          (fromItem, toItem, relationshipType, dateCreated) 
          VALUES (?, ?, ?, ?)
        `);

        const dateCreated = new Date().toISOString();

        stmt.run([fromItem, toItem, relationshipType, dateCreated], function (err) {
          if (err) {
            reject(new McpError(ErrorCode.InternalError, `Failed to create relationship: ${err.message}`));
          } else {
            resolve({
              content: [
                {
                  type: 'text',
                  text: `✓ Created relationship: ${fromItem} ${relationshipType} ${toItem}`
                }
              ]
            });
          }
        });
      });
    });
  }

  private async getRelatedItems(args: any) {
    const { itemId } = args;

    // Validate that the item exists
    const itemExists = await this.itemExists(itemId);
    if (!itemExists) {
      throw new McpError(ErrorCode.InvalidParams, `Item ${itemId} does not exist`);
    }

    return new Promise((resolve, reject) => {
      const sql = `
        SELECT fromItem, toItem, relationshipType, dateCreated 
        FROM relationships 
        WHERE fromItem = ? OR toItem = ?
      `;

      this.db.all(sql, [itemId, itemId], (err, rows: any[]) => {
        if (err) {
          reject(new McpError(ErrorCode.InternalError, `Failed to query relationships: ${err.message}`));
          return;
        }

        if (rows.length === 0) {
          resolve({
            content: [
              {
                type: 'text',
                text: `No relationships found for ${itemId}`
              }
            ]
          });
          return;
        }

        let output = `## Relationships for ${itemId}\n\n`;

        rows.forEach(row => {
          const isSource = row.fromItem === itemId;
          const relatedItem = isSource ? row.toItem : row.fromItem;
          const direction = isSource ? '→' : '←';
          output += `${direction} ${row.relationshipType} ${relatedItem}\n`;
        });

        resolve({
          content: [
            {
              type: 'text',
              text: output
            }
          ]
        });
      });
    });
  }

  private async itemExists(itemId: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const queries = [
        'SELECT 1 FROM bugs WHERE id = ?',
        'SELECT 1 FROM features WHERE id = ?',
        'SELECT 1 FROM improvements WHERE id = ?'
      ];

      let found = false;
      let completed = 0;

      queries.forEach(query => {
        this.db.get(query, [itemId], (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          if (row) {
            found = true;
          }
          completed++;
          if (completed === queries.length) {
            resolve(found);
          }
        });
      });
    });
  }

  private async bulkUpdateItems(args: any) {
    const { updates } = args;
    
    return this.withTransaction(async (db) => {
      const results: any[] = [];
      
      for (const update of updates) {
        const { itemId, status, humanVerified, dateCompleted } = update;
        
        try {
          // Determine item type from ID format and delegate to appropriate method
          if (itemId.startsWith('Bug #')) {
            const bugResult = await this.bulkUpdateBugStatus({
              updates: [{ bugId: itemId, status, humanVerified }]
            });
            results.push({
              itemId,
              status: 'success',
              message: `Updated to ${status}`,
              type: 'bug'
            });
          } else if (itemId.startsWith('FR-')) {
            const featureResult = await this.bulkUpdateFeatureStatus({
              updates: [{ featureId: itemId, status }]
            });
            results.push({
              itemId,
              status: 'success',
              message: `Updated to ${status}`,
              type: 'feature'
            });
          } else if (itemId.startsWith('IMP-')) {
            const improvementResult = await this.bulkUpdateImprovementStatus({
              updates: [{ improvementId: itemId, status, dateCompleted }]
            });
            results.push({
              itemId,
              status: 'success',
              message: `Updated to ${status}`,
              type: 'improvement'
            });
          } else {
            results.push({
              itemId,
              status: 'error',
              message: `Unknown item ID format: ${itemId}`,
              type: 'unknown'
            });
          }
        } catch (error) {
          results.push({
            itemId,
            status: 'error',
            message: `Failed to update: ${error}`,
            type: 'error'
          });
        }
      }
      
      // Format output manually since we have mixed item types
      let output = `## Bulk Update Results\n\n`;
      
      const successCount = results.filter(r => r.status === 'success').length;
      const errorCount = results.filter(r => r.status === 'error').length;
      
      output += `- **Total**: ${results.length}\n`;
      output += `- **Success**: ${successCount}\n`;
      output += `- **Errors**: ${errorCount}\n\n`;
      
      if (results.length > 0) {
        output += `### Results:\n`;
        for (const result of results) {
          const icon = result.status === 'success' ? '✅' : '❌';
          output += `${icon} **${result.itemId}**: ${result.message}\n`;
        }
      }
      
      return {
        content: [
          {
            type: 'text',
            text: output
          }
        ]
      };
    });
  }

  private async bulkUpdateBugStatus(args: any) {
    const { updates } = args;

    return this.withTransaction(async (db) => {
      const results: any[] = [];

      // First, validate all bugs exist
      for (const update of updates) {
        const bug = await new Promise((resolve, reject) => {
          db.get('SELECT * FROM bugs WHERE id = ?', [update.bugId], (err: any, row: any) => {
            if (err) reject(err);
            else resolve(row);
          });
        });

        if (!bug) {
          results.push({
            bugId: update.bugId,
            status: 'error',
            message: `Bug ${update.bugId} not found`
          });
          continue;
        }

        // Update the bug
        try {
          await new Promise((resolve, reject) => {
            const humanVerified = update.humanVerified !== undefined ? (update.humanVerified ? 1 : 0) : (bug as any).humanVerified;

            db.run(
              'UPDATE bugs SET status = ?, humanVerified = ? WHERE id = ?',
              [update.status, humanVerified, update.bugId],
              (err: any) => {
                if (err) reject(err);
                else resolve(null);
              }
            );
          });

          results.push({
            bugId: update.bugId,
            status: 'success',
            message: `Updated to ${update.status}`
          });
        } catch (error) {
          results.push({
            bugId: update.bugId,
            status: 'error',
            message: `Failed to update: ${error}`
          });
        }
      }

      const output = formatBulkUpdateResults(results, 'bugs');

      return {
        content: [
          {
            type: 'text',
            text: output
          }
        ]
      };
    });
  }

  private async bulkUpdateFeatureStatus(args: any) {
    const { updates } = args;

    return this.withTransaction(async (db) => {
      const results: any[] = [];

      // First, validate all features exist
      for (const update of updates) {
        const feature = await new Promise((resolve, reject) => {
          db.get('SELECT * FROM features WHERE id = ?', [update.featureId], (err: any, row: any) => {
            if (err) reject(err);
            else resolve(row);
          });
        });

        if (!feature) {
          results.push({
            featureId: update.featureId,
            status: 'error',
            message: `Feature ${update.featureId} not found`
          });
          continue;
        }

        // Update the feature
        try {
          await new Promise((resolve, reject) => {
            db.run(
              'UPDATE features SET status = ? WHERE id = ?',
              [update.status, update.featureId],
              (err: any) => {
                if (err) reject(err);
                else resolve(null);
              }
            );
          });

          results.push({
            featureId: update.featureId,
            status: 'success',
            message: `Updated to ${update.status}`
          });
        } catch (error) {
          results.push({
            featureId: update.featureId,
            status: 'error',
            message: `Failed to update: ${error}`
          });
        }
      }

      const output = formatBulkUpdateResults(results, 'features');

      return {
        content: [
          {
            type: 'text',
            text: output
          }
        ]
      };
    });
  }



  private async bulkUpdateImprovementStatus(args: any) {
    const { updates } = args;

    return this.withTransaction(async (db) => {
      const results: any[] = [];

      // First, validate all improvements exist
      for (const update of updates) {
        const improvement = await new Promise((resolve, reject) => {
          db.get('SELECT * FROM improvements WHERE id = ?', [update.improvementId], (err: any, row: any) => {
            if (err) reject(err);
            else resolve(row);
          });
        });

        if (!improvement) {
          results.push({
            improvementId: update.improvementId,
            status: 'error',
            message: `Improvement ${update.improvementId} not found`
          });
          continue;
        }

        // Update the improvement
        try {
          await new Promise((resolve, reject) => {
            const dateCompleted = update.dateCompleted || (improvement as any).dateCompleted;

            db.run(
              'UPDATE improvements SET status = ?, dateCompleted = ? WHERE id = ?',
              [update.status, dateCompleted, update.improvementId],
              (err: any) => {
                if (err) reject(err);
                else resolve(null);
              }
            );
          });

          results.push({
            improvementId: update.improvementId,
            status: 'success',
            message: `Updated to ${update.status}`,
            dateCompleted: update.dateCompleted
          });
        } catch (error) {
          results.push({
            improvementId: update.improvementId,
            status: 'error',
            message: `Failed to update: ${error}`
          });
        }
      }

      const output = formatBulkUpdateResults(results, 'improvements');

      return {
        content: [
          {
            type: 'text',
            text: output
          }
        ]
      };
    });
  }

  private async executeWorkflow(args: any) {
    const { workflow, ...workflowArgs } = args;
    
    try {
      switch (workflow) {
        case 'create_and_link':
          return await this.executeCreateAndLinkWorkflow(workflowArgs);
        case 'batch_context_collection':
          return await this.executeBatchContextWorkflow(workflowArgs);
        case 'status_transition':
          return await this.executeStatusTransitionWorkflow(workflowArgs);
        default:
          throw new McpError(ErrorCode.InvalidParams, `Unknown workflow: ${workflow}`);
      }
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to execute workflow: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async executeCreateAndLinkWorkflow(args: any) {
    const { items } = args;
    const results: any[] = [];
    
    for (const item of items) {
      try {
        // Create the item
        const createResult = await this.createItem({ type: item.type, ...item.data });
        
        // Extract the created item ID from the response
        const createdId = this.extractIdFromCreateResponse(createResult, item.type);
        
        // Link the item if linkTo is specified
        if (item.linkTo) {
          await this.linkItems({
            fromItem: createdId,
            toItem: item.linkTo,
            relationshipType: item.relationshipType || 'relates_to'
          });
        }
        
        results.push({
          action: 'create_and_link',
          itemId: createdId,
          status: 'success',
          message: `Created and ${item.linkTo ? 'linked to ' + item.linkTo : 'completed'}`
        });
      } catch (error) {
        results.push({
          action: 'create_and_link',
          status: 'error',
          message: `Failed: ${error}`
        });
      }
    }
    
    return {
      content: [{
        type: 'text',
        text: this.formatWorkflowResults('create_and_link', results)
      }]
    };
  }

  private async executeBatchContextWorkflow(args: any) {
    const { tasks } = args;
    const results: any[] = [];
    
    for (const task of tasks) {
      try {
        const contextResult = await this.manageContexts({
          operation: 'collect',
          taskId: task.taskId,
          taskType: task.taskType,
          title: task.title,
          description: task.description
        });
        
        results.push({
          action: 'collect_context',
          taskId: task.taskId,
          status: 'success',
          message: 'Context collected successfully'
        });
      } catch (error) {
        results.push({
          action: 'collect_context',
          taskId: task.taskId,
          status: 'error',
          message: `Failed: ${error}`
        });
      }
    }
    
    return {
      content: [{
        type: 'text',
        text: this.formatWorkflowResults('batch_context_collection', results)
      }]
    };
  }

  private async executeStatusTransitionWorkflow(args: any) {
    const { transitions } = args;
    const results: any[] = [];
    
    for (const transition of transitions) {
      try {
        // Verify transition is valid if requested
        if (transition.verifyTransition) {
          const isValid = await this.verifyStatusTransition(transition.itemId, transition.fromStatus, transition.toStatus);
          if (!isValid) {
            results.push({
              action: 'status_transition',
              itemId: transition.itemId,
              status: 'error',
              message: `Invalid transition from ${transition.fromStatus} to ${transition.toStatus}`
            });
            continue;
          }
        }
        
        // Execute the status update
        await this.updateItemStatus({
          itemId: transition.itemId,
          status: transition.toStatus
        });
        
        results.push({
          action: 'status_transition',
          itemId: transition.itemId,
          status: 'success',
          message: `Updated from ${transition.fromStatus} to ${transition.toStatus}`
        });
      } catch (error) {
        results.push({
          action: 'status_transition',
          itemId: transition.itemId,
          status: 'error',
          message: `Failed: ${error}`
        });
      }
    }
    
    return {
      content: [{
        type: 'text',
        text: this.formatWorkflowResults('status_transition', results)
      }]
    };
  }

  private extractIdFromCreateResponse(response: any, type: string): string {
    const text = response.content[0].text;
    const match = text.match(/Created new \w+: ([^\s]+)/);
    return match ? match[1] : '';
  }

  private async verifyStatusTransition(itemId: string, fromStatus: string, toStatus: string): Promise<boolean> {
    // This is a simplified implementation - in reality, you'd want to define valid transitions
    return true;
  }

  private formatWorkflowResults(workflowType: string, results: any[]): string {
    let output = `## Workflow Results: ${workflowType}\n\n`;
    
    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    
    output += `- **Total**: ${results.length}\n`;
    output += `- **Success**: ${successCount}\n`;
    output += `- **Errors**: ${errorCount}\n\n`;
    
    if (results.length > 0) {
      output += `### Results:\n`;
      for (const result of results) {
        const icon = result.status === 'success' ? '✅' : '❌';
        const identifier = result.itemId || result.taskId || 'Unknown';
        output += `${icon} **${identifier}**: ${result.message}\n`;
      }
    }
    
    return output;
  }

  private async manageContexts(args: any) {
    const { operation, taskId, ...operationArgs } = args;
    
    try {
      switch (operation) {
        case 'collect':
          return await this.collectContextForTask({ taskId, ...operationArgs });
        case 'get':
          return await this.getTaskContexts({ taskId });
        case 'check_freshness':
          return await this.checkContextFreshness({ taskId });
        case 'add':
          return await this.addManualContext({ 
            taskId, 
            taskType: operationArgs.taskType,
            contextType: operationArgs.contextType,
            filePath: operationArgs.filePath,
            startLine: operationArgs.startLine,
            endLine: operationArgs.endLine,
            content: operationArgs.content,
            description: operationArgs.contextDescription,
            relevanceScore: operationArgs.relevanceScore,
            keywords: operationArgs.keywords
          });
        case 'update':
          return await this.updateContext({ 
            contextId: operationArgs.contextId, 
            updates: operationArgs.updates 
          });
        case 'remove':
          return await this.removeContext({ contextId: operationArgs.contextId });
        default:
          throw new McpError(ErrorCode.InvalidParams, `Unknown context operation: ${operation}`);
      }
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to manage contexts: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async collectContextForTask(args: any) {
    try {
      const taskInput: TaskAnalysisInput = {
        taskId: args.taskId,
        taskType: args.taskType,
        title: args.title,
        description: args.description,
        currentState: args.currentState,
        desiredState: args.desiredState,
        expectedBehavior: args.expectedBehavior,
        actualBehavior: args.actualBehavior,
        filesLikelyInvolved: args.filesLikelyInvolved || [],
        keywords: args.keywords || [],
        entities: args.entities || []
      };

      const result = await this.contextEngine.collectContexts(taskInput);
      
      // Store contexts in database
      await this.storeContextsInDatabase(result.contexts);
      
      return {
        content: [
          {
            type: 'text',
            text: this.formatContextCollectionResult(result)
          }
        ]
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to collect context: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async getTaskContexts(args: any) {
    try {
      const taskId = args.taskId;
      const contexts = await this.getContextsFromDatabase(taskId);
      
      return {
        content: [
          {
            type: 'text',
            text: this.formatContexts(contexts)
          }
        ]
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to get contexts: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async checkContextFreshness(args: any) {
    try {
      const taskId = args.taskId;
      const contexts = await this.getContextsFromDatabase(taskId);
      
      return {
        content: [
          {
            type: 'text',
            text: `Context freshness checking not yet implemented - found ${contexts.length} contexts for task ${taskId}`
          }
        ]
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to check freshness: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async addManualContext(args: any) {
    try {
      const context: CodeContext = {
        id: `${args.taskId}_manual_${Date.now()}`,
        taskId: args.taskId,
        taskType: args.taskType,
        contextType: args.contextType || 'snippet',
        source: 'manual',
        filePath: args.filePath,
        startLine: args.startLine,
        endLine: args.endLine,
        content: args.content,
        description: args.description,
        relevanceScore: args.relevanceScore || 0.8,
        keywords: args.keywords || [],
        dateCollected: new Date().toISOString(),
        isStale: false
      };

      await this.storeContextsInDatabase([context]);
      
      return {
        content: [
          {
            type: 'text',
            text: `Added manual context: ${context.description}`
          }
        ]
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to add manual context: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async updateContext(args: any) {
    try {
      const contextId = args.contextId;
      const updates = args.updates;
      
      await this.updateContextInDatabase(contextId, updates);
      
      return {
        content: [
          {
            type: 'text',
            text: `Updated context: ${contextId}`
          }
        ]
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to update context: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async removeContext(args: any) {
    try {
      const contextId = args.contextId;
      
      await this.removeContextFromDatabase(contextId);
      
      return {
        content: [
          {
            type: 'text',
            text: `Removed context: ${contextId}`
          }
        ]
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to remove context: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async storeContextsInDatabase(contexts: CodeContext[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO code_contexts 
        (id, task_id, task_type, context_type, source, file_path, start_line, end_line, content, description, relevance_score, keywords, date_collected, date_last_checked, is_stale)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const context of contexts) {
        stmt.run([
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
        ]);
      }

      stmt.finalize((err) => {
        if (err) {
          reject(new McpError(ErrorCode.InternalError, `Failed to store contexts: ${err.message}`));
        } else {
          resolve();
        }
      });
    });
  }

  private async getContextsFromDatabase(taskId: string): Promise<CodeContext[]> {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM code_contexts WHERE task_id = ? ORDER BY relevance_score DESC',
        [taskId],
        (err: any, rows: any[]) => {
          if (err) {
            reject(new McpError(ErrorCode.InternalError, `Failed to get contexts: ${err.message}`));
            return;
          }

          const contexts = rows.map((row: any) => ({
            id: row.id,
            taskId: row.task_id,
            taskType: row.task_type,
            contextType: row.context_type,
            source: row.source,
            filePath: row.file_path,
            startLine: row.start_line,
            endLine: row.end_line,
            content: row.content,
            description: row.description,
            relevanceScore: row.relevance_score,
            keywords: JSON.parse(row.keywords || '[]'),
            dateCollected: row.date_collected,
            dateLastChecked: row.date_last_checked,
            isStale: !!row.is_stale
          }));

          resolve(contexts);
        }
      );
    });
  }

  private async updateContextInDatabase(contextId: string, updates: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const fields = [];
      const values = [];

      for (const [key, value] of Object.entries(updates)) {
        const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        fields.push(`${dbKey} = ?`);
        values.push(value);
      }

      values.push(contextId);

      this.db.run(
        `UPDATE code_contexts SET ${fields.join(', ')} WHERE id = ?`,
        values,
        (err: any) => {
          if (err) {
            reject(new McpError(ErrorCode.InternalError, `Failed to update context: ${err.message}`));
          } else {
            resolve();
          }
        }
      );
    });
  }

  private async removeContextFromDatabase(contextId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        'DELETE FROM code_contexts WHERE id = ?',
        [contextId],
        (err: any) => {
          if (err) {
            reject(new McpError(ErrorCode.InternalError, `Failed to remove context: ${err.message}`));
          } else {
            resolve();
          }
        }
      );
    });
  }

  private formatContextCollectionResult(result: ContextCollectionResult): string {
    let output = `# Context Collection Result\n\n`;
    
    output += `## Summary\n`;
    output += `- Total contexts: ${result.summary.totalContexts}\n`;
    output += `- High relevance: ${result.summary.highRelevanceContexts}\n`;
    output += `- Medium relevance: ${result.summary.mediumRelevanceContexts}\n`;
    output += `- Low relevance: ${result.summary.lowRelevanceContexts}\n`;
    output += `- Average relevance: ${result.summary.averageRelevanceScore.toFixed(2)}\n`;
    output += `- Processing time: ${result.summary.processingTimeMs}ms\n`;
    output += `- Files analyzed: ${result.summary.filesAnalyzed}\n`;
    output += `- Patterns found: ${result.summary.patternsFound}\n`;
    output += `- Dependencies analyzed: ${result.summary.dependenciesAnalyzed}\n\n`;
    
    if (result.contexts.length > 0) {
      output += `## Contexts\n`;
      for (const context of result.contexts) {
        output += `### ${context.description}\n`;
        output += `- **File**: ${context.filePath}\n`;
        output += `- **Lines**: ${context.startLine || 'N/A'} - ${context.endLine || 'N/A'}\n`;
        output += `- **Relevance**: ${context.relevanceScore.toFixed(2)}\n`;
        output += `- **Keywords**: ${context.keywords.join(', ')}\n`;
        if (context.content) {
          output += `- **Content**:\n\`\`\`\n${context.content.slice(0, 500)}${context.content.length > 500 ? '...' : ''}\n\`\`\`\n`;
        }
        output += `\n`;
      }
    }
    
    if (result.recommendations.length > 0) {
      output += `## Recommendations\n`;
      for (const rec of result.recommendations) {
        output += `- ${rec}\n`;
      }
      output += `\n`;
    }
    
    if (result.potentialIssues.length > 0) {
      output += `## Potential Issues\n`;
      for (const issue of result.potentialIssues) {
        output += `- ${issue}\n`;
      }
      output += `\n`;
    }
    
    return output;
  }

  private formatContexts(contexts: CodeContext[]): string {
    if (contexts.length === 0) {
      return 'No contexts found for this task.';
    }

    let output = `# Task Contexts (${contexts.length})\n\n`;
    
    for (const context of contexts) {
      output += `## ${context.description}\n`;
      output += `- **ID**: ${context.id}\n`;
      output += `- **Type**: ${context.contextType}\n`;
      output += `- **Source**: ${context.source}\n`;
      output += `- **File**: ${context.filePath}\n`;
      if (context.startLine) {
        output += `- **Lines**: ${context.startLine} - ${context.endLine}\n`;
      }
      output += `- **Relevance**: ${context.relevanceScore.toFixed(2)}\n`;
      output += `- **Keywords**: ${context.keywords.join(', ')}\n`;
      output += `- **Date Collected**: ${context.dateCollected}\n`;
      if (context.isStale) {
        output += `- **Status**: ⚠️ STALE\n`;
      } else {
        output += `- **Status**: ✅ Fresh\n`;
      }
      
      if (context.content) {
        output += `\n\`\`\`\n${context.content.slice(0, 1000)}${context.content.length > 1000 ? '...' : ''}\n\`\`\`\n`;
      }
      output += `\n`;
    }
    
    return output;
  }


  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'create_item',
          description: 'Create a new bug, feature request, or improvement',
          inputSchema: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['bug', 'feature', 'improvement'], description: 'Type of item to create' },
              title: { type: 'string', description: 'Item title' },
              description: { type: 'string', description: 'Detailed item description' },
              priority: { type: 'string', enum: ['Low', 'Medium', 'High', 'Critical'], description: 'Item priority' },
              // Bug-specific fields
              component: { type: 'string', description: 'Component affected (bugs only)' },
              expectedBehavior: { type: 'string', description: 'What should happen (bugs/features)' },
              actualBehavior: { type: 'string', description: 'What actually happens (bugs only)' },
              potentialRootCause: { type: 'string', description: 'Hypothesis about the cause (bugs only)' },
              filesLikelyInvolved: { type: 'array', items: { type: 'string' }, description: 'Files that might be involved (bugs/improvements)' },
              stepsToReproduce: { type: 'array', items: { type: 'string' }, description: 'Steps to reproduce (bugs only)' },
              // Feature-specific fields
              category: { type: 'string', description: 'Category (features/improvements)' },
              userStory: { type: 'string', description: 'User story format (features only)' },
              currentBehavior: { type: 'string', description: 'Current system behavior (features only)' },
              acceptanceCriteria: { type: 'array', items: { type: 'string' }, description: 'Acceptance criteria checklist (features/improvements)' },
              requestedBy: { type: 'string', description: 'Who requested this (features/improvements)' },
              effortEstimate: { type: 'string', enum: ['Small', 'Medium', 'Large', 'XL'], description: 'Effort estimate (features/improvements)' },
              // Improvement-specific fields
              currentState: { type: 'string', description: 'Current state (improvements only)' },
              desiredState: { type: 'string', description: 'Desired state after improvement (improvements only)' }
            },
            required: ['type', 'title', 'description', 'priority']
          }
        },
        {
          name: 'list_items',
          description: 'List bugs, features, or improvements with optional filtering',
          inputSchema: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['bug', 'feature', 'improvement'], description: 'Type of items to list' },
              status: { type: 'string', description: 'Filter by status (status values depend on item type)' },
              priority: { type: 'string', enum: ['Low', 'Medium', 'High', 'Critical'], description: 'Filter by priority' },
              component: { type: 'string', description: 'Filter by component (bugs only)' },
              category: { type: 'string', description: 'Filter by category (features/improvements)' },
              includeCodeContext: { type: 'boolean', description: 'Include relevant code sections and file context (improvements only)' }
            },
            required: ['type']
          }
        },
        {
          name: 'update_item_status',
          description: 'Update status of a bug, feature request, or improvement',
          inputSchema: {
            type: 'object',
            properties: {
              itemId: { type: 'string', description: 'Item ID (e.g., Bug #001, FR-001, IMP-001)' },
              status: { type: 'string', description: 'New status (valid values depend on item type)' },
              humanVerified: { type: 'boolean', description: 'Whether human verification is complete (bugs only)' },
              dateCompleted: { type: 'string', description: 'Completion date YYYY-MM-DD (improvements only)' }
            },
            required: ['itemId', 'status']
          }
        },
        {
          name: 'search_items',
          description: 'Advanced search across bugs, features, and improvements with filtering, sorting, and pagination',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query (optional - can search with filters only)' },
              type: { type: 'string', enum: ['bugs', 'features', 'improvements', 'all'], description: 'Type of items to search' },
              searchFields: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific fields to search in (e.g., ["title", "description"]). Defaults to title, description, and category/component'
              },
              status: {
                type: ['string', 'array'],
                description: 'Filter by status (single value or array of values)'
              },
              priority: {
                type: ['string', 'array'],
                description: 'Filter by priority (single value or array of values)'
              },
              category: { type: 'string', description: 'Filter by category (partial match)' },
              component: { type: 'string', description: 'Filter by component (partial match, bugs only)' },
              dateFrom: { type: 'string', description: 'Start date for date range filter (YYYY-MM-DD)' },
              dateTo: { type: 'string', description: 'End date for date range filter (YYYY-MM-DD)' },
              effortEstimate: {
                type: ['string', 'array'],
                description: 'Filter by effort estimate (features/improvements only)'
              },
              humanVerified: { type: 'boolean', description: 'Filter by human verification status (bugs only)' },
              sortBy: {
                type: 'string',
                enum: ['date', 'priority', 'title', 'status'],
                description: 'Sort results by field (default: date)'
              },
              sortOrder: {
                type: 'string',
                enum: ['asc', 'desc'],
                description: 'Sort order (default: desc)'
              },
              limit: { type: 'number', description: 'Maximum number of results to return' },
              offset: { type: 'number', description: 'Number of results to skip (for pagination)' }
            }
          }
        },
        {
          name: 'get_statistics',
          description: 'Get project statistics',
          inputSchema: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['bugs', 'features', 'improvements', 'all'], description: 'Type of statistics to generate' }
            }
          }
        },
        {
          name: 'sync_from_markdown',
          description: 'Synchronize data from existing markdown files',
          inputSchema: {
            type: 'object',
            properties: {
              force: { type: 'boolean', description: 'Force sync even if data exists' }
            }
          }
        },
        {
          name: 'link_items',
          description: 'Create relationships between bugs, features, and improvements',
          inputSchema: {
            type: 'object',
            properties: {
              fromItem: { type: 'string', description: 'Source item ID (e.g., Bug #001, FR-001, IMP-001)' },
              toItem: { type: 'string', description: 'Target item ID (e.g., Bug #002, FR-002, IMP-002)' },
              relationshipType: {
                type: 'string',
                enum: ['blocks', 'relates_to', 'duplicate_of'],
                description: 'Type of relationship between items'
              }
            },
            required: ['fromItem', 'toItem', 'relationshipType']
          }
        },
        {
          name: 'get_related_items',
          description: 'Get items related to a specific item',
          inputSchema: {
            type: 'object',
            properties: {
              itemId: { type: 'string', description: 'Item ID to find relationships for (e.g., Bug #001, FR-001, IMP-001)' }
            },
            required: ['itemId']
          }
        },
        {
          name: 'bulk_update_items',
          description: 'Update multiple items (bugs, features, or improvements) in a single operation',
          inputSchema: {
            type: 'object',
            properties: {
              updates: {
                type: 'array',
                description: 'Array of item updates to perform',
                items: {
                  type: 'object',
                  properties: {
                    itemId: { type: 'string', description: 'Item ID (e.g., Bug #001, FR-001, IMP-001)' },
                    status: { type: 'string', description: 'New status (valid values depend on item type)' },
                    humanVerified: { type: 'boolean', description: 'Whether human verification is complete (bugs only)' },
                    dateCompleted: { type: 'string', description: 'Completion date YYYY-MM-DD (improvements only)' }
                  },
                  required: ['itemId', 'status']
                }
              }
            },
            required: ['updates']
          }
        },
        {
          name: 'execute_workflow',
          description: 'Execute predefined workflows for common multi-step operations',
          inputSchema: {
            type: 'object',
            properties: {
              workflow: {
                type: 'string',
                enum: ['create_and_link', 'batch_context_collection', 'status_transition'],
                description: 'The workflow to execute'
              },
              // Fields for create_and_link workflow
              items: {
                type: 'array',
                description: 'Items to create and link (for create_and_link workflow)',
                items: {
                  type: 'object',
                  properties: {
                    type: { type: 'string', enum: ['bug', 'feature', 'improvement'] },
                    data: { type: 'object', description: 'Item data' },
                    linkTo: { type: 'string', description: 'ID of item to link to' },
                    relationshipType: { type: 'string', enum: ['blocks', 'relates_to', 'duplicate_of'] }
                  }
                }
              },
              // Fields for batch_context_collection workflow
              tasks: {
                type: 'array',
                description: 'Tasks to collect contexts for (for batch_context_collection workflow)',
                items: {
                  type: 'object',
                  properties: {
                    taskId: { type: 'string' },
                    taskType: { type: 'string', enum: ['bug', 'feature', 'improvement'] },
                    title: { type: 'string' },
                    description: { type: 'string' }
                  }
                }
              },
              // Fields for status_transition workflow
              transitions: {
                type: 'array',
                description: 'Status transitions to perform (for status_transition workflow)',
                items: {
                  type: 'object',
                  properties: {
                    itemId: { type: 'string' },
                    fromStatus: { type: 'string' },
                    toStatus: { type: 'string' },
                    verifyTransition: { type: 'boolean', description: 'Whether to verify transition is valid' }
                  }
                }
              }
            },
            required: ['workflow']
          }
        },
        {
          name: 'manage_contexts',
          description: 'Unified context management for tasks - collect, get, check freshness, add, update, or remove contexts',
          inputSchema: {
            type: 'object',
            properties: {
              operation: {
                type: 'string',
                enum: ['collect', 'get', 'check_freshness', 'add', 'update', 'remove'],
                description: 'The context operation to perform'
              },
              taskId: { type: 'string', description: 'Task ID' },
              taskType: { type: 'string', enum: ['bug', 'feature', 'improvement'], description: 'Type of task (required for collect/add operations)' },
              // Fields for collect operation
              title: { type: 'string', description: 'Task title (for collect operation)' },
              description: { type: 'string', description: 'Task description (for collect operation)' },
              currentState: { type: 'string', description: 'Current state (for improvements, collect operation)' },
              desiredState: { type: 'string', description: 'Desired state (for improvements, collect operation)' },
              expectedBehavior: { type: 'string', description: 'Expected behavior (for bugs, collect operation)' },
              actualBehavior: { type: 'string', description: 'Actual behavior (for bugs, collect operation)' },
              filesLikelyInvolved: { type: 'array', items: { type: 'string' }, description: 'Files likely involved (for collect operation)' },
              keywords: { type: 'array', items: { type: 'string' }, description: 'Additional keywords (for collect operation)' },
              entities: { type: 'array', items: { type: 'string' }, description: 'Additional entities (for collect operation)' },
              // Fields for add operation
              contextType: { type: 'string', enum: ['snippet', 'file_reference', 'dependency', 'pattern'], description: 'Type of context (for add operation)' },
              filePath: { type: 'string', description: 'Path to the file (for add operation)' },
              startLine: { type: 'number', description: 'Start line number (for add operation)' },
              endLine: { type: 'number', description: 'End line number (for add operation)' },
              content: { type: 'string', description: 'Context content (for add operation)' },
              contextDescription: { type: 'string', description: 'Context description (for add operation)' },
              relevanceScore: { type: 'number', description: 'Relevance score 0-1 (for add operation)' },
              // Fields for update/remove operations
              contextId: { type: 'string', description: 'Context ID (for update/remove operations)' },
              updates: { type: 'object', description: 'Updates to apply (for update operation)' }
            },
            required: ['operation', 'taskId']
          }
        }
      ]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'create_item':
            return await this.createItem(args) as any;
          case 'list_items':
            return await this.listItems(args) as any;
          case 'update_item_status':
            return await this.updateItemStatus(args) as any;
          case 'search_items':
            return await this.searchItems(args) as any;
          case 'get_statistics':
            return await this.getStatistics(args) as any;
          case 'sync_from_markdown':
            return await this.syncFromMarkdown(args) as any;
          case 'link_items':
            return await this.linkItems(args) as any;
          case 'get_related_items':
            return await this.getRelatedItems(args) as any;
          case 'bulk_update_items':
            return await this.bulkUpdateItems(args) as any;
          case 'execute_workflow':
            return await this.executeWorkflow(args) as any;
          case 'manage_contexts':
            return await this.manageContexts(args) as any;
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(ErrorCode.InternalError, `Error executing tool ${name}: ${error}`);
      }
    });
  }

  async run() {
    try {
      await this.initDb();
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error('Bugger MCP server running on stdio');
    } catch (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
  }
}

async function main() {
  const server = new ProjectManagementServer();
  await server.run();
}

main().catch(console.error);