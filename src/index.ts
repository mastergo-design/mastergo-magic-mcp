#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { GetC2dTool } from './tools/get-c2d';
import { GetComponentLinkTool } from './tools/get-component-link';
import { GetComponentWorkflowTool } from './tools/get-component-workflow';
import { GetD2cTool } from './tools/get-d2c';
import { GetDslTool } from './tools/get-dsl';
import { GetMetaTool } from './tools/get-meta';
import { GetVersionTool } from './tools/get-version';
import { parserArgs } from './utils/args';

// Main function
function main() {
    // Parse command line arguments and set environment variables
    const { token, baseUrl, rules, debug, noRule } = parserArgs();

    if (debug) {
        process.env.DEBUG = 'true';
        console.log('Debug information:');
        console.log(`Startup token (argv/env): ${token ? 'set' : 'not set'}`);
        console.log('Per-call tokens via tools/call _meta.userToken are never printed here (redacted by design).');
        console.log(`API URL: ${baseUrl || 'default'}`);
        console.log(`Rules: ${rules.length > 0 ? rules.join(', ') : 'none'}`);
        console.log(`No Rule: ${noRule ? 'enabled' : 'disabled'}`);
        console.log('Debug mode: enabled');
    }

    // Create server instance
    const server = new McpServer({
        name: 'MasterGoMcpServer',
        version: '0.0.1'
    });

    // Register tools
    new GetVersionTool().register(server);
    new GetDslTool().register(server);
    new GetD2cTool().register(server);
    new GetC2dTool().register(server);
    new GetComponentLinkTool().register(server);
    new GetMetaTool().register(server);
    new GetComponentWorkflowTool().register(server);

    // Connect to standard input/output
    server.connect(new StdioServerTransport());
}

// Start the program
main();
