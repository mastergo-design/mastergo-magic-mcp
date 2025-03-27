# MasterGo Magic MCP

MasterGo Magic MCP is a standalone MCP (Model Context Protocol) service designed to connect MasterGo design tools with AI models. It enables AI models to directly retrieve DSL data from MasterGo design files.

## Key Features

- Retrieves DSL data from MasterGo design files
- Runs directly with npx
- No external dependencies required, only Node.js environment needed

## Usage

### Obtaining MG_MCP_TOKEN

1. Visit https://mastergo.com
2. Enter personal settings
3. Click the Security Settings tab
4. Find the personal access token
5. Click to generate the token

### cursor Usage

Cursor Mcp usage guide reference: https://docs.cursor.com/context/model-context-protocol#using-mcp-tools-in-agent

```json
{
  "mcpServers": {
    "mastergo-magic-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "@mastergo/magic-mcp",
        "--token=<MG_MCP_TOKEN>",
        "--url=https://mastergo.com"
      ],
      "env": {}
    }
  }
}
```

### cline Usage

```json
{
  "mcpServers": {
    "@master/mastergo-magic-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "@mastergo/magic-mcp",
        "--token=<MG_MCP_TOKEN>",
        "--url=https://mastergo.com"
      ],
      "env": {}
    }
  }
}
```

## License

ISC
