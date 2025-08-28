#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { BugManager } from './bugs.js';
// Feature requests removed
import { ImprovementManager } from './improvements.js';
import { SearchManager } from './search.js';
import { ContextManager } from './context.js';
import { WorkflowManager } from './workflows.js';
import { validateCreateItem, validateUpdateItemStatus } from './validation.js';
import sqlite3 from 'sqlite3';
import { log } from './logger.js';

class ProjectManagementServer {
  private server: Server;
  private db!: sqlite3.Database;
  private bugManager: BugManager;
  // FeatureManager removed
  private improvementManager: ImprovementManager;
  private searchManager: SearchManager;
  private contextManager: ContextManager;
  private workflowManager: WorkflowManager;
  private ftsRebuildTimer?: NodeJS.Timeout;

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

    this.bugManager = new BugManager();
    this.improvementManager = new ImprovementManager();
    this.searchManager = new SearchManager();
    this.contextManager = new ContextManager();
    this.workflowManager = new WorkflowManager();

    this.setupToolHandlers();
  }

  private scheduleFtsRebuild(delayMs: number = 1500) {
    try {
      if (this.ftsRebuildTimer) clearTimeout(this.ftsRebuildTimer);
      this.ftsRebuildTimer = setTimeout(() => {
        log.debug('Triggering debounced FTS index rebuild');
        this.searchManager
          .rebuildIndex(this.db)
          .then(() => log.debug('FTS index rebuild complete'))
          .catch((e) => { log.debug('FTS rebuild skipped/failed (likely no FTS5):', e?.message || e); });
      }, delayMs);
    } catch {
      // noop
    }
  }

  private async initDb() {
    const dbPath = process.env.DB_PATH || 'bugger.db';
    
    this.db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        log.error('Error opening database:', err.message);
        process.exit(1);
      }
      log.info('Database opened at', dbPath);
    });

    // Create tables if they don't exist
    const tables = [
      `CREATE TABLE IF NOT EXISTS bugs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        dateReported TEXT NOT NULL,
        component TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        expectedBehavior TEXT NOT NULL,
        actualBehavior TEXT NOT NULL,
        potentialRootCause TEXT,
        filesLikelyInvolved TEXT,
        stepsToReproduce TEXT,
        verification TEXT,
        humanVerified INTEGER DEFAULT 0
      )`,
      // Feature requests removed
      `CREATE TABLE IF NOT EXISTS improvements (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        dateRequested TEXT NOT NULL,
        dateCompleted TEXT,
        category TEXT NOT NULL,
        requestedBy TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        currentState TEXT NOT NULL,
        desiredState TEXT NOT NULL,
        acceptanceCriteria TEXT,
        implementationDetails TEXT,
        potentialImplementation TEXT,
        filesLikelyInvolved TEXT,
        dependencies TEXT,
        effortEstimate TEXT,
        benefits TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS item_relationships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fromItem TEXT NOT NULL,
        toItem TEXT NOT NULL,
        relationshipType TEXT NOT NULL,
        dateCreated TEXT NOT NULL,
        UNIQUE(fromItem, toItem, relationshipType)
      )`,
      `CREATE TABLE IF NOT EXISTS code_contexts (
        id TEXT PRIMARY KEY,
        taskId TEXT NOT NULL,
        taskType TEXT NOT NULL,
        contextType TEXT NOT NULL,
        source TEXT NOT NULL,
        filePath TEXT NOT NULL,
        startLine INTEGER,
        endLine INTEGER,
        content TEXT,
        description TEXT NOT NULL,
        relevanceScore REAL NOT NULL,
        keywords TEXT,
        dateCollected TEXT NOT NULL,
        dateLastChecked TEXT,
        isStale INTEGER DEFAULT 0
      )`,
    ];

    // Improve concurrency and durability for agent workloads
    await new Promise<void>((resolve, reject) => {
      this.db.run('PRAGMA journal_mode=WAL', (err) => (err ? reject(err) : resolve()));
    });
    await new Promise<void>((resolve, reject) => {
      this.db.run('PRAGMA synchronous=NORMAL', (err) => (err ? reject(err) : resolve()));
    });
    log.debug('SQLite PRAGMAs set: WAL, synchronous=NORMAL');

    for (const table of tables) {
      await new Promise<void>((resolve, reject) => {
        this.db.run(table, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }

    // Helpful indexes for common filters and sorts
    const indexes = [
      // bugs
      `CREATE INDEX IF NOT EXISTS idx_bugs_status ON bugs(status)`,
      `CREATE INDEX IF NOT EXISTS idx_bugs_priority ON bugs(priority)`,
      `CREATE INDEX IF NOT EXISTS idx_bugs_component ON bugs(component)`,
      `CREATE INDEX IF NOT EXISTS idx_bugs_date ON bugs(dateReported)`,
      // Feature indexes removed
      // improvements
      `CREATE INDEX IF NOT EXISTS idx_improvements_status ON improvements(status)`,
      `CREATE INDEX IF NOT EXISTS idx_improvements_priority ON improvements(priority)`,
      `CREATE INDEX IF NOT EXISTS idx_improvements_category ON improvements(category)`,
      `CREATE INDEX IF NOT EXISTS idx_improvements_requestedBy ON improvements(requestedBy)`,
      `CREATE INDEX IF NOT EXISTS idx_improvements_date ON improvements(dateRequested)`,
      // relationships
      `CREATE INDEX IF NOT EXISTS idx_relationships_from ON item_relationships(fromItem)`,
      `CREATE INDEX IF NOT EXISTS idx_relationships_to ON item_relationships(toItem)`
    ];

    for (const idx of indexes) {
      await new Promise<void>((resolve, reject) => {
        this.db.run(idx, (err) => (err ? reject(err) : resolve()));
      });
    }

    // Best-effort FTS5 setup and triggers for auto-sync of index
    const ftsStatements = [
      `CREATE VIRTUAL TABLE IF NOT EXISTS item_fts USING fts5(id UNINDEXED, type UNINDEXED, title, description)`,
      // Bugs triggers
      `CREATE TRIGGER IF NOT EXISTS trg_bugs_ai AFTER INSERT ON bugs BEGIN
         INSERT INTO item_fts(id,type,title,description) VALUES (new.id,'bug',new.title,new.description);
       END;`,
      `CREATE TRIGGER IF NOT EXISTS trg_bugs_au AFTER UPDATE ON bugs BEGIN
         DELETE FROM item_fts WHERE id=old.id AND type='bug';
         INSERT INTO item_fts(id,type,title,description) VALUES (new.id,'bug',new.title,new.description);
       END;`,
      `CREATE TRIGGER IF NOT EXISTS trg_bugs_ad AFTER DELETE ON bugs BEGIN
         DELETE FROM item_fts WHERE id=old.id AND type='bug';
       END;`,
      // Feature FTS triggers removed
      // Improvements triggers
      `CREATE TRIGGER IF NOT EXISTS trg_improvements_ai AFTER INSERT ON improvements BEGIN
         INSERT INTO item_fts(id,type,title,description) VALUES (new.id,'improvement',new.title,new.description);
       END;`,
      `CREATE TRIGGER IF NOT EXISTS trg_improvements_au AFTER UPDATE ON improvements BEGIN
         DELETE FROM item_fts WHERE id=old.id AND type='improvement';
         INSERT INTO item_fts(id,type,title,description) VALUES (new.id,'improvement',new.title,new.description);
       END;`,
      `CREATE TRIGGER IF NOT EXISTS trg_improvements_ad AFTER DELETE ON improvements BEGIN
         DELETE FROM item_fts WHERE id=old.id AND type='improvement';
       END;`,
    ];
    for (const stmt of ftsStatements) {
      await new Promise<void>((resolve) => {
        this.db.run(stmt, () => resolve()); // Ignore errors if FTS5 not available
      });
    }
  }

  private async withTransaction<T>(operation: (db: sqlite3.Database) => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run('BEGIN TRANSACTION');
        
        operation(this.db)
          .then((result) => {
            this.db.run('COMMIT', (err) => {
              if (err) {
                reject(err);
              } else {
                resolve(result);
              }
            });
          })
          .catch((error) => {
            this.db.run('ROLLBACK', () => {
              reject(error);
            });
          });
      });
    });
  }



  private async createItem(args: any) {
    // Validate input arguments
    const validatedArgs = validateCreateItem(args);
    const { type } = validatedArgs;
    
    switch (type) {
      case 'bug':
        return this.bugManager.createBug(this.db, validatedArgs);
      case 'improvement':
        return this.improvementManager.createImprovement(this.db, validatedArgs);
      default:
        throw new Error(`Unknown item type: ${type}`);
    }
  }

  private async listItems(args: any) {
    const { type } = args;
    
    switch (type) {
      case 'bug':
        return this.bugManager.listBugs(this.db, args);
      case 'improvement':
        return this.improvementManager.listImprovements(this.db, args);
      default:
        throw new Error(`Unknown item type: ${type}`);
    }
  }

  private async updateItemStatus(args: any) {
    // Validate input arguments
    const validatedArgs = validateUpdateItemStatus(args);
    const { itemId } = validatedArgs;
    
    if (itemId.startsWith('Bug')) {
      return this.bugManager.updateBugStatus(this.db, validatedArgs);
    } else if (itemId.startsWith('FR-')) {
      throw new Error('Feature requests are no longer supported');
    } else if (itemId.startsWith('IMP-')) {
      return this.improvementManager.updateImprovementStatus(this.db, validatedArgs);
    } else {
      throw new Error(`Unknown item type for ID: ${itemId}`);
    }
  }

  private async bulkUpdateItems(args: any) {
    const { updates } = args;
    
    if (!updates || !Array.isArray(updates)) {
      throw new Error('Updates array is required');
    }

    // Group updates by type
    const bugUpdates = updates.filter(u => u.itemId.startsWith('Bug'));
    const featureUpdates: any[] = [];
    const improvementUpdates = updates.filter(u => u.itemId.startsWith('IMP-'));

    let results: string[] = [];

    if (bugUpdates.length > 0) {
      const result = await this.bugManager.bulkUpdateBugStatus(this.db, { updates: bugUpdates });
      results.push(result);
    }

    // Feature updates no longer supported

    if (improvementUpdates.length > 0) {
      const result = await this.improvementManager.bulkUpdateImprovementStatus(this.db, { updates: improvementUpdates });
      results.push(result);
    }

    return results.join('\n\n');
  }



  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'create_todo',
            description: 'Quickly create a lightweight TODO (stored as an improvement)',
            inputSchema: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Short task title' },
                description: { type: 'string', description: 'Optional details' },
                priority: { type: 'string', enum: ['Low', 'Medium', 'High'], description: 'Task priority' },
                status: { type: 'string', enum: ['Todo', 'Doing', 'Blocked', 'Done'], description: 'Optional TODO status' },
                filesLikelyInvolved: { type: 'array', items: { type: 'string' } },
                linkTo: { type: 'string', description: 'ID to link this TODO to (e.g., Bug #001)' },
              },
              required: ['title'],
              additionalProperties: false
            }
          },
          {
            name: 'create_item',
            description: 'Create a new bug or improvement',
            inputSchema: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['bug', 'improvement'],
                  description: 'Type of item to create'
                },
                title: { type: 'string', description: 'Item title' },
                description: { type: 'string', description: 'Detailed item description' },
                priority: {
                  type: 'string',
                  enum: ['Low', 'Medium', 'High', 'Critical'],
                  description: 'Item priority'
                },
                // Bug-specific fields
                component: { type: 'string', description: 'Component affected (bugs only)' },
                expectedBehavior: { type: 'string', description: 'What should happen (bugs only)' },
                actualBehavior: { type: 'string', description: 'What actually happens (bugs only)' },
                potentialRootCause: { type: 'string', description: 'Hypothesis about the cause (bugs only)' },
                stepsToReproduce: { 
                  type: 'array', 
                  items: { type: 'string' }, 
                  description: 'Steps to reproduce (bugs only)' 
                },
                filesLikelyInvolved: { 
                  type: 'array', 
                  items: { type: 'string' }, 
                  description: 'Files that might be involved (bugs/improvements)' 
                },
                // Improvement fields
                category: { type: 'string', description: 'Category (improvements only)' },
                requestedBy: { type: 'string', description: 'Who requested this (improvements only)' },
                acceptanceCriteria: { type: 'array', items: { type: 'string' }, description: 'Acceptance criteria (improvements only)' },
                effortEstimate: { type: 'string', enum: ['Small', 'Medium', 'Large', 'XL'], description: 'Effort estimate (improvements only)' },
                // Improvement-specific fields
                currentState: { type: 'string', description: 'Current state (improvements only)' },
                desiredState: { type: 'string', description: 'Desired state after improvement (improvements only)' },
              },
              required: ['type', 'title', 'description', 'priority'],
              additionalProperties: false
            }
          },
          {
            name: 'list_items',
            description: 'List bugs or improvements with optional filtering',
            inputSchema: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['bug', 'improvement'],
                  description: 'Type of items to list'
                },
                view: {
                  type: 'string',
                  enum: ['todos', 'blocked', 'done', 'today'],
                  description: 'Predefined views for improvements (ignored for bugs)'
                },
                status: { type: 'string', description: 'Filter by status (status values depend on item type)' },
                priority: {
                  type: 'string',
                  enum: ['Low', 'Medium', 'High', 'Critical'],
                  description: 'Filter by priority'
                },
                category: { type: 'string', description: 'Filter by category (improvements only)' },
                component: { type: 'string', description: 'Filter by component (bugs only)' },
                includeCodeContext: { 
                  type: 'boolean', 
                  description: 'Include relevant code sections and file context (improvements only)' 
                }
              },
              required: ['type'],
              additionalProperties: false
            }
          },
          {
            name: 'update_item_status',
            description: 'Update status of a bug or improvement',
            inputSchema: {
              type: 'object',
              properties: {
                itemId: { type: 'string', description: 'Item ID (e.g., Bug #001, IMP-001)' },
                status: { 
                  type: 'string', 
                  description: 'New status. For bugs: Open, In Progress, Fixed, Closed, Temporarily Resolved. For improvements: Proposed, In Discussion, Approved, In Development, Completed (Awaiting Human Verification), Completed, Rejected. Also accepts TODO statuses (Todo, Doing, Blocked, Done) for improvements.',
                  enum: [
                    // Bug statuses
                    'Open', 'In Progress', 'Fixed', 'Closed', 'Temporarily Resolved',
                    // Improvement statuses (includes 'Completed (Awaiting Human Verification)')
                    'Proposed', 'In Discussion', 'Approved', 'In Development', 'Completed', 'Rejected', 'Completed (Awaiting Human Verification)',
                    // Lightweight TODO statuses (mapped server-side for improvements)
                    'Todo', 'Doing', 'Blocked', 'Done'
                  ]
                },
                humanVerified: { type: 'boolean', description: 'Whether human verification is complete (bugs only)' },
                dateCompleted: { type: 'string', description: 'Completion date YYYY-MM-DD (improvements only)' }
              },
              required: ['itemId', 'status'],
              additionalProperties: false
            }
          },
          {
            name: 'search_items',
            description: 'Advanced search across bugs and improvements with filtering, sorting, and pagination',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Search query (optional - can search with filters only)' },
                type: { type: 'string', enum: ['bugs', 'improvements', 'all'], description: 'Type of items to search' },
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
                effortEstimate: { type: ['string', 'array'], description: 'Filter by effort estimate (improvements only)' },
                humanVerified: { type: 'boolean', description: 'Filter by human verification status (bugs only)' },
                dateFrom: { type: 'string', description: 'Start date for date range filter (YYYY-MM-DD)' },
                dateTo: { type: 'string', description: 'End date for date range filter (YYYY-MM-DD)' },
                searchFields: { 
                  type: 'array', 
                  items: { type: 'string' }, 
                  description: 'Specific fields to search in (e.g., ["title", "description"]). Defaults to title, description, and category/component' 
                },
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
              },
              additionalProperties: false
            }
          },
          {
            name: 'get_statistics',
            description: 'Get project statistics',
            inputSchema: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['bugs', 'improvements', 'all'], description: 'Type of statistics to generate' }
              },
              additionalProperties: false
            }
          },
          {
            name: 'link_items',
            description: 'Create relationships between bugs and improvements',
            inputSchema: {
              type: 'object',
              properties: {
                fromItem: { type: 'string', description: 'Source item ID (e.g., Bug #001, IMP-001)' },
                toItem: { type: 'string', description: 'Target item ID (e.g., Bug #002, IMP-002)' },
                relationshipType: {
                  type: 'string',
                  enum: ['blocks', 'relates_to', 'duplicate_of'],
                  description: 'Type of relationship between items'
                }
              },
              required: ['fromItem', 'toItem', 'relationshipType'],
              additionalProperties: false
            }
          },
          {
            name: 'get_related_items',
            description: 'Get items related to a specific bug or improvement',
            inputSchema: {
              type: 'object',
              properties: {
                itemId: { type: 'string', description: 'Item ID to find relationships for (e.g., Bug #001, IMP-001)' }
              },
              required: ['itemId'],
              additionalProperties: false
            }
          },
          {
            name: 'bulk_update_items',
            description: 'Update multiple items (bugs or improvements) in a single operation',
            inputSchema: {
              type: 'object',
              properties: {
                updates: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      itemId: { type: 'string', description: 'Item ID (e.g., Bug #001, IMP-001)' },
                      status: { 
                        type: 'string', 
                        description: 'New status. For bugs: Open, In Progress, Fixed, Closed, Temporarily Resolved. For improvements: Proposed, In Discussion, Approved, In Development, Completed (Awaiting Human Verification), Completed, Rejected. Also accepts TODO statuses.',
                        enum: [
                          // Bug statuses
                          'Open', 'In Progress', 'Fixed', 'Closed', 'Temporarily Resolved',
                          // Improvement statuses
                          'Proposed', 'In Discussion', 'Approved', 'In Development', 'Completed', 'Rejected', 'Completed (Awaiting Human Verification)',
                          // TODO statuses mapped for improvements
                          'Todo', 'Doing', 'Blocked', 'Done'
                        ]
                      },
                      humanVerified: { type: 'boolean', description: 'Whether human verification is complete (bugs only)' },
                      dateCompleted: { type: 'string', description: 'Completion date YYYY-MM-DD (improvements only)' }
                    },
                    required: ['itemId', 'status'],
                    additionalProperties: false
                  },
                  description: 'Array of item updates to perform'
                }
              },
              required: ['updates'],
              additionalProperties: false
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
                items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      type: { type: 'string', enum: ['bug', 'improvement'] },
                      data: { type: 'object', description: 'Item data' },
                      linkTo: { type: 'string', description: 'ID of item to link to' },
                      relationshipType: { type: 'string', enum: ['blocks', 'relates_to', 'duplicate_of'] }
                    },
                    additionalProperties: false
                  },
                  description: 'Items to create and link (for create_and_link workflow)'
                },
                tasks: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      taskId: { type: 'string' },
                      taskType: { type: 'string', enum: ['bug', 'improvement'] },
                      title: { type: 'string' },
                      description: { type: 'string' }
                    },
                    additionalProperties: false
                  },
                  description: 'Tasks to collect contexts for (for batch_context_collection workflow)'
                },
                transitions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      itemId: { type: 'string' },
                      fromStatus: { type: 'string' },
                      toStatus: { type: 'string' },
                      verifyTransition: { type: 'boolean', description: 'Whether to verify transition is valid' }
                    },
                    additionalProperties: false
                  },
                  description: 'Status transitions to perform (for status_transition workflow)'
                }
              },
              required: ['workflow'],
              additionalProperties: false
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
                taskType: { type: 'string', enum: ['bug', 'improvement'], description: 'Type of task (required for collect/add operations)' },
                title: { type: 'string', description: 'Task title (for collect operation)' },
                description: { type: 'string', description: 'Task description (for collect operation)' },
                currentState: { type: 'string', description: 'Current state (for improvements, collect operation)' },
                desiredState: { type: 'string', description: 'Desired state (for improvements, collect operation)' },
                expectedBehavior: { type: 'string', description: 'Expected behavior (for bugs, collect operation)' },
                actualBehavior: { type: 'string', description: 'Actual behavior (for bugs, collect operation)' },
                filesLikelyInvolved: { 
                  type: 'array', 
                  items: { type: 'string' }, 
                  description: 'Files likely involved (for collect operation)' 
                },
                keywords: { 
                  type: 'array', 
                  items: { type: 'string' }, 
                  description: 'Additional keywords (for collect operation)' 
                },
                entities: { 
                  type: 'array', 
                  items: { type: 'string' }, 
                  description: 'Additional entities (for collect operation)' 
                },
                contextType: { 
                  type: 'string', 
                  enum: ['snippet', 'file_reference', 'dependency', 'pattern'], 
                  description: 'Type of context (for add operation)' 
                },
                filePath: { type: 'string', description: 'Path to the file (for add operation)' },
                startLine: { type: 'number', description: 'Start line number (for add operation)' },
                endLine: { type: 'number', description: 'End line number (for add operation)' },
                content: { type: 'string', description: 'Context content (for add operation)' },
                contextDescription: { type: 'string', description: 'Context description (for add operation)' },
                relevanceScore: { type: 'number', description: 'Relevance score 0-1 (for add operation)' },
                contextId: { type: 'string', description: 'Context ID (for update/remove operations)' },
                updates: { type: 'object', description: 'Updates to apply (for update operation)' }
              },
              required: ['operation', 'taskId'],
              additionalProperties: false
            }
          },
          {
            name: 'search_semantic',
            description: 'Perform semantic search across all items using similarity algorithms',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Search query for semantic matching' },
                limit: { type: 'number', description: 'Maximum number of results (default: 10)' },
                minSimilarity: { type: 'number', description: 'Minimum similarity threshold 0-1 (default: 0.3)' }
              },
              required: ['query'],
              additionalProperties: false
            }
          },
          {
            name: 'rebuild_search_index',
            description: 'Rebuild the full-text search index for semantic search (FTS5)',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false
            }
          },
        ]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        let result: string;

        switch (name) {
          case 'create_todo':
            result = await this.withTransaction(async () => {
              // Create the TODO (as an improvement)
              const created = await this.improvementManager.createTodo(this.db, args);
              // Optionally link to another item
              if (args?.linkTo) {
                // Extract created ID (e.g., IMP-001)
                const match = created.match(/(IMP-\d+)/);
                if (match) {
                  try {
                    await this.workflowManager.linkItems(this.db, {
                      fromItem: match[1],
                      toItem: args.linkTo,
                      relationshipType: 'relates_to',
                    });
                  } catch {
                    // Linking errors should not fail creation
                  }
                }
              }
              return created;
            });
            this.scheduleFtsRebuild();
            break;
          case 'create_item':
            result = await this.withTransaction(() => this.createItem(args));
            this.scheduleFtsRebuild();
            break;

          case 'list_items':
            result = await this.listItems(args);
            break;

          case 'update_item_status':
            result = await this.withTransaction(() => this.updateItemStatus(args));
            this.scheduleFtsRebuild();
            break;

          case 'search_items':
            result = await this.searchManager.searchItems(this.db, args);
            break;

          case 'get_statistics':
            result = await this.searchManager.getStatistics(this.db, args);
            break;


          case 'link_items':
            result = await this.withTransaction(() => this.workflowManager.linkItems(this.db, args));
            break;

          case 'get_related_items':
            result = await this.workflowManager.getRelatedItems(this.db, args);
            break;

          case 'bulk_update_items':
            result = await this.withTransaction(() => this.bulkUpdateItems(args));
            this.scheduleFtsRebuild();
            break;

          case 'execute_workflow':
            result = await this.withTransaction(() => this.workflowManager.executeWorkflow(this.db, args));
            this.scheduleFtsRebuild();
            break;

          case 'manage_contexts':
            result = await this.withTransaction(() => this.contextManager.manageContexts(this.db, args));
            break;

          case 'search_semantic':
            result = await this.searchManager.performSemanticSearch(this.db, args);
            break;

          case 'rebuild_search_index':
            result = await this.searchManager.rebuildIndex(this.db);
            break;


          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }

        return { content: [{ type: 'text', text: result }] };
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Error executing ${name}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    });
  }

  async run() {
    await this.initDb();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    log.info('bugger-mcp server connected over stdio');

    const cleanup = () => {
      try {
        log.info('Shutting down, closing database...');
        this.db?.close(() => process.exit(0));
      } catch {
        process.exit(0);
      }
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }
}

const server = new ProjectManagementServer();
server.run().catch(console.error);
