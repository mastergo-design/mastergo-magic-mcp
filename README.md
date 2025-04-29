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

## Project Structure

### src Directory

The `src` directory contains the core implementation of the MasterGo Magic MCP service:

- `index.ts`: Entry point of the application that initializes the MCP server and registers all tools
- `http-util.ts`: Utility for handling HTTP requests to the MasterGo API
- `types.d.ts`: TypeScript type definitions for the project

#### src/tools

Contains implementations of MCP tools:

- `base-tool.ts`: Base class for all MCP tools
- `get-dsl.ts`: Tool for retrieving DSL (Domain Specific Language) data from MasterGo design files
- `get-component-link.ts`: Tool for retrieving component documentation from links
- `get-meta.ts`: Tool for retrieving metadata information
- `get-component-workflow.ts`: Tool providing structured component development workflow for Vue and React components, generating workflow files and component specifications

#### src/markdown

Contains markdown files with additional documentation:

- `meta.md`: Documentation about metadata structure and usage
- `component-workflow.md`: Component development workflow documentation guiding structured component development process

## Local Development

1. Run `yarn` and `yarn build` to install dependencies and build the code
2. Find the absolute path of `bin/cli.js`
3. Add local MCP configuration with your token

```json
"mastergo-mcp-local": {
  "command": "node",
  "args": [
    "absolute/path/to/bin/cli.js",
    "--token=mg_xxxxxx",
    "--url=https://mastergo.com",
    "--debug"
  ],
  "env": {}
},
```

4. Restart your editor to ensure the local MCP is enabled

After successful execution, you can debug based on the local running results. You can build your own MCP service based on your modifications.

We welcome your code contributions and look forward to building MasterGo's MCP service together.

## License

ISC
