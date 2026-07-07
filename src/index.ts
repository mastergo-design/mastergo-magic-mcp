#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GetDslTool } from "./tools/get-dsl";
import { GetD2cTool } from "./tools/get-d2c";
import { GetC2dTool } from "./tools/get-c2d";
import { GetComponentLinkTool } from "./tools/get-component-link";
import { GetMetaTool } from "./tools/get-meta";
import { GetComponentWorkflowTool } from "./tools/get-component-workflow";
import { GetFlutterWorkflowTool } from "./tools/get-flutter-workflow";
import { GetVersionTool } from "./tools/get-version";
import { GetDesignSectionsTool } from "./tools/get-design-sections";
import { GetDesignSvgsTool } from "./tools/get-design-svgs";
import { GetDesignTextsTool } from "./tools/get-design-texts";
import { ExtractSvgTool } from "./tools/extract-svg";
import { parserArgs, getEffectiveHeaders, maskSensitiveHeaders } from "./utils/args";
import { normalizeFormat } from "./utils/format";

const SERVER_INSTRUCTIONS = `
## MasterGo Design DSL - Section-by-Section Workflow

### Step 0: Get Layout Overview (MANDATORY)
Call \`mcp__getDesignSections\` WITHOUT sectionIndex first.
The response contains \`sections\` array with \`nodeCount\` per section, \`totalSections\`, and \`totalNodes\`.
Each \`sections[]\` entry ALSO carries a **page-absolute bounding box**: \`x\`, \`y\` (top-left corner relative to the root container's origin), \`width\`, \`height\`. This tells you exactly where each section sits on the canvas.
Use this to understand the design scope before fetching details.

\`rootMetadata\` (if present) provides the root layer's dimensions (width, height), name, type, and optional fill/styles. Use these as the page frame size and background.
\`splitContainers\` (if present) lists containers that were too large and split into child sections. Each entry provides the container's name, type, id, layout properties (layoutMode, itemSpacing, padding), **and now a \`background\` color** (resolved hex/css value) plus \`fill\` reference. Use these to understand how the split sections should be arranged — they share the container's layout direction and spacing. Apply the container's \`background\` to the parent wrapper that encloses its child sections.

**Structure grouping** — Each section entry carries two fields to help you avoid redundant work:

1. **\`structureHash\`** — structural fingerprint. Sections with identical hashes have the **exact same node-tree skeleton** (same type tree + layout attributes). Only **leaf values differ** (text, fill colors, icon paths). Fetch the DSL for the **first section in each hash group** and reuse its rendered structure for the rest — just swap in different text/color/icon values. Sections without a structureHash have unique structures and must be rendered individually.

2. **\`containerId\`** — links to a \`splitContainers\` entry. All sections sharing a containerId inherit that container's width, flexDirection, gap, and padding. When wrapping these sections in a parent element, match the container's width and layout properties — don't repeat them on each child.

### Step 1: Fetch Each Section DSL (MANDATORY - ALL N sections)
For i = 0 to N-1, call \`mcp__getDesignSections\` with \`sectionIndex=i\`.
You MUST call this tool N times. Do NOT skip any section.
CRITICAL: Fetch sections in BATCHES of 3-5 at a time. Do NOT request all sections simultaneously — too many concurrent requests will cause timeouts. Send 3-5 sectionIndex calls, wait for all results, then send the next batch.

### Step 2: Fetch SVG and Text Data (MANDATORY)
After ALL N sections have been fetched, handle stripped/cached data:

**Check section responses for caching flags:**
- If ANY section has \`hasStrippedSvgs: true\` → you MUST call \`mcp__getDesignSvgs\` (icons/paths were stripped to cache). Skipping this WILL cause missing icons.
- If few/no sections have \`textNodeCount > 0\` or \`dsl.rowTexts\` contains no \`"T{sectionIndex}|..."\` keys → \`getDesignTexts\` is unnecessary (all text is already inline in the DSL).

**PATH Nodes — TWO forms:**
1. **INLINED**: Most PATH nodes carry an \`svg\` field with the complete \`<svg>...</svg>\` string — copy this value VERBATIM into the HTML. No transformation needed. ALWAYS check for the \`svg\` field first.
2. **STRIPPED**: Large sections strip the svg to a separate cache; these PATH nodes have only a \`path\` array with empty \`data\`. For stripped PATH nodes, call \`mcp__getDesignSvgs\` with the same fileId/layerId to get the SVG HTML strings.

**SVG Data** — Call \`mcp__getDesignSvgs\` ONLY for stripped PATH nodes (those without \`svg\` field).
Each key uses format \`S{sectionIndex}:{namedAncestor}|{ancestorId}\`.
- Match each SVG to its section by the \`S{sectionIndex}\` prefix.
- Insert the svgHtml string directly where the icon/PATH should appear.

**CRITICAL — SVG VERBATIM fidelity (3 forbidden modifications):**
Whether from the \`svg\` field or mcp__getDesignSvgs, the svgHtml is AUTHORITATIVE — copy it character-for-character.
1. NEVER round coordinate precision — 17.522848 must stay 17.522848, not 17.523 (rounding shifts shapes visibly).
2. NEVER drop M-subpaths — a compound path may contain 2-6 subpaths, dropping ANY subpath breaks the icon.
3. NEVER 'simplify' or 'optimize' path commands or viewBox.
After copying, VERIFY: count the M commands in your output's path d — it MUST equal the source's M count, and the d string length MUST match. If you shortened it or reduced M count, you corrupted the icon — redo the copy.

**CRITICAL — Do NOT hand-draw icons:** when a PATH node has an \`svg\` field OR a matching getDesignSvgs key, you MUST insert the real SVG. NEVER substitute with simplified placeholder shapes (\`<circle>\`, \`<rect>\`, rough \`<path>\` sketches).

**CRITICAL — SVG UNIQUENESS:** Each SVG key is unique to its section. The \`S{sectionIndex}:\` prefix in getDesignSvgs keys identifies the source section. NEVER reuse an SVG from one section in another — a filter icon in section 39 is DIFFERENT from a filter icon in section 40. Always match the full key, not just the icon name.

**Text Data** — Call \`mcp__getDesignTexts\` with the same fileId/layerId.
This returns exact text content for large text nodes (>50 chars). In the section DSL, these TEXT nodes have their \`text\` field replaced with a key like \`T{sectionIndex}|{nodeId}\`.
- Look up the key in the returned texts map to get the exact text string.
- Insert the text string VERBATIM — do NOT paraphrase, translate, summarize, or invent text.
- This is the ONLY source of truth for large text content. The DSL key is a reference, not the actual text.

**Assets** (icons, rowTexts) — Each section DSL may carry two pre-extracted fields for direct use:

1. **\`dsl.icons\`** — A flat map of icon name → complete \`<svg>...</svg>\` string. Keys like \`"通用/编辑"\`, \`"图标"\`, \`"图标_1"\` (suffixed when a section has multiple SVGs with the same ancestor name). Use this value directly as the icon's HTML. If the value starts with \`@svgCache:\`, the SVG was too large to inline — look it up via \`mcp__getDesignSvgs\` using the key format shown after the \`@svgCache:\` marker.
2. **\`dsl.rowTexts\`** — A flat array of all leaf TEXT values in this section, in tree order. For table rows this gives you \`["1.1.3.543.4", "ddd", "2.2.344.23", "无", "AES-128"]\` — the exact cell data. For menu items it gives \`["态势监控"]\` — the menu label.

When \`icons\` or \`rowTexts\` is present, use them directly. They are authoritative and save you from deep-tree traversal.

### Step 3: Generate Complete Code
After ALL N sections have been fetched and SVG data retrieved:
- MANDATORY: Use \`rootContainer\` from the section list response to create the root container div. Apply ALL its CSS properties (width, minHeight, background, overflow, position:relative) to a wrapping div. ALL sections MUST be placed inside this root container.
- CRITICAL — Position each section ABSOLUTELY: every section entry has a page-absolute bbox (x, y, width, height) from Step 0. Wrap each section in a container with \`position:absolute; left:{x}px; top:{y}px; width:{width}px\` inside the root container. Do NOT reconstruct the page by stacking sections in a flex column with guessed \`margin-top\` / \`gap\` values. Many designs are spatially OVERLAID (status bar, title bar, form card, decorative curves, floating text, background layers) and only reconstruct correctly with absolute positioning. Intra-section layout still uses each node's \`layoutStyle.relativeX/relativeY\` as before.
- Generate a single complete HTML file containing ALL sections in order, nested inside the root container.
- token fields must be generated as CSS variables with comments indicating the token name.
- If componentDocumentLinks exists, call mcp__getComponentLink to fetch documentation.
- When splitContainers is present, sections that were split from the same container must share that container's width and be wrapped together. **Apply the container's \`background\` to the parent wrapper**: splitContainer entries now include \`background\` (resolved CSS color) and \`fill\` (paint reference).

### Tool Selection Rules:
- \`mcp__getDesignSections\` is the PRIMARY tool for full-page design-to-code generation. Always start here when you need to generate a complete HTML page from a design.
- \`mcp__extractSvg\` is a STANDALONE tool. Use it DIRECTLY when you only need to extract SVG icons from a design — do NOT call \`getDesignSections\` or \`getDesignSvgs\` before it.
- \`mcp__getDsl\` is a FALLBACK — call it ONLY if \`getDesignSections\` returns an error (e.g. tool not available on older servers).
- NEVER call both \`getDesignSections\` AND \`getDsl\` for the same design.
- NEVER combine the section workflow with \`extractSvg\`. If you only need SVG icons, use \`extractSvg\` alone. If you need a full page, use the section workflow (which includes \`getDesignSvgs\` for SVG data).
- The section workflow provides COMPLETE data. Do NOT call \`getDsl\` to "verify".

### Output Format:
- The design-data tools (\`getDesignSections\`, \`getDsl\`, \`getDesignSvgs\`, \`getDesignTexts\`, \`extractSvg\`, \`getMeta\`) accept an optional \`format\` parameter: \`json\` (default), \`yaml\`, or \`tree\`. \`yaml\`/\`tree\` use fewer tokens for large designs; all three round-trip without data loss. Set a session-wide default with the \`--format\` CLI flag or \`DEFAULT_FORMAT\` env var.

### Text Fidelity Rules:
- TEXT nodes contain actual text in node.text array. Read EACH node's text and use it EXACTLY.
- Do NOT duplicate text from one node to another — each TEXT node has unique content.
- Do NOT skip any child nodes. Render ALL nodes: every tab, every button, every text element.

### Background & Color Rules:
- **PREFER the \`_color\` field**: every node with a resolved fill carries a \`_color\` field containing the computed CSS hex/rgb value. Use this value DIRECTLY in CSS — no styles-table lookup needed. Example: \`color: #4E5969\` from \`"_color": "#4E5969"\`.
- The \`fill\` field (e.g. \`paint_1:7200\`) remains for reference. Use \`_token\` (e.g. \`"Text/Text-4"\`) for CSS variable naming like \`var(--text-text-4, #4E5969)\`.
- If a node has both \`_color\` and \`fill\`, \`_color\` is authoritative for the visual color value.
- The DSL \`styles\` map contains fill/stroke style definitions. Use the node's \`fillStyleId\`/\`strokeStyleId\` to look up the actual color from \`styles\`.
- The root/frame node's background comes from its fill style. Do NOT invent gradient or solid backgrounds — use ONLY the colors from the DSL data.
- If a node has no fill or the fill style is empty/transparent, do NOT add a background color. Leave it transparent or inherit from parent.
- Status bar, title bar, and other container backgrounds MUST match the DSL fill data exactly.
- **NEVER hardcode LLM-default colors** (e.g. \`#1D2129\`, \`#000\`, \`#333\`) when \`_color\` is present. The \`_color\` value is the design truth — copying it requires zero cognitive effort and zero styles-table lookup.

### Anti-Hallucination Rules:
- You MUST use EXACT text content from the DSL data. NEVER invent, translate, or paraphrase text.
- If a section has empty or missing text data, render it as an empty placeholder — do NOT fabricate text.
- NEVER generate placeholder values, generic tags, fabricated amounts, or invented statistics.
- Every piece of text, every number, every label in your output MUST come directly from the DSL data.
- NEVER fabricate SVG path data for icons or vector shapes — use the svgHtml from the \`svg\` field or mcp__getDesignSvgs.
- NEVER fabricate background colors, gradients, or decorations that are not present in the DSL data.

### SVG Icon Anti-Simplification Rules:
- PATH nodes with an \`svg\` or \`getDesignSvgs\` field carry the DESIGNER'S EXACT vector shape. You MUST copy this svgHtml character-for-character — no transformation, no simplification, no "equivalent" replacement.
- **SVG UNIQUENESS:** Each icon in the DSL is a distinct design artifact — different sections may have DIFFERENT icons even if they look similar (e.g. "搜索" in section 2 vs "搜索" in section 40 are DIFFERENT SVGs with different viewBox/path data). NEVER reuse a section's SVG in another section. Always match by exact section prefix (S{n}:) in getDesignSvgs keys.
- **NEVER substitute vector paths with simplified shapes** — a \`<path>\` containing a house icon is NOT replaceable by a \`<rect>\` + \`<polygon>\`. The designer chose every anchor point; your simplified version WILL look different.
- **VERIFY after copying each SVG**: count the number of \`M\` characters in the source path \`d\` attribute. Your copy MUST have exactly the same count. Fewer \`M\` → you corrupted the icon → redo.
- **SHAPE CHECK**: if the source uses \`<path>\`, your output MUST use \`<path>\`. NOT \`<rect>\`, NOT \`<circle>\`, NOT \`<ellipse>\`. Shape type changes ARE visual changes.
- The only acceptable SVG operation is: copy the complete \`<svg>...</svg>\` block from the DSL data and paste it into your HTML. Nothing else.
- **Common failure pattern**: you saw a complex path and thought "this looks roughly like 4 rectangles" → you drew 4 \`<rect>\`s → the result is visually WRONG. The designer chose a vector path for a reason. Trust the data.

### INSTANCE Variant State Rules:
- INSTANCE nodes may carry a **\`_variantProps\`** object with semantic state labels extracted from component variant properties (e.g. \`{"状态": "选中", "分类": "幽灵按钮", "尺寸": "24"}\`).
- **Active/selected state**: compare \`_variantProps\` across sibling INSTANCE nodes to find which one has \`"状态": "选中"\` or similar active-state values. Apply the \`.active\` CSS class ONLY to that node — NEVER default to the first item in a list.
- **Sidebar menu items**: each menu item (e.g. 22 submenu entries) is a separate section containing an INSTANCE with \`_variantProps\`. The item with \`"状态": "选中"\` in its \`_variantProps\` is the currently active page — the corresponding section's \`rowTexts[0]\` (or TEXT child) is its label. Render this item with \`class="submenu-item active"\`.
- **Button states**: \`"分类": "幽灵按钮"\` vs \`"分类": "主要按钮"\` determines the button's visual style (outline vs filled). Multiple buttons in the same toolbar may have different variant props — respect each one individually.
- If \`_variantProps\` is absent from all siblings, assume all are in \`default\` state — do NOT invent active states.

### Data Completeness Rules:
- You MUST fetch ALL sections (0..totalSections-1). If totalSections=48, you must call sectionIndex=0 through 47 — no exceptions.
- Some sections may have nodeCount=3 and no visible TEXT nodes (text is in component property overrides). Do NOT skip them — the TEXT is resolved during DSL transfer. These sections contribute real content.
- **textPreview**: each section list entry carries a \`textPreview\` field (first TEXT node found, truncated to 20 chars). If two sections both have nodeCount=3 and empty name, use \`textPreview\` to tell them apart — they are different menu items (e.g. "系统信息" / "权限设置"), NOT duplicates.
- Keep a checklist: track which section indices have been requested. Do not stop until every index 0..N-1 has been fetched.
- If you accidentally skipped a section, go back and request the missing indices. An incomplete section set WILL cause missing content in the final HTML.

### Data Interpretation Rules:
- Pagination/table-footer labels (e.g. "共 10 项", "X rows/page", "items per page") reflect UI control state — NOT data to replicate.
- "共 X 项" is the pagination widget showing "total X items". The actual data rows come from the table body sections (preceding the pagination section).
- Do NOT fabricate data rows based on pagination "total" values. Render ONLY the actual data rows present in the DSL.
- If the DSL contains 1 data row, output exactly 1 table row. Do NOT multiply rows to match a pagination label.
- **CRITICAL — SVG icons for table actions**: table action columns (操作列) use SVG icon buttons (edit/delete), NOT plain text. Match each SVG key from getDesignSvgs to its section — keys like '通用_编辑' and '通用_删除' are the authoritative icons. NEVER render action buttons as \`<p>编辑</p>\` or \`<p>删除</p>\` plain text. Sidebar menu icons also use SVG — do NOT draw simplified placeholder shapes.
- **CRITICAL — Persistent sidebars**: render all sidebar levels as static visible columns positioned via splitContainers coordinates. Do NOT hide or toggle sidebar levels.
`;

function main() {
  // Parse command line arguments and set environment variables
  const { token, baseUrl, rules, debug, noRule, proxy, format } = parserArgs();

  // `--format` (json|yaml|tree) sets the default output format for design-data tools.
  // An explicit per-call `format` tool parameter still takes precedence (see utils/format.ts).
  // `format` is `undefined` only when the flag is absent; any explicit-but-invalid value
  // (including `--format=`) is warned about and falls back to json.
  if (format !== undefined) {
    const normalized = normalizeFormat(format);
    if (normalized) {
      process.env.DEFAULT_FORMAT = normalized;
    } else {
      console.warn(
        `Invalid --format value: "${format}". Must be one of: json, yaml, tree. Falling back to json.`
      );
    }
  }

  if (debug) {
    process.env.DEBUG = "true";
    console.log("Debug information:");
    console.log(`Token: ${token ? "set" : "not set"}`);
    console.log(`API URL: ${baseUrl || "default"}`);
    console.log(`Rules: ${rules.length > 0 ? rules.join(", ") : "none"}`);
    console.log(`No Rule: ${noRule ? "enabled" : "disabled"}`);
    console.log(`Proxy: ${proxy || "none"}`);
    const effectiveHeaders = getEffectiveHeaders();
    console.log(`Custom Headers: ${Object.keys(effectiveHeaders).length > 0 ? JSON.stringify(maskSensitiveHeaders(effectiveHeaders)) : "none"}`);
    console.log(`Format: ${process.env.DEFAULT_FORMAT || "json (default)"}`);
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
  new GetDesignSvgsTool().register(server);
  new GetDesignTextsTool().register(server);
  new GetDslTool().register(server);
  new GetD2cTool().register(server);
  new GetC2dTool().register(server);
  new GetComponentLinkTool().register(server);
  new GetMetaTool().register(server);
  new GetComponentWorkflowTool().register(server);
  new GetFlutterWorkflowTool().register(server);
  new ExtractSvgTool().register(server);

  server.connect(new StdioServerTransport());
}

main();
