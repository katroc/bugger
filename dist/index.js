#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError, } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import { formatBugs, formatFeatureRequests, formatImprovements, formatSearchResults, formatStatistics } from './format.js';
import path from 'path';
class ProjectManagementServer {
    server;
    baseDir;
    constructor(baseDir = './') {
        this.baseDir = baseDir;
        this.server = new Server({
            name: 'bugger-mcp',
            version: '0.1.0',
            capabilities: {
                tools: {},
            },
        });
        this.setupToolHandlers();
    }
    setupToolHandlers() {
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
                            stepsToReproduce: { type: 'array', items: { type: 'string' }, description: 'Steps to reproduce the bug' },
                            filesLikelyInvolved: { type: 'array', items: { type: 'string' }, description: 'Files that might be involved' }
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
                            effortEstimate: { type: 'string', enum: ['Small', 'Medium', 'Large', 'XL'] },
                            requestedBy: { type: 'string', description: 'Who requested this feature' }
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
                            effortEstimate: { type: 'string', enum: ['Small', 'Medium', 'Large'] },
                            requestedBy: { type: 'string', description: 'Who requested this improvement' }
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
            ],
        }));
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            try {
                switch (request.params.name) {
                    case 'create_bug':
                        return await this.createBug(request.params.arguments);
                    case 'create_feature_request':
                        return await this.createFeatureRequest(request.params.arguments);
                    case 'create_improvement':
                        return await this.createImprovement(request.params.arguments);
                    case 'list_bugs':
                        return await this.listBugs(request.params.arguments);
                    case 'list_feature_requests':
                        return await this.listFeatureRequests(request.params.arguments);
                    case 'list_improvements':
                        return await this.listImprovements(request.params.arguments);
                    case 'update_bug_status':
                        return await this.updateBugStatus(request.params.arguments);
                    case 'update_feature_status':
                        return await this.updateFeatureStatus(request.params.arguments);
                    case 'update_improvement_status':
                        return await this.updateImprovementStatus(request.params.arguments);
                    case 'search_items':
                        return await this.searchItems(request.params.arguments);
                    case 'get_statistics':
                        return await this.getStatistics(request.params.arguments);
                    case 'sync_from_markdown':
                        return await this.syncFromMarkdown(request.params.arguments);
                    default:
                        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
                }
            }
            catch (error) {
                if (error instanceof McpError) {
                    throw error;
                }
                throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${error}`);
            }
        });
    }
    async ensureDataFiles() {
        const dataDir = path.join(this.baseDir, 'data');
        await fs.mkdir(dataDir, { recursive: true });
        const files = ['bugs.json', 'features.json', 'improvements.json'];
        for (const file of files) {
            const filePath = path.join(dataDir, file);
            try {
                await fs.access(filePath);
            }
            catch {
                await fs.writeFile(filePath, JSON.stringify([], null, 2));
            }
        }
    }
    async loadData(type) {
        await this.ensureDataFiles();
        const filePath = path.join(this.baseDir, 'data', `${type}.json`);
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data);
    }
    async saveData(type, data) {
        await this.ensureDataFiles();
        const filePath = path.join(this.baseDir, 'data', `${type}.json`);
        await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    }
    generateNextId(type, existing) {
        const prefixes = { bug: 'Bug #', feature: 'FR-', improvement: 'IMP-' };
        const prefix = prefixes[type];
        const numbers = existing
            .map(item => {
            const match = item.id.match(new RegExp(`${prefix.replace('#', '\\#')}(\\d+)`));
            return match ? parseInt(match[1]) : 0;
        })
            .filter(n => !isNaN(n));
        const nextNumber = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
        return type === 'bug' ? `Bug #${nextNumber.toString().padStart(3, '0')}` :
            type === 'feature' ? `FR-${nextNumber.toString().padStart(3, '0')}` :
                `IMP-${nextNumber.toString().padStart(3, '0')}`;
    }
    async createBug(args) {
        const bugs = await this.loadData('bugs');
        const newBug = {
            id: this.generateNextId('bug', bugs),
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
        bugs.push(newBug);
        await this.saveData('bugs', bugs);
        await this.syncToMarkdown();
        return {
            content: [
                {
                    type: 'text',
                    text: `Created new bug: ${newBug.id} - ${newBug.title}`
                }
            ]
        };
    }
    async createFeatureRequest(args) {
        const features = await this.loadData('features');
        const newFeature = {
            id: this.generateNextId('feature', features),
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
        features.push(newFeature);
        await this.saveData('features', features);
        await this.syncToMarkdown();
        return {
            content: [
                {
                    type: 'text',
                    text: `Created new feature request: ${newFeature.id} - ${newFeature.title}`
                }
            ]
        };
    }
    async createImprovement(args) {
        const improvements = await this.loadData('improvements');
        const newImprovement = {
            id: this.generateNextId('improvement', improvements),
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
        improvements.push(newImprovement);
        await this.saveData('improvements', improvements);
        await this.syncToMarkdown();
        return {
            content: [
                {
                    type: 'text',
                    text: `Created new improvement: ${newImprovement.id} - ${newImprovement.title}`
                }
            ]
        };
    }
    async listBugs(args) {
        const bugs = await this.loadData('bugs');
        let filtered = bugs;
        if (args.status)
            filtered = filtered.filter(b => b.status === args.status);
        if (args.priority)
            filtered = filtered.filter(b => b.priority === args.priority);
        if (args.component)
            filtered = filtered.filter(b => b.component.toLowerCase().includes(args.component.toLowerCase()));
        return {
            content: [
                {
                    type: 'text',
                    text: formatBugs(filtered)
                }
            ]
        };
    }
    async listFeatureRequests(args) {
        const features = await this.loadData('features');
        let filtered = features;
        if (args.status)
            filtered = filtered.filter(f => f.status === args.status);
        if (args.priority)
            filtered = filtered.filter(f => f.priority === args.priority);
        if (args.category)
            filtered = filtered.filter(f => f.category.toLowerCase().includes(args.category.toLowerCase()));
        return {
            content: [
                {
                    type: 'text',
                    text: formatFeatureRequests(filtered)
                }
            ]
        };
    }
    async listImprovements(args) {
        const improvements = await this.loadData('improvements');
        let filtered = improvements;
        if (args.status)
            filtered = filtered.filter(i => i.status === args.status);
        if (args.priority)
            filtered = filtered.filter(i => i.priority === args.priority);
        if (args.category)
            filtered = filtered.filter(i => i.category.toLowerCase().includes(args.category.toLowerCase()));
        return {
            content: [
                {
                    type: 'text',
                    text: formatImprovements(filtered)
                }
            ]
        };
    }
    async updateBugStatus(args) {
        const bugs = await this.loadData('bugs');
        const bugIndex = bugs.findIndex(b => b.id === args.bugId);
        if (bugIndex === -1) {
            throw new McpError(ErrorCode.InvalidParams, `Bug ${args.bugId} not found`);
        }
        bugs[bugIndex].status = args.status;
        if (args.humanVerified !== undefined) {
            bugs[bugIndex].humanVerified = args.humanVerified;
        }
        await this.saveData('bugs', bugs);
        await this.syncToMarkdown();
        return {
            content: [
                {
                    type: 'text',
                    text: `Updated ${args.bugId} status to ${args.status}`
                }
            ]
        };
    }
    async updateFeatureStatus(args) {
        const features = await this.loadData('features');
        const featureIndex = features.findIndex(f => f.id === args.featureId);
        if (featureIndex === -1) {
            throw new McpError(ErrorCode.InvalidParams, `Feature ${args.featureId} not found`);
        }
        features[featureIndex].status = args.status;
        await this.saveData('features', features);
        await this.syncToMarkdown();
        return {
            content: [
                {
                    type: 'text',
                    text: `Updated ${args.featureId} status to ${args.status}`
                }
            ]
        };
    }
    async updateImprovementStatus(args) {
        const improvements = await this.loadData('improvements');
        const improvementIndex = improvements.findIndex(i => i.id === args.improvementId);
        if (improvementIndex === -1) {
            throw new McpError(ErrorCode.InvalidParams, `Improvement ${args.improvementId} not found`);
        }
        improvements[improvementIndex].status = args.status;
        if (args.dateCompleted) {
            improvements[improvementIndex].dateCompleted = args.dateCompleted;
        }
        await this.saveData('improvements', improvements);
        await this.syncToMarkdown();
        return {
            content: [
                {
                    type: 'text',
                    text: `Updated ${args.improvementId} status to ${args.status}`
                }
            ]
        };
    }
    async searchItems(args) {
        const query = args.query.toLowerCase();
        const searchType = args.type || 'all';
        const results = [];
        if (searchType === 'bugs' || searchType === 'all') {
            const bugs = await this.loadData('bugs');
            const matchingBugs = bugs.filter(b => b.title.toLowerCase().includes(query) ||
                b.description.toLowerCase().includes(query) ||
                b.component.toLowerCase().includes(query));
            results.push(...matchingBugs.map(b => ({ type: 'bug', ...b })));
        }
        if (searchType === 'features' || searchType === 'all') {
            const features = await this.loadData('features');
            const matchingFeatures = features.filter(f => f.title.toLowerCase().includes(query) ||
                f.description.toLowerCase().includes(query) ||
                f.category.toLowerCase().includes(query));
            results.push(...matchingFeatures.map(f => ({ type: 'feature', ...f })));
        }
        if (searchType === 'improvements' || searchType === 'all') {
            const improvements = await this.loadData('improvements');
            const matchingImprovements = improvements.filter(i => i.title.toLowerCase().includes(query) ||
                i.description.toLowerCase().includes(query) ||
                i.category.toLowerCase().includes(query));
            results.push(...matchingImprovements.map(i => ({ type: 'improvement', ...i })));
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
    async getStatistics(args) {
        const type = args.type || 'all';
        const stats = {};
        if (type === 'bugs' || type === 'all') {
            const bugs = await this.loadData('bugs');
            stats.bugs = {
                total: bugs.length,
                byStatus: bugs.reduce((acc, bug) => {
                    acc[bug.status] = (acc[bug.status] || 0) + 1;
                    return acc;
                }, {}),
                byPriority: bugs.reduce((acc, bug) => {
                    acc[bug.priority] = (acc[bug.priority] || 0) + 1;
                    return acc;
                }, {})
            };
        }
        if (type === 'features' || type === 'all') {
            const features = await this.loadData('features');
            stats.features = {
                total: features.length,
                byStatus: features.reduce((acc, feature) => {
                    acc[feature.status] = (acc[feature.status] || 0) + 1;
                    return acc;
                }, {}),
                byPriority: features.reduce((acc, feature) => {
                    acc[feature.priority] = (acc[feature.priority] || 0) + 1;
                    return acc;
                }, {})
            };
        }
        if (type === 'improvements' || type === 'all') {
            const improvements = await this.loadData('improvements');
            stats.improvements = {
                total: improvements.length,
                byStatus: improvements.reduce((acc, improvement) => {
                    acc[improvement.status] = (acc[improvement.status] || 0) + 1;
                    return acc;
                }, {}),
                byPriority: improvements.reduce((acc, improvement) => {
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
    async syncFromMarkdown(args) {
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
    async syncToMarkdown() {
        // This would update your markdown files with current data
        // Implementation would generate markdown from the JSON data
        // For now, we'll just ensure data persistence in JSON format
    }
    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('Project Management MCP server running on stdio');
    }
}
// Run the server
const server = new ProjectManagementServer();
server.run().catch(console.error);
//# sourceMappingURL=index.js.map