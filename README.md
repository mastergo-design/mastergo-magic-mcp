# MasterGo Magic MCP

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/mastergo-design/mastergo-magic-mcp)

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

### Permission Requirements

**Important**: If the tool is connected but returns a "no permission" error, please check the following conditions:

1. **Account Version Requirement**:
   - Requires **Team Edition** or higher MasterGo account
   - Personal free edition does not support MCP tool access

2. **File Location Requirement**:
   - Design files must be placed in **Team Projects**
   - Files in draft box cannot be accessed via MCP tools

### Command Line Options

```
npx @mastergo/magic-mcp --token=YOUR_TOKEN [--url=API_URL] [--rule=RULE_NAME] [--debug] [--no-rule]
```

#### Parameters:

- `--token=YOUR_TOKEN` (required): MasterGo API token for authentication
- `--url=API_URL` (optional): API base URL, defaults to http://localhost:3000
- `--rule=RULE_NAME` (optional): Add design rules to apply, can be used multiple times
- `--debug` (optional): Enable debug mode for detailed error information
- `--no-rule` (optional): Disable default rules
- `--simplify` (optional): Enable DSL simplification, converting icon nodes to ICON_PLACEHOLDER to reduce token consumption (default: disabled)

You can also use space-separated format for parameters:

```
npx @mastergo/magic-mcp --token YOUR_TOKEN --url API_URL --rule RULE_NAME --debug
```

#### Environment Variables

Alternatively, you can use environment variables instead of command line arguments:

- `MG_MCP_TOKEN` or `MASTERGO_API_TOKEN`: MasterGo API token
- `API_BASE_URL`: API base URL
- `RULES`: JSON array of rules (e.g., `'["rule1", "rule2"]'`)

### Installing via Smithery Marketplace

Smithery is an MCP server marketplace that makes it easy to install and manage MCP services.

#### Method 1: Install via Smithery Website

1. Visit [Smithery Marketplace](https://smithery.ai/server/master/mastergo-magic-mcp-smithery)
2. Click the "Connect" or "Install" button
3. Select your MCP client (e.g., Claude Desktop, Cursor, etc.)
4. Follow the prompts to complete installation and configuration

### LINGMA Usage

Search for LINGMA in the VSCode extension marketplace and install it.

<img src="https://github.com/mastergo-design/mastergo-magic-mcp/blob/main/images/image-20250507174245589.png" alt="image-20250507174245589" style="zoom:25%;" />

After logging in, click on [MCP tools] in the chat box.

<img src="https://github.com/mastergo-design/mastergo-magic-mcp/blob/main/images/image-20250507174511910.png" alt="image-20250507174511910" style="zoom:25%;" />

Click on [MCP Square] at the top to enter the MCP marketplace, find the MasterGo design collaboration tool and install it.

<img src="https://github.com/mastergo-design/mastergo-magic-mcp/blob/main/images/image-20250507174840456.png" alt="image-20250507174840456" style="zoom:25%;" />

After installation, go back to [MCP Servers], and edit our MCP service to replace it with your own MasterGo token.

<img src="https://github.com/mastergo-design/mastergo-magic-mcp/blob/main/images/image-20250507175005364.png" alt="image-20250507175005364" style="zoom:25%;" />

Finally, switch the chat mode to agent mode in the chat interface.

<img src="https://github.com/mastergo-design/mastergo-magic-mcp/blob/main/images/image-20250507175107044.png" alt="image-20250507175107044" style="zoom:25%;" />

### cursor Usage

Cursor Mcp usage guide reference: https://docs.cursor.com/context/model-context-protocol#using-mcp-tools-in-agent

You can configure the MCP server using either command line arguments or environment variables:

**Option 1: Using command line arguments**

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

**Option 2: Using environment variables**

```json
{
  "mcpServers": {
    "mastergo-magic-mcp": {
      "command": "npx",
      "args": ["-y", "@mastergo/magic-mcp"],
      "env": {
        "MG_MCP_TOKEN": "<YOUR_TOKEN>",
        "API_BASE_URL": "https://mastergo.com"
      }
    }
  }
}
```

### cline Usage

**Option 1: Using command line arguments**

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

**Option 2: Using environment variables**

```json
{
  "mcpServers": {
    "@master/mastergo-magic-mcp": {
      "command": "npx",
      "args": ["-y", "@mastergo/magic-mcp"],
      "env": {
        "MG_MCP_TOKEN": "<YOUR_TOKEN>",
        "API_BASE_URL": "https://mastergo.com"
      }
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
2. Find the absolute path of `dist/index.js`
3. Add local MCP configuration with your token

```json
"mastergo-mcp-local": {
  "command": "node",
  "args": [
    "absolute/path/to/dist/index.js",
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
