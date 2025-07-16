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
import { open } from 'sqlite';

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
  private db: any; // SQLite database instance

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
    this.db = await open({
      filename: './bugger.db',
      driver: sqlite3.Database
    });

    await this.db.exec(`
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
    `);
  }

  private async generateNextId(type: 'bug' | 'feature' | 'improvement'): Promise<string> {
    const prefixes = { bug: 'Bug #', feature: 'FR-', improvement: 'IMP-' };
    const tableName = type === 'bug' ? 'bugs' : type === 'feature' ? 'features' : 'improvements';
    const prefix = prefixes[type];

    const result = await this.db.get(`SELECT MAX(CAST(SUBSTR(id, LENGTH(?) + 1) AS INTEGER)) as maxNum FROM ${tableName} WHERE id LIKE ? || '%'`, prefix, prefix);
    const maxNum = result && result.maxNum ? result.maxNum : 0;
    const nextNumber = maxNum + 1;

    return type === 'bug' ? `Bug #${nextNumber.toString().padStart(3, '0')}` :
           type === 'feature' ? `FR-${nextNumber.toString().padStart(3, '0')}` :
           `IMP-${nextNumber.toString().padStart(3, '0')}`;
  }

  private async createBug(args: any) {
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

    await this.db.run(
      `INSERT INTO bugs (id, status, priority, dateReported, component, title, description, expectedBehavior, actualBehavior, potentialRootCause, filesLikelyInvolved, stepsToReproduce, humanVerified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newBug.id, newBug.status, newBug.priority, newBug.dateReported, newBug.component, newBug.title, newBug.description, newBug.expectedBehavior, newBug.actualBehavior, newBug.potentialRootCause, JSON.stringify(newBug.filesLikelyInvolved), JSON.stringify(newBug.stepsToReproduce), newBug.humanVerified ? 1 : 0
    );

    return {
      content: [
        {
          type: 'text',
          text: `Created new bug: ${newBug.id} - ${newBug.title}`
        }
      ]
    };
  }

  private async createFeatureRequest(args: any) {
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

    await this.db.run(
      `INSERT INTO features (id, status, priority, dateRequested, category, requestedBy, title, description, userStory, currentBehavior, expectedBehavior, acceptanceCriteria, effortEstimate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newFeature.id, newFeature.status, newFeature.priority, newFeature.dateRequested, newFeature.category, newFeature.requestedBy, newFeature.title, newFeature.description, newFeature.userStory, newFeature.currentBehavior, newFeature.expectedBehavior, JSON.stringify(newFeature.acceptanceCriteria), newFeature.effortEstimate
    );

    return {
      content: [
        {
          type: 'text',
          text: `Created new feature request: ${newFeature.id} - ${newFeature.title}`
        }
      ]
    };
  }

  private async createImprovement(args: any) {
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

    await this.db.run(
      `INSERT INTO improvements (id, status, priority, dateRequested, category, requestedBy, title, description, currentState, desiredState, acceptanceCriteria, effortEstimate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newImprovement.id, newImprovement.status, newImprovement.priority, newImprovement.dateRequested, newImprovement.category, newImprovement.requestedBy, newImprovement.title, newImprovement.description, newImprovement.currentState, newImprovement.desiredState, JSON.stringify(newImprovement.acceptanceCriteria), newImprovement.effortEstimate
    );

    return {
      content: [
        {
          type: 'text',
          text: `Created new improvement: ${newImprovement.id} - ${newImprovement.title}`
        }
      ]
    };
  }

  private async listBugs(args: any) {
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

    const bugs = await this.db.all(query, params);
    return {
      content: [
        {
          type: 'text',
          text: formatBugs(bugs.map((bug: any) => ({
            ...bug,
            filesLikelyInvolved: JSON.parse(bug.filesLikelyInvolved || '[]'),
            stepsToReproduce: JSON.parse(bug.stepsToReproduce || '[]'),
            verification: JSON.parse(bug.verification || '[]'),
            humanVerified: !!bug.humanVerified
          })))
        }
      ]
    };
  }

  private async listFeatureRequests(args: any) {
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

    const features = await this.db.all(query, params);
    return {
      content: [
        {
          type: 'text',
          text: formatFeatureRequests(features.map((feature: any) => ({
            ...feature,
            acceptanceCriteria: JSON.parse(feature.acceptanceCriteria || '[]'),
            dependencies: JSON.parse(feature.dependencies || '[]')
          })))
        }
      ]
    };
  }

  private async listImprovements(args: any) {
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

    const improvements = await this.db.all(query, params);
    return {
      content: [
        {
          type: 'text',
          text: formatImprovements(improvements.map((improvement: any) => ({
            ...improvement,
            acceptanceCriteria: JSON.parse(improvement.acceptanceCriteria || '[]'),
            filesLikelyInvolved: JSON.parse(improvement.filesLikelyInvolved || '[]'),
            dependencies: JSON.parse(improvement.dependencies || '[]'),
            benefits: JSON.parse(improvement.benefits || '[]')
          })))
        }
      ]
    };
  }

  private async updateBugStatus(args: any) {
    const bug = await this.db.get('SELECT * FROM bugs WHERE id = ?', args.bugId);
    
    if (!bug) {
      throw new McpError(ErrorCode.InvalidParams, `Bug ${args.bugId} not found`);
    }

    bug.status = args.status;
    if (args.humanVerified !== undefined) {
      bug.humanVerified = args.humanVerified ? 1 : 0;
    }

    await this.db.run('UPDATE bugs SET status = ?, humanVerified = ? WHERE id = ?', bug.status, bug.humanVerified, args.bugId);

    return {
      content: [
        {
          type: 'text',
          text: `Updated ${args.bugId} status to ${args.status}`
        }
      ]
    };
  }

  private async updateFeatureStatus(args: any) {
    const feature = await this.db.get('SELECT * FROM features WHERE id = ?', args.featureId);
    
    if (!feature) {
      throw new McpError(ErrorCode.InvalidParams, `Feature ${args.featureId} not found`);
    }

    feature.status = args.status;
    await this.db.run('UPDATE features SET status = ? WHERE id = ?', feature.status, args.featureId);

    return {
      content: [
        {
          type: 'text',
          text: `Updated ${args.featureId} status to ${args.status}`
        }
      ]
    };
  }

  private async updateImprovementStatus(args: any) {
    const improvement = await this.db.get('SELECT * FROM improvements WHERE id = ?', args.improvementId);
    
    if (!improvement) {
      throw new McpError(ErrorCode.InvalidParams, `Improvement ${args.improvementId} not found`);
    }

    improvement.status = args.status;
    if (args.dateCompleted) {
      improvement.dateCompleted = args.dateCompleted;
    }

    await this.db.run('UPDATE improvements SET status = ?, dateCompleted = ? WHERE id = ?', improvement.status, improvement.dateCompleted, args.improvementId);

    return {
      content: [
        {
          type: 'text',
          text: `Updated ${args.improvementId} status to ${args.status}`
        }
      ]
    };
  }

  private async searchItems(args: any) {
    const query = args.query.toLowerCase();
    const searchType = args.type || 'all';
    const results: any[] = [];

    if (searchType === 'bugs' || searchType === 'all') {
      const bugs = await this.db.all(
        `SELECT * FROM bugs WHERE 
         LOWER(title) LIKE ? OR 
         LOWER(description) LIKE ? OR 
         LOWER(component) LIKE ?`,
        `%${query}%`, `%${query}%`, `%${query}%`
      );
      results.push(...bugs.map((bug: any) => ({
        type: 'bug',
        ...bug,
        filesLikelyInvolved: JSON.parse(bug.filesLikelyInvolved || '[]'),
        stepsToReproduce: JSON.parse(bug.stepsToReproduce || '[]'),
        verification: JSON.parse(bug.verification || '[]'),
        humanVerified: !!bug.humanVerified
      })));
    }

    if (searchType === 'features' || searchType === 'all') {
      const features = await this.db.all(
        `SELECT * FROM features WHERE 
         LOWER(title) LIKE ? OR 
         LOWER(description) LIKE ? OR 
         LOWER(category) LIKE ?`,
        `%${query}%`, `%${query}%`, `%${query}%`
      );
      results.push(...features.map((feature: any) => ({
        type: 'feature',
        ...feature,
        acceptanceCriteria: JSON.parse(feature.acceptanceCriteria || '[]'),
        dependencies: JSON.parse(feature.dependencies || '[]')
      })));
    }

    if (searchType === 'improvements' || searchType === 'all') {
      const improvements = await this.db.all(
        `SELECT * FROM improvements WHERE 
         LOWER(title) LIKE ? OR 
         LOWER(description) LIKE ? OR 
         LOWER(category) LIKE ?`,
        `%${query}%`, `%${query}%`, `%${query}%`
      );
      results.push(...improvements.map((improvement: any) => ({
        type: 'improvement',
        ...improvement,
        acceptanceCriteria: JSON.parse(improvement.acceptanceCriteria || '[]'),
        filesLikelyInvolved: JSON.parse(improvement.filesLikelyInvolved || '[]'),
        dependencies: JSON.parse(improvement.dependencies || '[]'),
        benefits: JSON.parse(improvement.benefits || '[]')
      })));
    }

    return {
      content: [
        {
          type: 'text',
          text: formatSearchResults(results)
        }
      ]
    };
  }

  private async getStatistics(args: any) {
    const type = args.type || 'all';
    const stats: any = {};

    if (type === 'bugs' || type === 'all') {
      const bugs = await this.db.all('SELECT status, priority FROM bugs');
      stats.bugs = {
        total: bugs.length,
        byStatus: bugs.reduce((acc: any, bug) => {
          acc[bug.status] = (acc[bug.status] || 0) + 1;
          return acc;
        }, {}),
        byPriority: bugs.reduce((acc: any, bug) => {
          acc[bug.priority] = (acc[bug.priority] || 0) + 1;
          return acc;
        }, {})
      };
    }

    if (type === 'features' || type === 'all') {
      const features = await this.db.all('SELECT status, priority FROM features');
      stats.features = {
        total: features.length,
        byStatus: features.reduce((acc: any, feature) => {
          acc[feature.status] = (acc[feature.status] || 0) + 1;
          return acc;
        }, {}),
        byPriority: features.reduce((acc: any, feature) => {
          acc[feature.priority] = (acc[feature.priority] || 0) + 1;
          return acc;
        }, {})
      };
    }

    if (type === 'improvements' || type === 'all') {
      const improvements = await this.db.all('SELECT status, priority FROM improvements');
      stats.improvements = {
        total: improvements.length,
        byStatus: improvements.reduce((acc: any, improvement) => {
          acc[improvement.status] = (acc[improvement.status] || 0) + 1;
          return acc;
        }, {}),
        byPriority: improvements.reduce((acc: any, improvement) => {
          acc[improvement.priority] = (acc[improvement.priority] || 0) + 1;
          return acc;
        }, {})
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: formatStatistics(stats)
        }
      ]
    };
  }

  private async syncFromMarkdown(args: any) {
    // This would parse your existing markdown files and import them
    // Implementation would depend on your markdown parsing preferences
    return {
      content: [
        {
          type: 'text',
          text: 'Markdown sync not yet implemented - would parse existing .md files and import data'
        }
      ]
    };
  }
}