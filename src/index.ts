#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GetDslTool } from "./tools/get-dsl";
import { GetD2cTool } from "./tools/get-d2c";
import { GetC2dTool } from "./tools/get-c2d";
import { GetComponentLinkTool } from "./tools/get-component-link";
import { GetMetaTool } from "./tools/get-meta";
import { GetComponentWorkflowTool } from "./tools/get-component-workflow";
import { GetVersionTool } from "./tools/get-version";
import { GetLayerTreeTool } from "./tools/get-layer-tree";
import { GetDslByLayerIdsTool } from "./tools/get-dsl-by-layer-ids";
import { ExtractSvgTool } from "./tools/extract-svg";
import { parserArgs } from "./utils/args";

const SERVER_INSTRUCTIONS = `
## MasterGo Design DSL - Required Workflow

You MUST follow the layered query workflow for ALL designs. Do NOT use mcp__getDsl for the full design — it returns too much data in a single response and causes detail loss in bottom/side sections.

### Required workflow (ALL designs):
1. **First**: Call mcp__getLayerTree to get a lightweight structural overview (IDs, names, types, positions, sizes, children counts). No style/SVG data.
2. **Then**: Analyze the tree structure. Identify ALL direct child frames/groups of the root — each is a section that must be rendered.
3. **Next**: Call mcp__getDslByLayerIds with ALL section layer IDs. Pass them together in a single call. Do NOT skip any section.
4. **Iterate**: If any returned nodes have needParse=true, call mcp__getDslByLayerIds again with those node IDs.
5. **Render**: Generate code for ALL sections in the order they appear in the layer tree. Do not omit or simplify any section.

### Critical rules:
- NEVER use mcp__getDsl for complex designs with multiple sections. It WILL cause data loss.
- When calling mcp__getDslByLayerIds, include ALL section IDs from the layer tree, not just the first few.
- The layer tree's children order is the z-index/rendering order. Preserve this order in your output.
- token fields must be generated as variables and displayed in comments.
- When componentDocumentLinks exists and is not empty, use mcp__getComponentLink to fetch component documentation.
`;

function main() {
  const { token, baseUrl, rules, debug, noRule } = parserArgs();

  if (debug) {
    process.env.DEBUG = "true";
    console.log("Debug information:");
    console.log(`Token: ${token ? "set" : "not set"}`);
    console.log(`API URL: ${baseUrl || "default"}`);
    console.log(`Rules: ${rules.length > 0 ? rules.join(", ") : "none"}`);
    console.log(`No Rule: ${noRule ? "enabled" : "disabled"}`);
    console.log(`Debug mode: enabled`);
  }

  const server = new McpServer(
    {
      name: "MasterGoMcpServer",
      version: "0.0.1",
    },
    { instructions: SERVER_INSTRUCTIONS }
  );

  new GetVersionTool().register(server);
  new GetDslTool().register(server);
  new GetD2cTool().register(server);
  new GetC2dTool().register(server);
  new GetComponentLinkTool().register(server);
  new GetMetaTool().register(server);
  new GetComponentWorkflowTool().register(server);
  new GetLayerTreeTool().register(server);
  new GetDslByLayerIdsTool().register(server);
  new ExtractSvgTool().register(server);

  server.connect(new StdioServerTransport());
}

main();
