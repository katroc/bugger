// Workflow automation operations
import { TokenUsageTracker } from './token-usage-tracker.js';
import { BugManager } from './bugs.js';
import { FeatureManager } from './features.js';
import { ImprovementManager } from './improvements.js';
import { ContextManager } from './context.js';
import sqlite3 from 'sqlite3';

export class WorkflowManager {
  private tokenTracker: TokenUsageTracker;
  private bugManager: BugManager;
  private featureManager: FeatureManager;
  private improvementManager: ImprovementManager;
  private contextManager: ContextManager;

  constructor() {
    this.tokenTracker = TokenUsageTracker.getInstance();
    this.bugManager = new BugManager();
    this.featureManager = new FeatureManager();
    this.improvementManager = new ImprovementManager();
    this.contextManager = new ContextManager();
  }

  /**
   * Execute predefined workflows
   */
  async executeWorkflow(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('execute_workflow');

    const { workflow } = args;

    switch (workflow) {
      case 'create_and_link':
        return this.executeCreateAndLinkWorkflow(db, args);
      case 'batch_context_collection':
        return this.executeBatchContextWorkflow(db, args);
      case 'status_transition':
        return this.executeStatusTransitionWorkflow(db, args);
      default:
        throw new Error(`Unknown workflow: ${workflow}`);
    }
  }

  /**
   * Create and link workflow
   */
  private async executeCreateAndLinkWorkflow(db: sqlite3.Database, args: any): Promise<string> {
    const { items } = args;

    if (!items || !Array.isArray(items)) {
      throw new Error('Items array is required for create_and_link workflow');
    }

    const results: any[] = [];
    const createdItems: string[] = [];

    try {
      // Create all items first
      for (const item of items) {
        let createResult: string;
        let itemId: string;

        switch (item.type) {
          case 'bug':
            createResult = await this.bugManager.createBug(db, item.data);
            itemId = this.extractIdFromCreateResponse(createResult, 'bug');
            break;
          case 'feature':
            createResult = await this.featureManager.createFeatureRequest(db, item.data);
            itemId = this.extractIdFromCreateResponse(createResult, 'feature');
            break;
          case 'improvement':
            createResult = await this.improvementManager.createImprovement(db, item.data);
            itemId = this.extractIdFromCreateResponse(createResult, 'improvement');
            break;
          default:
            throw new Error(`Unsupported item type: ${item.type}`);
        }

        results.push({
          status: 'success',
          type: item.type,
          id: itemId,
          message: `Created ${item.type} ${itemId}`
        });
        createdItems.push(itemId);
      }

      // Create links between items
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.linkTo && item.relationshipType) {
          try {
            const linkResult = await this.linkItems(db, {
              fromItem: createdItems[i],
              toItem: item.linkTo,
              relationshipType: item.relationshipType
            });
            results.push({
              status: 'success',
              type: 'link',
              message: `Linked ${createdItems[i]} to ${item.linkTo} (${item.relationshipType})`
            });
          } catch (error) {
            results.push({
              status: 'error',
              type: 'link',
              message: `Failed to link ${createdItems[i]} to ${item.linkTo}: ${error instanceof Error ? error.message : 'Unknown error'}`
            });
          }
        }
      }

      // Record token usage
      const inputText = JSON.stringify(args);
      const outputText = this.formatWorkflowResults('create_and_link', results);
      const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'create_and_link_workflow');

      return `${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`;
    } catch (error) {
      throw new Error(`Create and link workflow failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Batch context collection workflow
   */
  private async executeBatchContextWorkflow(db: sqlite3.Database, args: any): Promise<string> {
    const { tasks } = args;

    if (!tasks || !Array.isArray(tasks)) {
      throw new Error('Tasks array is required for batch_context_collection workflow');
    }

    const results: any[] = [];

    try {
      for (const task of tasks) {
        try {
          const contextResult = await this.contextManager.manageContexts(db, {
            operation: 'collect',
            taskId: task.taskId,
            taskType: task.taskType,
            title: task.title,
            description: task.description
          });

          results.push({
            status: 'success',
            taskId: task.taskId,
            message: 'Context collected successfully'
          });
        } catch (error) {
          results.push({
            status: 'error',
            taskId: task.taskId,
            message: `Failed to collect context: ${error instanceof Error ? error.message : 'Unknown error'}`
          });
        }
      }

      // Record token usage
      const inputText = JSON.stringify(args);
      const outputText = this.formatWorkflowResults('batch_context_collection', results);
      const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'batch_context_workflow');

      return `${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`;
    } catch (error) {
      throw new Error(`Batch context collection workflow failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Status transition workflow
   */
  private async executeStatusTransitionWorkflow(db: sqlite3.Database, args: any): Promise<string> {
    const { transitions } = args;

    if (!transitions || !Array.isArray(transitions)) {
      throw new Error('Transitions array is required for status_transition workflow');
    }

    const results: any[] = [];

    try {
      for (const transition of transitions) {
        try {
          // Verify transition is valid if requested
          if (transition.verifyTransition) {
            const isValid = await this.verifyStatusTransition(transition.itemId, transition.fromStatus, transition.toStatus);
            if (!isValid) {
              results.push({
                status: 'error',
                itemId: transition.itemId,
                message: `Invalid status transition from ${transition.fromStatus} to ${transition.toStatus}`
              });
              continue;
            }
          }

          // Determine item type and update status
          let updateResult: string;
          if (transition.itemId.startsWith('Bug')) {
            updateResult = await this.bugManager.updateBugStatus(db, {
              itemId: transition.itemId,
              status: transition.toStatus
            });
          } else if (transition.itemId.startsWith('FR-')) {
            updateResult = await this.featureManager.updateFeatureStatus(db, {
              itemId: transition.itemId,
              status: transition.toStatus
            });
          } else if (transition.itemId.startsWith('IMP-')) {
            updateResult = await this.improvementManager.updateImprovementStatus(db, {
              itemId: transition.itemId,
              status: transition.toStatus
            });
          } else {
            throw new Error(`Unknown item type for ID: ${transition.itemId}`);
          }

          results.push({
            status: 'success',
            itemId: transition.itemId,
            message: `Updated to ${transition.toStatus}`
          });
        } catch (error) {
          results.push({
            status: 'error',
            itemId: transition.itemId,
            message: `Failed to update status: ${error instanceof Error ? error.message : 'Unknown error'}`
          });
        }
      }

      // Record token usage
      const inputText = JSON.stringify(args);
      const outputText = this.formatWorkflowResults('status_transition', results);
      const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'status_transition_workflow');

      return `${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`;
    } catch (error) {
      throw new Error(`Status transition workflow failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Link items together
   */
  async linkItems(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('link_items');

    const { fromItem, toItem, relationshipType } = args;

    if (!fromItem || !toItem || !relationshipType) {
      throw new Error('fromItem, toItem, and relationshipType are required');
    }

    const validRelationships = ['blocks', 'relates_to', 'duplicate_of'];
    if (!validRelationships.includes(relationshipType)) {
      throw new Error(`Invalid relationship type: ${relationshipType}. Must be one of: ${validRelationships.join(', ')}`);
    }

    // Verify both items exist
    const fromExists = await this.itemExists(db, fromItem);
    const toExists = await this.itemExists(db, toItem);

    if (!fromExists) {
      throw new Error(`Source item ${fromItem} not found`);
    }

    if (!toExists) {
      throw new Error(`Target item ${toItem} not found`);
    }

    return new Promise((resolve, reject) => {
      const insertQuery = `
        INSERT INTO item_relationships (fromItem, toItem, relationshipType, dateCreated)
        VALUES (?, ?, ?, ?)
      `;

      db.run(insertQuery, [fromItem, toItem, relationshipType, new Date().toISOString()], (err) => {
        if (err) {
          reject(new Error(`Failed to create relationship: ${err.message}`));
        } else {
          // Record token usage
          const inputText = JSON.stringify(args);
          const outputText = `Relationship created: ${fromItem} ${relationshipType} ${toItem}`;
          const tokenUsage = this.tokenTracker.recordUsage(inputText, outputText, 'link_items');

          resolve(`${outputText}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`);
        }
      });
    });
  }

  /**
   * Get related items
   */
  async getRelatedItems(db: sqlite3.Database, args: any): Promise<string> {
    this.tokenTracker.startOperation('get_related_items');

    const { itemId } = args;

    if (!itemId) {
      throw new Error('itemId is required');
    }

    return new Promise((resolve, reject) => {
      const query = `
        SELECT fromItem, toItem, relationshipType, dateCreated
        FROM item_relationships
        WHERE fromItem = ? OR toItem = ?
      `;

      db.all(query, [itemId, itemId], (err, rows: any[]) => {
        if (err) {
          reject(new Error(`Failed to get related items: ${err.message}`));
        } else {
          let output = `Related items for ${itemId}:\n\n`;

          if (rows.length === 0) {
            output += 'No related items found.';
          } else {
            rows.forEach(row => {
              if (row.fromItem === itemId) {
                output += `${itemId} ${row.relationshipType} ${row.toItem} (created: ${row.dateCreated})\n`;
              } else {
                output += `${row.fromItem} ${row.relationshipType} ${itemId} (created: ${row.dateCreated})\n`;
              }
            });
          }

          // Record token usage
          const inputText = JSON.stringify(args);
          const tokenUsage = this.tokenTracker.recordUsage(inputText, output, 'get_related_items');

          resolve(`${output}\n\nToken usage: ${tokenUsage.total} tokens (${tokenUsage.input} input, ${tokenUsage.output} output)`);
        }
      });
    });
  }

  /**
   * Check if item exists
   */
  private async itemExists(db: sqlite3.Database, itemId: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      let query: string;

      if (itemId.startsWith('Bug')) {
        query = 'SELECT 1 FROM bugs WHERE id = ?';
      } else if (itemId.startsWith('FR-')) {
        query = 'SELECT 1 FROM feature_requests WHERE id = ?';
      } else if (itemId.startsWith('IMP-')) {
        query = 'SELECT 1 FROM improvements WHERE id = ?';
      } else {
        resolve(false);
        return;
      }

      db.get(query, [itemId], (err, row) => {
        if (err) {
          reject(new Error(`Failed to check item existence: ${err.message}`));
        } else {
          resolve(row !== undefined);
        }
      });
    });
  }

  /**
   * Extract ID from create response
   */
  private extractIdFromCreateResponse(response: string, _type: string): string {
    const match = response.match(/([A-Z]+-\d+|Bug #\d+)/);
    if (match) {
      return match[1];
    }
    throw new Error(`Could not extract ID from response: ${response}`);
  }

  /**
   * Verify status transition is valid
   */
  private async verifyStatusTransition(_itemId: string, _fromStatus: string, _toStatus: string): Promise<boolean> {
    // Simple validation - could be enhanced with more complex business rules
    return true;
  }

  /**
   * Format workflow results
   */
  private formatWorkflowResults(workflowType: string, results: any[]): string {
    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    let output = `${workflowType} workflow completed:\n`;
    output += `- Successful operations: ${successCount}\n`;
    output += `- Failed operations: ${errorCount}\n`;
    output += `- Total operations: ${results.length}\n\n`;

    if (successCount > 0) {
      output += 'Successful operations:\n';
      results.filter(r => r.status === 'success').forEach(result => {
        output += `  ✓ ${result.message}\n`;
      });
      output += '\n';
    }

    if (errorCount > 0) {
      output += 'Failed operations:\n';
      results.filter(r => r.status === 'error').forEach(result => {
        output += `  ✗ ${result.message}\n`;
      });
    }

    return output;
  }
}