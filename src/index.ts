#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GetDslTool } from "./tools/get-dsl";
import { GetComponentLinkTool } from "./tools/get-component-link";
import { GetMetaTool } from "./tools/get-meta";
import { GetComponentWorkflowTool } from "./tools/get-component-workflow";
import { GetVersionTool } from "./tools/get-version";
import { parserArgs } from "./utils/args";

// Main function
function main() {
  // Parse command line arguments and set environment variables
  const { token, baseUrl, rules, debug } = parserArgs();

  if (debug) {
    process.env.DEBUG = "true";
    console.log("Debug information:");
    console.log(`Token: ${token ? "set" : "not set"}`, token);
    console.log(`API URL: ${baseUrl || "default"}`);
    console.log(`Rules: ${rules.length > 0 ? rules.join(", ") : "none"}`);
    console.log(`Debug mode: enabled`);
  }

  // Create server instance
  const server = new McpServer({
    name: "MasterGoMcpServer",
    version: "0.0.1",
  });

  // Register tools
  new GetVersionTool().register(server);
  new GetDslTool().register(server);
  new GetComponentLinkTool().register(server);
  new GetMetaTool().register(server);
  new GetComponentWorkflowTool().register(server);

  // Connect to standard input/output
  server.connect(new StdioServerTransport());
}

// Start the program
main();
