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

### Anti-Hallucination Rules:
- You MUST use EXACT text content from the DSL data. NEVER invent, translate, or paraphrase text.
- If a section has empty or missing text data, render it as an empty placeholder — do NOT fabricate text.
- NEVER generate placeholder values, generic tags, fabricated amounts, or invented statistics.
- Every piece of text, every number, every label in your output MUST come directly from the DSL data.
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
  new GetLayerTreeTool().register(server);
  new GetDslByLayerIdsTool().register(server);
  new ExtractSvgTool().register(server);

  server.connect(new StdioServerTransport());
}

main();
