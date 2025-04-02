# MasterGo Magic MCP

MasterGo Magic MCP is a standalone MCP (Model Context Protocol) service designed to connect MasterGo design tools with AI models. It enables AI models to directly retrieve DSL data from MasterGo design files.

## Key Features

- Retrieves DSL data from MasterGo design files
- Runs directly with npx
- No external dependencies required, only Node.js environment needed

## Tutorial

- https://mastergo.com/file/155675508499265?page_id=158:0002

## Usage

### Obtaining MG_MCP_TOKEN

1. Visit https://mastergo.com
2. Enter personal settings
3. Click the Security Settings tab
4. Find the personal access token
5. Click to generate the token

### Command Line Options

```
npx @mastergo/magic-mcp --token=YOUR_TOKEN [--url=API_URL] [--rule=RULE_NAME] [--debug]
```

#### Parameters:

- `--token=YOUR_TOKEN` (required): MasterGo API token for authentication
- `--url=API_URL` (optional): API base URL, defaults to http://localhost:3000
- `--rule=RULE_NAME` (optional): Add design rules to apply, can be used multiple times
- `--debug` (optional): Enable debug mode for detailed error information

You can also use space-separated format for parameters:

```
npx @mastergo/magic-mcp --token YOUR_TOKEN --url API_URL --rule RULE_NAME --debug
```

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
