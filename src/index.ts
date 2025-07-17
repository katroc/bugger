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

class ProjectManagementServer {
  private server: Server;
  private db!: sqlite3.Database;

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
        effortEstimate: args.effortEstimate
      };

      return new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO improvements (id, status, priority, dateRequested, category, requestedBy, title, description, currentState, desiredState, acceptanceCriteria, effortEstimate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [newImprovement.id, newImprovement.status, newImprovement.priority, newImprovement.dateRequested, newImprovement.category, newImprovement.requestedBy, newImprovement.title, newImprovement.description, newImprovement.currentState, newImprovement.desiredState, JSON.stringify(newImprovement.acceptanceCriteria), newImprovement.effortEstimate],
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
    // Simple keyword extraction - remove common words and keep significant terms
    const commonWords = new Set([
      'the', 'and', 'or', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'with', 'by',
      'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
      'do', 'does', 'did', 'will', 'would', 'should', 'could', 'can', 'may', 'might',
      'must', 'shall', 'should', 'this', 'that', 'these', 'those', 'it', 'they',
      'we', 'you', 'he', 'she', 'him', 'her', 'them', 'their', 'our', 'your',
      'of', 'from', 'as', 'but', 'not', 'no', 'yes', 'all', 'any', 'some', 'many',
      'few', 'most', 'other', 'another', 'such', 'what', 'which', 'who', 'whom',
      'whose', 'when', 'where', 'why', 'how'
    ]);

    // Extract words, filter common words, and keep words longer than 3 characters
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3 && !commonWords.has(word));

    // Count word frequency
    const wordCount = new Map<string, number>();
    words.forEach(word => {
      wordCount.set(word, (wordCount.get(word) || 0) + 1);
    });

    // Sort by frequency and take top 10
    return Array.from(wordCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(entry => entry[0]);
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

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'create_bug',
          description: 'Create a new bug report',
          inputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Bug title' },
              description: { type: 'string', description: 'Detailed bug description' },
              component: { type: 'string', description: 'Component affected' },
              priority: { type: 'string', enum: ['Low', 'Medium', 'High', 'Critical'] },
              expectedBehavior: { type: 'string', description: 'What should happen' },
              actualBehavior: { type: 'string', description: 'What actually happens' },
              potentialRootCause: { type: 'string', description: 'Hypothesis about the cause' },
              filesLikelyInvolved: { type: 'array', items: { type: 'string' }, description: 'Files that might be involved' },
              stepsToReproduce: { type: 'array', items: { type: 'string' }, description: 'Steps to reproduce the bug' }
            },
            required: ['title', 'description', 'component', 'priority', 'expectedBehavior', 'actualBehavior']
          }
        },
        {
          name: 'create_feature_request',
          description: 'Create a new feature request',
          inputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Feature title' },
              description: { type: 'string', description: 'Detailed feature description' },
              category: { type: 'string', description: 'Feature category' },
              priority: { type: 'string', enum: ['Low', 'Medium', 'High', 'Critical'] },
              userStory: { type: 'string', description: 'User story format' },
              currentBehavior: { type: 'string', description: 'Current system behavior' },
              expectedBehavior: { type: 'string', description: 'Expected behavior after implementation' },
              acceptanceCriteria: { type: 'array', items: { type: 'string' }, description: 'Acceptance criteria checklist' },
              requestedBy: { type: 'string', description: 'Who requested this feature' },
              effortEstimate: { type: 'string', enum: ['Small', 'Medium', 'Large', 'XL'] }
            },
            required: ['title', 'description', 'category', 'priority', 'userStory', 'currentBehavior', 'expectedBehavior', 'acceptanceCriteria']
          }
        },
        {
          name: 'create_improvement',
          description: 'Create a new improvement',
          inputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Improvement title' },
              description: { type: 'string', description: 'Detailed improvement description' },
              category: { type: 'string', description: 'Improvement category' },
              priority: { type: 'string', enum: ['Low', 'Medium', 'High'] },
              currentState: { type: 'string', description: 'Current state' },
              desiredState: { type: 'string', description: 'Desired state after improvement' },
              acceptanceCriteria: { type: 'array', items: { type: 'string' }, description: 'Acceptance criteria checklist' },
              requestedBy: { type: 'string', description: 'Who requested this improvement' },
              effortEstimate: { type: 'string', enum: ['Small', 'Medium', 'Large'] }
            },
            required: ['title', 'description', 'category', 'priority', 'currentState', 'desiredState', 'acceptanceCriteria']
          }
        },
        {
          name: 'list_bugs',
          description: 'List bugs with optional filtering',
          inputSchema: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['Open', 'In Progress', 'Fixed', 'Closed', 'Temporarily Resolved'] },
              priority: { type: 'string', enum: ['Low', 'Medium', 'High', 'Critical'] },
              component: { type: 'string' }
            }
          }
        },
        {
          name: 'list_feature_requests',
          description: 'List feature requests with optional filtering',
          inputSchema: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['Proposed', 'In Discussion', 'Approved', 'In Development', 'Research Phase', 'Partially Implemented', 'Completed', 'Rejected'] },
              priority: { type: 'string', enum: ['Low', 'Medium', 'High', 'Critical'] },
              category: { type: 'string' }
            }
          }
        },
        {
          name: 'list_improvements',
          description: 'List improvements with optional filtering and code context',
          inputSchema: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['Proposed', 'In Discussion', 'Approved', 'In Development', 'Completed (Awaiting Human Verification)', 'Completed', 'Rejected'] },
              priority: { type: 'string', enum: ['Low', 'Medium', 'High'] },
              category: { type: 'string' },
              includeCodeContext: { type: 'boolean', description: 'Include relevant code sections and file context' }
            }
          }
        },
        {
          name: 'update_bug_status',
          description: 'Update bug status',
          inputSchema: {
            type: 'object',
            properties: {
              bugId: { type: 'string', description: 'Bug ID (e.g., Bug #001)' },
              status: { type: 'string', enum: ['Open', 'In Progress', 'Fixed', 'Closed', 'Temporarily Resolved'] },
              humanVerified: { type: 'boolean', description: 'Whether human verification is complete' }
            },
            required: ['bugId', 'status']
          }
        },
        {
          name: 'update_feature_status',
          description: 'Update feature request status',
          inputSchema: {
            type: 'object',
            properties: {
              featureId: { type: 'string', description: 'Feature ID (e.g., FR-001)' },
              status: { type: 'string', enum: ['Proposed', 'In Discussion', 'Approved', 'In Development', 'Research Phase', 'Partially Implemented', 'Completed', 'Rejected'] }
            },
            required: ['featureId', 'status']
          }
        },
        {
          name: 'update_improvement_status',
          description: 'Update improvement status',
          inputSchema: {
            type: 'object',
            properties: {
              improvementId: { type: 'string', description: 'Improvement ID (e.g., IMP-001)' },
              status: { type: 'string', enum: ['Proposed', 'In Discussion', 'Approved', 'In Development', 'Completed (Awaiting Human Verification)', 'Completed', 'Rejected'] },
              dateCompleted: { type: 'string', description: 'Completion date (YYYY-MM-DD)' }
            },
            required: ['improvementId', 'status']
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
          name: 'bulk_update_bug_status',
          description: 'Update multiple bug statuses in a single operation',
          inputSchema: {
            type: 'object',
            properties: {
              updates: {
                type: 'array',
                description: 'Array of bug updates to perform',
                items: {
                  type: 'object',
                  properties: {
                    bugId: { type: 'string', description: 'Bug ID (e.g., Bug #001)' },
                    status: { type: 'string', enum: ['Open', 'In Progress', 'Fixed', 'Closed', 'Temporarily Resolved'] },
                    humanVerified: { type: 'boolean', description: 'Whether human verification is complete' }
                  },
                  required: ['bugId', 'status']
                }
              }
            },
            required: ['updates']
          }
        },
        {
          name: 'bulk_update_feature_status',
          description: 'Update multiple feature request statuses in a single operation',
          inputSchema: {
            type: 'object',
            properties: {
              updates: {
                type: 'array',
                description: 'Array of feature updates to perform',
                items: {
                  type: 'object',
                  properties: {
                    featureId: { type: 'string', description: 'Feature ID (e.g., FR-001)' },
                    status: { type: 'string', enum: ['Proposed', 'In Discussion', 'Approved', 'In Development', 'Research Phase', 'Partially Implemented', 'Completed', 'Rejected'] }
                  },
                  required: ['featureId', 'status']
                }
              }
            },
            required: ['updates']
          }
        },
        {
          name: 'bulk_update_improvement_status',
          description: 'Update multiple improvement statuses in a single operation',
          inputSchema: {
            type: 'object',
            properties: {
              updates: {
                type: 'array',
                description: 'Array of improvement updates to perform',
                items: {
                  type: 'object',
                  properties: {
                    improvementId: { type: 'string', description: 'Improvement ID (e.g., IMP-001)' },
                    status: { type: 'string', enum: ['Proposed', 'In Discussion', 'Approved', 'In Development', 'Completed (Awaiting Human Verification)', 'Completed', 'Rejected'] },
                    dateCompleted: { type: 'string', description: 'Completion date (YYYY-MM-DD)' }
                  },
                  required: ['improvementId', 'status']
                }
              }
            },
            required: ['updates']
          }
        }
      ]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'create_bug':
            return await this.createBug(args) as any;
          case 'create_feature_request':
            return await this.createFeatureRequest(args) as any;
          case 'create_improvement':
            return await this.createImprovement(args) as any;
          case 'list_bugs':
            return await this.listBugs(args) as any;
          case 'list_feature_requests':
            return await this.listFeatureRequests(args) as any;
          case 'list_improvements':
            return await this.listImprovements(args) as any;
          case 'update_bug_status':
            return await this.updateBugStatus(args) as any;
          case 'update_feature_status':
            return await this.updateFeatureStatus(args) as any;
          case 'update_improvement_status':
            return await this.updateImprovementStatus(args) as any;
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
          case 'bulk_update_bug_status':
            return await this.bulkUpdateBugStatus(args) as any;
          case 'bulk_update_feature_status':
            return await this.bulkUpdateFeatureStatus(args) as any;
          case 'bulk_update_improvement_status':
            return await this.bulkUpdateImprovementStatus(args) as any;
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