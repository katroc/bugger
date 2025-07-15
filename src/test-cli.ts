#!/usr/bin/env node

/**
 * CLI tool for testing the Project Management MCP Server
 */

import { spawn } from 'child_process';
import readline from 'readline';

class MCPTester {
  private mcpProcess: any;
  private rl: readline.Interface;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  async start() {
    console.log('🚀 Starting Project Management MCP Server Test CLI\n');
    
    // Start the MCP server
    this.mcpProcess = spawn('node', ['dist/index.js'], {
      stdio: ['pipe', 'pipe', 'inherit']
    });

    this.mcpProcess.on('error', (error: Error) => {
      console.error('Failed to start MCP server:', error);
      process.exit(1);
    });

    // Wait a moment for server to start
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Initialize MCP
    await this.sendMCPMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {
          roots: {
            listChanged: true
          }
        },
        clientInfo: {
          name: 'test-cli',
          version: '1.0.0'
        }
      }
    });

    // Get available tools
    await this.sendMCPMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {}
    });

    this.showMenu();
  }

  private async sendMCPMessage(message: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const messageStr = JSON.stringify(message) + '\n';
      
      this.mcpProcess.stdin.write(messageStr);
      
      const timeout = setTimeout(() => {
        reject(new Error('Request timeout'));
      }, 5000);

      const handleData = (data: Buffer) => {
        clearTimeout(timeout);
        this.mcpProcess.stdout.removeListener('data', handleData);
        
        try {
          const response = JSON.parse(data.toString().trim());
          console.log('📨 Response:', JSON.stringify(response, null, 2));
          resolve(response);
        } catch (error) {
          reject(error);
        }
      };

      this.mcpProcess.stdout.once('data', handleData);
    });
  }

  private showMenu() {
    console.log('\n📋 Available Commands:');
    console.log('1. Create Bug');
    console.log('2. Create Feature Request');
    console.log('3. Create Improvement');
    console.log('4. List Bugs');
    console.log('5. List Features');
    console.log('6. List Improvements');
    console.log('7. Update Bug Status');
    console.log('8. Search Items');
    console.log('9. Get Statistics');
    console.log('0. Exit');
    
    this.rl.question('\nEnter command number: ', (answer) => {
      this.handleCommand(answer.trim());
    });
  }

  private async handleCommand(command: string) {
    try {
      switch (command) {
        case '1':
          await this.createBugInteractive();
          break;
        case '2':
          await this.createFeatureInteractive();
          break;
        case '3':
          await this.createImprovementInteractive();
          break;
        case '4':
          await this.listBugs();
          break;
        case '5':
          await this.listFeatures();
          break;
        case '6':
          await this.listImprovements();
          break;
        case '7':
          await this.updateBugStatusInteractive();
          break;
        case '8':
          await this.searchInteractive();
          break;
        case '9':
          await this.getStatistics();
          break;
        case '0':
          this.exit();
          return;
        default:
          console.log('❌ Invalid command');
      }
    } catch (error) {
      console.error('❌ Command failed:', error);
    }
    
    this.showMenu();
  }

  private async createBugInteractive() {
    console.log('\n🐛 Creating New Bug:');
    
    const title = await this.question('Title: ');
    const description = await this.question('Description: ');
    const component = await this.question('Component: ');
    const priority = await this.question('Priority (Low/Medium/High/Critical): ');
    const expectedBehavior = await this.question('Expected Behavior: ');
    const actualBehavior = await this.question('Actual Behavior: ');

    await this.sendMCPMessage({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'create_bug',
        arguments: {
          title,
          description,
          component,
          priority,
          expectedBehavior,
          actualBehavior
        }
      }
    });
  }

  private async createFeatureInteractive() {
    console.log('\n🚀 Creating New Feature Request:');
    
    const title = await this.question('Title: ');
    const description = await this.question('Description: ');
    const category = await this.question('Category: ');
    const priority = await this.question('Priority (Low/Medium/High/Critical): ');
    const userStory = await this.question('User Story: ');
    const currentBehavior = await this.question('Current Behavior: ');
    const expectedBehavior = await this.question('Expected Behavior: ');
    const criteria = await this.question('Acceptance Criteria (comma-separated): ');

    await this.sendMCPMessage({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'create_feature_request',
        arguments: {
          title,
          description,
          category,
          priority,
          userStory,
          currentBehavior,
          expectedBehavior,
          acceptanceCriteria: criteria.split(',').map(c => c.trim()).filter(Boolean)
        }
      }
    });
  }

  private async createImprovementInteractive() {
    console.log('\n🔧 Creating New Improvement:');
    
    const title = await this.question('Title: ');
    const description = await this.question('Description: ');
    const category = await this.question('Category: ');
    const priority = await this.question('Priority (Low/Medium/High): ');
    const currentState = await this.question('Current State: ');
    const desiredState = await this.question('Desired State: ');
    const criteria = await this.question('Acceptance Criteria (comma-separated): ');

    await this.sendMCPMessage({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'create_improvement',
        arguments: {
          title,
          description,
          category,
          priority,
          currentState,
          desiredState,
          acceptanceCriteria: criteria.split(',').map(c => c.trim()).filter(Boolean)
        }
      }
    });
  }

  private async listBugs() {
    await this.sendMCPMessage({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'list_bugs',
        arguments: {}
      }
    });
  }

  private async listFeatures() {
    await this.sendMCPMessage({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'list_feature_requests',
        arguments: {}
      }
    });
  }

  private async listImprovements() {
    await this.sendMCPMessage({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'list_improvements',
        arguments: {}
      }
    });
  }

  private async updateBugStatusInteractive() {
    const bugId = await this.question('Bug ID (e.g., Bug #001): ');
    const status = await this.question('New Status (Open/In Progress/Fixed/Closed): ');

    await this.sendMCPMessage({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'update_bug_status',
        arguments: {
          bugId,
          status
        }
      }
    });
  }

  private async searchInteractive() {
    const query = await this.question('Search query: ');
    const type = await this.question('Type (bugs/features/improvements/all): ') || 'all';

    await this.sendMCPMessage({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'search_items',
        arguments: {
          query,
          type
        }
      }
    });
  }

  private async getStatistics() {
    await this.sendMCPMessage({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'get_statistics',
        arguments: {
          type: 'all'
        }
      }
    });
  }

  private question(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(prompt, (answer) => {
        resolve(answer.trim());
      });
    });
  }

  private exit() {
    console.log('\n👋 Goodbye!');
    if (this.mcpProcess) {
      this.mcpProcess.kill();
    }
    this.rl.close();
    process.exit(0);
  }
}

// Start the tester
const tester = new MCPTester();
tester.start().catch(console.error);