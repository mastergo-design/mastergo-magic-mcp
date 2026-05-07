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
import { GetDesignSectionsTool } from "./tools/get-design-sections";
import { ExtractSvgTool } from "./tools/extract-svg";
import { parserArgs } from "./utils/args";

const SERVER_INSTRUCTIONS = `
## MasterGo Design DSL - Section-by-Section Workflow (MANDATORY)

You MUST use \`mcp__getDesignSections\` for ALL designs. Follow these steps exactly:

### Step 1: Get Section List
Call \`mcp__getDesignSections\` WITHOUT sectionIndex to get the list of all sections.
The response contains \`sections\` array and \`totalSections\` (let this be N).

### Step 2: Fetch Each Section DSL (MANDATORY - ALL N sections)
For i = 0 to N-1, call \`mcp__getDesignSections\` with \`sectionIndex=i\`.
You MUST call this tool N times. Do NOT skip any section.
Process each section's DSL before moving to the next.

### Step 3: Generate Complete Code
After ALL N sections have been fetched:
- Generate a single complete HTML file containing ALL sections in order.
- token fields must be generated as CSS variables with comments indicating the token name.
- If componentDocumentLinks exists, call mcp__getComponentLink to fetch documentation.

### SVG Path Data:
DSL nodes of type PATH have an \`svgHtml\` field containing a complete SVG string with correct viewBox.
Insert node.svgHtml directly into HTML. Do NOT construct your own SVG for path nodes.

### Anti-Hallucination Rules:
- NEVER fabricate SVG path data for icons or vector shapes — use the svgHtml field from DSL PATH nodes.
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
  new GetDesignSectionsTool().register(server);
  new GetDslTool().register(server);
  new GetD2cTool().register(server);
  new GetC2dTool().register(server);
  new GetComponentLinkTool().register(server);
  new GetMetaTool().register(server);
  new GetComponentWorkflowTool().register(server);
  new ExtractSvgTool().register(server);

  server.connect(new StdioServerTransport());
}

main();
