#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { formatBugs, formatFeatureRequests, formatImprovements, formatSearchResults, formatStatistics } from './format.js';
import sqlite3 from 'sqlite3';

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

      this.db.all(query, params, (err: any, rows: any[]) => {
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

        resolve({
          content: [
            {
              type: 'text',
              text: formatImprovements(improvements)
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
      const query = args.query.toLowerCase();
      const searchType = args.type || 'all';
      const results: any[] = [];
      let completedQueries = 0;
      const totalQueries = searchType === 'all' ? 3 : 1;

      const finishSearch = () => {
        completedQueries++;
        if (completedQueries === totalQueries) {
          resolve({
            content: [
              {
                type: 'text',
                text: formatSearchResults(results)
              }
            ]
          });
        }
      };

      if (searchType === 'bugs' || searchType === 'all') {
        this.db.all(
          `SELECT * FROM bugs WHERE 
           LOWER(title) LIKE ? OR 
           LOWER(description) LIKE ? OR 
           LOWER(component) LIKE ?`,
          [`%${query}%`, `%${query}%`, `%${query}%`],
          (err: any, rows: any[]) => {
            if (err) {
              reject(new McpError(ErrorCode.InternalError, `Failed to search bugs: ${err.message}`));
              return;
            }

            results.push(...rows.map((bug: any) => ({
              type: 'bug',
              ...bug,
              filesLikelyInvolved: JSON.parse(bug.filesLikelyInvolved || '[]'),
              stepsToReproduce: JSON.parse(bug.stepsToReproduce || '[]'),
              verification: JSON.parse(bug.verification || '[]'),
              humanVerified: !!bug.humanVerified
            })));

            finishSearch();
          }
        );
      }

      if (searchType === 'features' || searchType === 'all') {
        this.db.all(
          `SELECT * FROM features WHERE 
           LOWER(title) LIKE ? OR 
           LOWER(description) LIKE ? OR 
           LOWER(category) LIKE ?`,
          [`%${query}%`, `%${query}%`, `%${query}%`],
          (err: any, rows: any[]) => {
            if (err) {
              reject(new McpError(ErrorCode.InternalError, `Failed to search features: ${err.message}`));
              return;
            }

            results.push(...rows.map((feature: any) => ({
              type: 'feature',
              ...feature,
              acceptanceCriteria: JSON.parse(feature.acceptanceCriteria || '[]'),
              dependencies: JSON.parse(feature.dependencies || '[]')
            })));

            finishSearch();
          }
        );
      }

      if (searchType === 'improvements' || searchType === 'all') {
        this.db.all(
          `SELECT * FROM improvements WHERE 
           LOWER(title) LIKE ? OR 
           LOWER(description) LIKE ? OR 
           LOWER(category) LIKE ?`,
          [`%${query}%`, `%${query}%`, `%${query}%`],
          (err: any, rows: any[]) => {
            if (err) {
              reject(new McpError(ErrorCode.InternalError, `Failed to search improvements: ${err.message}`));
              return;
            }

            results.push(...rows.map((improvement: any) => ({
              type: 'improvement',
              ...improvement,
              acceptanceCriteria: JSON.parse(improvement.acceptanceCriteria || '[]'),
              filesLikelyInvolved: JSON.parse(improvement.filesLikelyInvolved || '[]'),
              dependencies: JSON.parse(improvement.dependencies || '[]'),
              benefits: JSON.parse(improvement.benefits || '[]')
            })));

            finishSearch();
          }
        );
      }

      if (searchType !== 'bugs' && searchType !== 'features' && searchType !== 'improvements' && searchType !== 'all') {
        reject(new McpError(ErrorCode.InvalidParams, `Invalid search type: ${searchType}`));
      }
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
          description: 'List improvements with optional filtering',
          inputSchema: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['Proposed', 'In Discussion', 'Approved', 'In Development', 'Completed (Awaiting Human Verification)', 'Completed', 'Rejected'] },
              priority: { type: 'string', enum: ['Low', 'Medium', 'High'] },
              category: { type: 'string' }
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
          description: 'Search across bugs, features, and improvements',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              type: { type: 'string', enum: ['bugs', 'features', 'improvements', 'all'], description: 'Type of items to search' }
            },
            required: ['query']
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