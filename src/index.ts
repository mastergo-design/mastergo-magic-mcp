#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { HttpUtil } from "./http-util";
import { GetDslTool } from "./tools/get-dsl";
import { GetComponentLinkTool } from "./tools/get-component-link";
import { GetMetaTool } from "./tools/get-meta";
import { GetComponentWorkflowTool } from "./tools/get-component-workflow";

// Logging function, only outputs when the DEBUG environment variable is true
const log = (message: string) => {
  if (process.env.DEBUG === "true") {
    console.log(message);
  }
};

// Main function
function main() {
  // Retrieve token and baseUrl from environment variables
  const token = process.env.MASTERGO_API_TOKEN;
  const baseUrl = process.env.API_BASE_URL || "http://localhost:3000";
  const debug = process.env.DEBUG === "true";

  if (!token) {
    console.error("Error: MASTERGO_API_TOKEN environment variable not set");
    process.exit(1);
  }

  log(`Starting MasterGo MCP server...`);
  log(`API base URL: ${baseUrl}`);

  // Create server instance
  const server = new McpServer({
    name: "MasterGoMcpServer",
    version: "0.0.1",
  });

  // Create HTTP utility
  const httpUtil = new HttpUtil(baseUrl, token);

  // Register tools
  new GetDslTool(httpUtil).register(server);
  new GetComponentLinkTool(httpUtil).register(server);
  new GetMetaTool(httpUtil).register(server);
  new GetComponentWorkflowTool(httpUtil).register(server);

  // Connect to standard input/output
  server.connect(new StdioServerTransport());

  // Only output server started message in debug mode
  if (debug) {
    console.log("MasterGo MCP server started and waiting for connection...");
  }
}

// Start the program
main();
