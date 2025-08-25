# bugger-mcp

A comprehensive Model Context Protocol (MCP) server that transforms how you manage project tracking. Seamlessly create, track, and manage bugs, feature requests, and improvements using natural language conversations with your AI assistant.

Built for developers who want to stay in their flow state, bugger-mcp integrates directly with Claude, Cursor, Windsurf, and other MCP-compatible tools. No more context switching between your IDE and external tracking tools - manage your entire project lifecycle through simple conversations.

**Version 0.4.12** - Now with streamlined architecture focused on core project management.

**Key Features:**
- 🐛 **Bug Tracking** - Create detailed bug reports with reproduction steps, priorities, and component tracking
- ✨ **Feature Management** - Plan new functionality with user stories, acceptance criteria, and effort estimates  
- 🔧 **Improvement Tracking** - Manage technical debt, code quality improvements, and optimization tasks
- 🔍 **Advanced Search** - Find items across your entire project with full-text search and filtering
- 📊 **Analytics** - Get insights into project health with comprehensive statistics and reporting
- 🔗 **Relationship Management** - Link related items to track dependencies and connections
- 🔍 **Semantic Search** - AI-powered similarity matching to find related items by meaning, not just keywords
- 🔄 **Workflow Automation** - Execute complex multi-step operations with predefined workflows
- 📝 **Context Management** - Automatically collect and maintain relevant code snippets and file references
- 💬 **Natural Language Interface** - Use conversational commands instead of complex UI interactions
- 🏗️ **Modular Architecture** - Clean, maintainable codebase with focused manager classes

## MCP Server Setup

### Claude Code

Add the following to your MCP configuration:

```json
{
  "mcpServers": {
    "bugger": {
      "command": "npx",
      "args": [
        "-y",
        "bugger-mcp@latest"
      ]
    }
  }
}
```

### WSL Configuration

For Windows users running WSL, use this configuration instead:

```json
{
  "mcpServers": {
    "bugger": {
      "command": "wsl",
      "args": [
        "npx",
        "-y",
        "bugger-mcp@latest"
      ]
    }
  }
}
```

### Other IDEs

The configuration is similar for other MCP-compatible tools like Cursor, Windsurf, Continue.dev, and Zed. Use the same command (`npx`) and args (`["-y", "bugger-mcp@latest"]`) in their respective MCP configuration formats.

## Available Tools

Once installed, you'll have access to these MCP tools:

### Core Management
- **create_item**: Create new bugs, feature requests, or improvements with detailed information including title, description, priority, and type-specific fields. Use when you discover issues, plan features, or identify improvement opportunities.
- **list_items**: List bugs, features, or improvements with optional filtering by status, priority, component, or category. Use to get an overview of current work or find specific items.
- **update_item_status**: Update the status of individual items (bugs, features, or improvements). Use when item status changes during development.
- **bulk_update_items**: Update multiple items in a single operation. Use for batch operations like closing multiple resolved items or updating priorities.

### Search & Analytics
- **search_items**: Advanced search across all items with filtering, sorting, and pagination. Use to find specific items or analyze patterns across your project.
- **get_statistics**: Generate project statistics for bugs, features, improvements, or all items. Use to get insights into project health and progress.
- **get_related_items**: Find items related to a specific bug, feature, or improvement. Use to understand dependencies and relationships.

### Relationships
- **link_items**: Create relationships between items (blocks, relates_to, duplicate_of). Use to track dependencies and connections between different issues.

### Advanced Features
- **execute_workflow**: Execute predefined workflows for common multi-step operations like creating and linking multiple items, batch context collection, or status transitions. Use to automate complex project management tasks.
- **manage_contexts**: Unified context management for tasks - collect, get, check freshness, add, update, or remove code contexts. Use to maintain relevant code snippets, file references, and dependencies for each item.
- **search_semantic**: Perform semantic search using vector embeddings to find similar items based on meaning rather than keywords. Use to discover related bugs, features, or improvements by context and intent.

## Usage Examples

After installation, you can use natural language with your AI assistant to manage your project tracking:

### Item Management
- "Create a new bug report for the login form validation issue - users can't submit forms with special characters in their email addresses"
- "Create a feature request for dark mode support with user story: As a user, I want to toggle between light and dark themes so I can use the app comfortably in different lighting conditions"
- "Create an improvement suggestion to refactor the authentication service for better performance and maintainability"
- "List all open bugs in the authentication component that have high priority"
- "List all approved feature requests that are ready for development"
- "List all improvements related to code quality that haven't been started yet"

### Status Management
- "Update bug #003 status to 'In Progress' since I'm working on it now"
- "Update the user dashboard redesign feature to 'In Development' status"
- "Mark the database optimization improvement as completed"
- "Update multiple items at once - mark bugs #001, #002, and #005 as fixed since they're resolved in the latest release"

### Search & Analytics
- "Search for all items containing 'authentication' to see what work is planned or in progress"
- "Give me project statistics to see how many bugs, features, and improvements we have"
- "Find all high-priority items that are currently open across bugs, features, and improvements"
- "Show me all bugs that were closed this week"
- "Show me all feature requests in the UI category that have medium or high priority"

### Relationships & Context
- "What's the current status of bug #001 and show me any related items?"
- "Link bug #004 as blocking feature request FR-002 since we need to fix the API issue first"
- "Show me all items related to the user management system"
- "Create a relationship between improvement IMP-001 and bug #007 since they're related to the same code area"
- "Collect code context for bug #001 to understand the files and dependencies involved"
- "Add a code snippet context to improvement IMP-003 showing the current implementation that needs refactoring"

### Advanced Workflows
- "Execute a workflow to create multiple related items and link them together"
- "Run a batch context collection for all items in the authentication component"
- "Execute a status transition workflow to move all 'Fixed' bugs to 'Closed' after verification"

### Semantic Search
- "Find items similar to 'user authentication issues' using semantic search"
- "Search for bugs semantically related to 'database connection problems'"
- "Discover features similar to 'dark mode implementation' through semantic matching"
- "Find improvements semantically related to 'performance optimization'"

#### Search Indexing Notes
- The server automatically refreshes its full-text index shortly after item mutations (create/update/bulk/workflow), so agents can run `search_semantic` without manual steps.
- For large imports or after enabling FTS5 on your SQLite build, run the `rebuild_search_index` tool once to initialize/refill the index.
- If FTS5 is unavailable, the server falls back to approximate similarity (Jaccard) so results still work, just less precise.

#### File Context Safety
- The server reads file contexts only within `CONTEXT_ROOT` (default: the current working directory). Paths outside this root are denied for safety when agents provide file lists.
- Very large files (>1MB) are skipped to keep responses fast and resource usage low for agents.

## Context Management

bugger-mcp includes advanced context management capabilities that help you maintain relevant code snippets, file references, and dependencies for each item. This feature automatically tracks:

- **Code Snippets**: Relevant code sections that relate to bugs, features, or improvements
- **File References**: Files that are likely involved in implementing or fixing items
- **Dependencies**: Related libraries, frameworks, or system components
- **Pattern Recognition**: Automatic detection of similar code patterns across your project

Context management supports operations like:
- **Collect**: Automatically gather relevant context for an item based on its description
- **Add**: Manually add specific code snippets or file references
- **Update**: Modify existing context information
- **Remove**: Clean up outdated or irrelevant context data
- **Check Freshness**: Verify that context information is still current

## Workflow Automation

Execute predefined workflows for common multi-step operations:

- **Create and Link**: Create multiple related items and automatically establish relationships between them
- **Batch Context Collection**: Collect code context for multiple items simultaneously
- **Status Transitions**: Perform bulk status updates with validation and verification steps

These workflows help automate repetitive project management tasks and ensure consistency across your tracking process.

## Token Usage Tracking

bugger-mcp now includes per-call token usage tracking and display, helping you monitor AI assistant resource consumption during project management sessions. This feature provides visibility into:

- Input and output tokens for each operation
- Session-level token totals
- Usage patterns across different tool types

## Architecture

### Modular Design (v0.4.8+)

bugger-mcp features a clean, modular architecture that separates concerns into focused manager classes:

- **BugManager**: Handles all bug-related operations including creation, status updates, and validation
- **FeatureManager**: Manages feature requests with user stories, acceptance criteria, and effort estimation
- **ImprovementManager**: Tracks technical debt, code quality improvements, and optimization tasks
- **SearchManager**: Provides advanced search capabilities, filtering, and project statistics
- **ContextManager**: Manages code context collection, file references, and dependency tracking
- **WorkflowManager**: Orchestrates complex multi-step operations and item relationships

This modular approach ensures better maintainability, easier testing, and cleaner separation of responsibilities while maintaining full backward compatibility.

### Storage Architecture

bugger-mcp uses SQLite for data storage, providing fast indexed searches, ACID transactions, and full-text search capabilities that scale well as projects grow. The single-file database approach offers the reliability and performance of a proper database without requiring server setup, while still supporting complex queries, relationships between items, and concurrent access from multiple AI assistant sessions.

## Database Location

The `bugger.db` file is created in your current working directory when you first use the MCP server. This means each project gets its own isolated tracking database, keeping your bugs, features, and improvements organized per project. You can backup, version control, or share the database file as needed - it's completely portable and self-contained.

## Development

```bash
npm run dev
```

## License

[MIT](LICENSE)
## Configuration
- `DB_PATH`: Path to the SQLite database file (default: `bugger.db`).
- `CONTEXT_ROOT`: Absolute path restricting file context reads to a safe subtree (default: current working directory). Paths outside this root are denied.
- `LOG_LEVEL`: `debug`, `info`, `warn`, or `error` (default: `info`). Controls server logging verbosity for easier agent/operator troubleshooting.
