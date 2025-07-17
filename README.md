# bugger-mcp

A comprehensive Model Context Protocol (MCP) server that transforms how you manage project tracking. Seamlessly create, track, and manage bugs, feature requests, and improvements using natural language conversations with your AI assistant.

Built for developers who want to stay in their flow state, bugger-mcp integrates directly with Claude, Cursor, Windsurf, and other MCP-compatible tools. No more context switching between your IDE and external tracking tools - manage your entire project lifecycle through simple conversations.

**Key Features:**
- 🐛 **Bug Tracking** - Create detailed bug reports with reproduction steps, priorities, and component tracking
- ✨ **Feature Management** - Plan new functionality with user stories, acceptance criteria, and effort estimates  
- 🔧 **Improvement Tracking** - Manage technical debt, code quality improvements, and optimization tasks
- 🔍 **Advanced Search** - Find items across your entire project with full-text search and filtering
- 📊 **Analytics** - Get insights into project health with comprehensive statistics and reporting
- 🔗 **Relationship Management** - Link related items to track dependencies and connections
- 💬 **Natural Language Interface** - Use conversational commands instead of complex UI interactions

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

### Bug Management
- **create_bug**: Create new bug reports with detailed information including title, description, priority, component, and reproduction steps. Use when you discover issues that need tracking.
- **list_bugs**: List all bugs with optional filtering by status, priority, or component. Use to get an overview of current issues or find specific bugs.
- **update_bug_status**: Update the status of individual bugs (Open, In Progress, Fixed, Closed, Temporarily Resolved). Use when bug status changes during development.
- **bulk_update_bug_status**: Update multiple bug statuses in a single operation. Use for batch operations like closing multiple resolved bugs.

### Feature Requests
- **create_feature_request**: Create new feature requests with user stories, acceptance criteria, and effort estimates. Use when planning new functionality.
- **list_feature_requests**: List all feature requests with optional filtering by status, priority, or category. Use to review planned features or find specific requests.
- **update_feature_status**: Update feature request status (Proposed, In Discussion, Approved, In Development, etc.). Use to track feature development progress.
- **bulk_update_feature_status**: Update multiple feature request statuses at once. Use for batch status updates during sprint planning.

### Improvements
- **create_improvement**: Create improvement suggestions for code quality, performance, or technical debt. Use when identifying areas for enhancement.
- **list_improvements**: List all improvements with optional filtering. Use to review technical debt and optimization opportunities.
- **update_improvement_status**: Update improvement status and completion dates. Use to track progress on code quality initiatives.
- **bulk_update_improvement_status**: Update multiple improvement statuses simultaneously. Use for batch updates during refactoring sprints.

### Search & Analytics
- **search_items**: Advanced search across all items with filtering, sorting, and pagination. Use to find specific items or analyze patterns across your project.
- **get_statistics**: Generate project statistics for bugs, features, improvements, or all items. Use to get insights into project health and progress.
- **get_related_items**: Find items related to a specific bug, feature, or improvement. Use to understand dependencies and relationships.

### Relationships & Sync
- **link_items**: Create relationships between items (blocks, relates_to, duplicate_of). Use to track dependencies and connections between different issues.
- **sync_from_markdown**: Import existing data from markdown files. Use when migrating from other tracking systems or initializing the database.

## Usage Examples

After installation, you can use natural language with your AI assistant to manage your project tracking:

### Bug Tracking
- "Create a new bug report for the login form validation issue - users can't submit forms with special characters in their email addresses"
- "List all open bugs in the authentication component that have high priority"
- "Update bug #003 status to 'In Progress' since I'm working on it now"
- "Show me all bugs that were closed this week"
- "Mark bugs #001, #002, and #005 as fixed since they're resolved in the latest release"

### Feature Management
- "Create a feature request for dark mode support with user story: As a user, I want to toggle between light and dark themes so I can use the app comfortably in different lighting conditions"
- "List all approved feature requests that are ready for development"
- "Update the user dashboard redesign feature to 'In Development' status"
- "Show me all feature requests in the UI category that have medium or high priority"

### Improvement Tracking
- "Create an improvement suggestion to refactor the authentication service for better performance and maintainability"
- "List all improvements related to code quality that haven't been started yet"
- "Mark the database optimization improvement as completed"
- "Show me technical debt items that should be prioritized this sprint"

### Analytics & Search
- "What's the current status of bug #001 and show me any related items?"
- "Search for all items containing 'authentication' to see what work is planned or in progress"
- "Give me project statistics to see how many bugs, features, and improvements we have"
- "Find all high-priority items that are currently open across bugs, features, and improvements"

### Relationship Management
- "Link bug #004 as blocking feature request FR-002 since we need to fix the API issue first"
- "Show me all items related to the user management system"
- "Create a relationship between improvement IMP-001 and bug #007 since they're related to the same code area"

## Storage Architecture

bugger-mcp uses SQLite for data storage, providing fast indexed searches, ACID transactions, and full-text search capabilities that scale well as projects grow. The single-file database approach offers the reliability and performance of a proper database without requiring server setup, while still supporting complex queries, relationships between items, and concurrent access from multiple AI assistant sessions.

## Database Location

The `bugger.db` file is created in your current working directory when you first use the MCP server. This means each project gets its own isolated tracking database, keeping your bugs, features, and improvements organized per project. You can backup, version control, or share the database file as needed - it's completely portable and self-contained.

## Development

```bash
npm run dev
```

## License

[MIT](LICENSE)
