# bugger-mcp

MCP Server for managing bugs, feature requests, and improvements. Track bugs, feature requests, and improvements directly from your favorite IDE or AI assistant.

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

### Other IDEs

The configuration is similar for other MCP-compatible tools like Cursor, Windsurf, Continue.dev, and Zed. Use the same command (`npx`) and args (`["-y", "bugger-mcp@latest"]`) in their respective MCP configuration formats.

## Available Tools

Once installed, you'll have access to these MCP tools:

- **Bug Management**: Create, list, update, and search bugs
- **Feature Requests**: Track and manage feature requests
- **Improvements**: Handle code improvements and technical debt
- **Statistics**: Get project statistics and insights
- **Search**: Search across all items with full-text search

## Usage Examples

After installation, you can use natural language with your AI assistant:

- "Create a new bug report for the login issue"
- "List all high-priority feature requests"
- "Show me improvement suggestions for the authentication module"
- "What's the current status of bug #001?"

## Development

```bash
npm run dev
```

## License

[MIT](LICENSE)
