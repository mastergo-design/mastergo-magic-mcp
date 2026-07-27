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
import { GetPageLayersTool } from "./tools/get-page-layers";
import { ExtractSvgTool } from "./tools/extract-svg";
import { ApplyDesignTool } from "./tools/apply-design";
import { parserArgs, getEffectiveHeaders, maskSensitiveHeaders } from "./utils/args";
import { normalizeFormat } from "./utils/format";
import packageJson from "../package.json";

const SERVER_INSTRUCTIONS = `
## MasterGo Design DSL - Section-by-Section Workflow

### Step -1: Multi-layer restoration — enumerate, then restore ONE layer at a time, EACH as its own file
Use this workflow when the user wants to restore a WHOLE PAGE or a CONTAINER with multiple child layers (e.g. URL has \`page_id\`, or a top-level frame whose children should each be restored separately). Do NOT restore all layers in one shot — restore them sequentially, and **each layer MUST become its own standalone HTML file**.

**Workflow:**
1. **Enumerate**: Call \`mcp__getPageLayers\` with the page_id / parent layerId. It returns a flat list of ALL layers, each as \`{id, name, type, depth, parentId, childrenCount, width, height}\`.
2. **Pick the layers to restore**: From the list, identify the top-level restorable layers (typically depth=0 or depth=1 FRAME/COMPONENT/INSTANCE nodes — the actual screens/cards/sections, not every nested leaf). For each, build a restorable URL: \`https://mastergo.com/file/{fileId}?layer_id={layer_id}\` (URL-encode the layer_id, e.g. \`802:02364\` → \`802%3A02364\`).
3. **Restore ONE layer at a time, writing EACH to its OWN separate .html file**: Take the FIRST layer_id → run the normal single-layer restoration (Step 0 → Step 4 below: \`getDesignSections\` → fetch all sections → \`applyDesign\`) → write that layer's complete HTML to a SEPARATE file. ONLY after finishing one layer's HTML FILE, move to the NEXT layer_id and repeat. Do not start layer N+1 before layer N's file is fully written.
4. Repeat until all picked layers are restored — you should end up with N separate .html files (one per layer), NOT one merged file.

**CRITICAL — ONE LAYER = ONE STANDALONE HTML FILE. This is non-negotiable:**
- Each layer's output is a COMPLETE, standalone HTML document with its own \`<!DOCTYPE html>\`, \`<head>\`, and \`<body>\` — NOT an HTML fragment, NOT a \`<div>\` chunk to be concatenated.
- Do NOT combine multiple layers into one HTML file. Do NOT stack multiple layers' \`<body>\` content into a single page. Do NOT fetch all layers' DSLs in parallel and merge them.
- Write each layer to a DISTINCT file. Name files by the layer name or layer_id (e.g. \`容器1.html\`, \`navbar.html\`, or \`layer-802-02364.html\`). If the user specified an output directory, write each file there.
- Finish one layer completely (including \`mcp__applyDesign\` and writing the file) before starting the next.

**When to use this vs. direct restoration:**
- URL has \`page_id\` and no \`layer_id\` → ALWAYS use this workflow (a page contains many layers; restore them individually, each as its own file).
- URL has a specific \`layer_id\` for a single component → use the normal workflow (Step 0+), no enumeration needed, one file.
- A page_id returns empty (e.g. the synthetic \`page_id=M\`) → the page data isn't available via this API; ask the user for a specific layer_id URL instead.

### Step 0: Get Layout Overview (MANDATORY)
Call \`mcp__getDesignSections\` WITHOUT sectionIndex first.
The response contains \`sections\` array with \`nodeCount\` per section, \`totalSections\`, and \`totalNodes\`.
Each \`sections[]\` entry ALSO carries a **page-absolute bounding box**: \`x\`, \`y\` (top-left corner relative to the root container's origin), \`width\`, \`height\`. This tells you exactly where each section sits on the canvas.
Use this to understand the design scope before fetching details.

\`rootMetadata\` (if present) provides the root layer's dimensions (width, height), name, type, and optional fill/styles. Use these as the page frame size and background.
\`splitContainers\` (if present) lists containers that were too large and split into child sections. Each entry provides the container's name, type, id, x, y, width, height, layout properties (layoutMode, itemSpacing, padding), **and now a \`background\` color** (resolved hex/css value, e.g. \`"#055DDC"\`) plus \`fill\` reference (e.g. \`"paint_1:4829"\`). Use these to understand how the split sections should be arranged — they share the container's width, layout direction and spacing. IMPORTANT: sections from the same split container MUST share the container's width. Apply the container's \`background\` to the parent wrapper that encloses its child sections — this gives the container its correct visual background without each section needing to carry it.

**Structure grouping** — Each section entry carries two fields to help you avoid redundant work:

1. **\`structureHash\`** — structural fingerprint. Sections with identical hashes have the **exact same node-tree skeleton** (same type tree + layout attributes). Only **leaf values differ** (text, fill colors, icon paths). Fetch the DSL for the **first section in each hash group** and reuse its rendered structure for the rest — just swap in different text/color/icon values. Sections without a structureHash have unique structures and must be rendered individually.

2. **\`containerId\`** — links to a \`splitContainers\` entry. All sections sharing a containerId inherit that container's width, flexDirection, gap, and padding. When wrapping these sections in a parent element, match the container's width and layout properties — don't repeat them on each child.

### Step 1: Fetch Each Section DSL (MANDATORY - ALL N sections)
For i = 0 to N-1, call \`mcp__getDesignSections\` with \`sectionIndex=i\`.
You MUST call this tool N times. Do NOT skip any section.
CRITICAL: Fetch sections in BATCHES of 3-5 at a time. Do NOT request all sections simultaneously — too many concurrent requests will cause timeouts. Send 3-5 sectionIndex calls, wait for all results, then send the next batch.

### Step 2: Understand SVG Data Model (MANDATORY)
After ALL N sections have been fetched, understand how icons work:

**PATH Nodes — ALL carry a \`svgShortKey\` field:**
Every PATH node (icon) in the DSL has a \`svgShortKey\` field (e.g. \`S0#0\`) AND a \`svgName\` field (a semantic name like \`通用/刷新\`, \`通用/向左\`, \`搜索\`, \`齿轮\`). The actual SVG markup is NOT in the DSL — it lives in a server-side cache, retrieved at the end via \`mcp__applyDesign\`.

**You do NOT copy SVG markup during code generation.** Instead:
1. When you encounter a PATH node, note its \`svgShortKey\` (for the placeholder) AND its \`svgName\` (to understand WHAT icon it is and WHERE it should go).
2. In your generated code, place a placeholder \`@@SVG:{svgShortKey}@@\` where the icon goes. Use \`svgName\` to match each icon to its correct UI position — e.g. an icon with \`svgName: "通用/向左"\` belongs in a collapse/fold button, not a "add" button.
3. After the complete code is generated, call \`mcp__applyDesign\` — it replaces all placeholders with real high-precision SVG.

**Why this design**: copying SVG path data through LLM generation causes precision loss (17.522848 → 17.52), dropped subpaths, and shape corruption. The placeholder approach ensures path data never passes through generation — the server does deterministic string substitution.

**CRITICAL — SVG UNIQUENESS:** Each PATH node has its OWN unique \`svgShortKey\` (e.g. \`S0#1\`, \`S0#0\`). NEVER reuse a svgShortKey from one PATH node for another — even if two icons look similar (e.g. two arrow icons), they are DIFFERENT vectors with DIFFERENT svgShortKeys. Always use the exact \`svgShortKey\` from the PATH node where the icon appears.

**Text Data** — Long text (>50 chars) in the DSL appears as \`T{sectionIndex}|{nodeId}\` placeholders. These are automatically replaced by \`mcp__applyDesign\` server-side. Just leave the \`T{si}|{nodeId}\` placeholder in your code where the text should appear, and applyDesign will inject the real text.
- Short text already inlined in the DSL (\`node.text\` / \`dsl.rowTexts\`) must be inserted VERBATIM — do NOT paraphrase, translate, summarize, or invent text.

**\`dsl.rowTexts\`** — An array of \`{text, parentType?, parentName?}\` objects for all leaf TEXT values in this section, in tree order. Each item carries \`parentType\` and \`parentName\` to indicate which container the text belongs to (e.g. \`{text: "8", parentType: "INSTANCE", parentName: "删除"}\` means "8" is inside a delete button — it's a badge count, NOT an independent notification dot). Use parentType/parentName for context; do NOT reassign text to unrelated UI elements.

### Step 3: Generate Complete Code
After ALL N sections have been fetched:
- MANDATORY: Use \`rootContainer\` from the section list response to create the root container div. Apply ALL its CSS properties (width, minHeight, background, overflow, position:relative) to a wrapping div. ALL sections MUST be placed inside this root container.
- CRITICAL — Position each section ABSOLUTELY: every section entry has a page-absolute bbox (x, y, width, height) from Step 0. Wrap each section in a container with \`position:absolute; left:{x}px; top:{y}px; width:{width}px\` inside the root container. Do NOT reconstruct the page by stacking sections in a flex column with guessed \`margin-top\` / \`gap\` values. Many designs are spatially OVERLAID (status bar, title bar, form card, decorative curves, floating text, background layers) and only reconstruct correctly with absolute positioning.
- CRITICAL — Overflow clipping: some design elements (brand logos, decorative shapes) are LARGER than their visible area — the design deliberately clips them via \`overflow: hidden\` on the parent. When a node's \`layoutStyle.width/height\` is smaller than its SVG content, you MUST preserve this clipping: set the parent container to the node's \`layoutStyle\` dimensions AND add \`overflow: hidden\`, then let the SVG render at its natural size inside. Do NOT shrink the SVG to fit the container (that distorts the logo) and do NOT enlarge the container (that breaks the layout).

### Step 4: SVG Placeholder Workflow (FINAL step — MANDATORY)
Every icon in the design is a PATH node with a \`svgShortKey\`. The SVG markup is NOT in the DSL — you cannot copy it even if you wanted to. You MUST use placeholders.

**During code generation** — wherever an icon/SVG should appear, place a placeholder \`@@SVG:{svgShortKey}@@\`:
- Read the \`svgShortKey\` from the PATH node in the section DSL.
- Place \`@@SVG:\` + that exact svgShortKey + \`@@\` where the icon goes.
- **CRITICAL — Icon container sizing**: the placeholder MUST be placed inside a container whose width and height match the PATH node's \`layoutStyle.width\` and \`layoutStyle.height\`. The injected SVG uses \`width="100%" height="100%"\`, so it fills its direct parent. If you place it directly inside a large button container (e.g. 32×32px) instead of the icon's own size (e.g. 16×16px), the icon will render too large. Always wrap the placeholder in an element sized to the PATH node's dimensions:
  - **HTML/Vue**: \`<span style="width:{layoutStyle.width}px;height:{layoutStyle.height}px;display:flex;align-items:center;justify-content:center">@@SVG:{svgShortKey}@@</span>\`
  - **JSX/React**: \`<span style={{width:'{w}px',height:'{h}px'}}>{/*@@SVG:{svgShortKey}@@*/}</span>\`
  - **Flutter**: \`SizedBox(width:{w},height:{h},child: SvgPicture.string('@@SVG:{svgShortKey}@@'))\`
- Use \`svgName\` to match each icon to its correct UI position — e.g. an icon with \`svgName: "通用/向左"\` belongs in a collapse/fold button, not a "add" button.

**After generating the COMPLETE code** — call \`mcp__applyDesign\` with the full code string AND an \`outDir\` parameter. The tool substitutes every \`@@SVG:...@@\` with the real high-precision \`<svg>\` markup from the cache (character-for-character exact, no rounding) AND writes the final file directly to disk. **You MUST provide \`outDir\`** — this writes the patched code to a file WITHOUT it passing back through your generation, preventing any re-processing or precision loss. After the tool writes the file, you are DONE — do NOT output, copy, or edit the code further.

### Intra-Section Layout Rules (node-level positioning):
Every node in a section's DSL has TWO pieces of layout data:

1. **\`flexContainerInfo\`** — If a node HAS this field, it is a flex container. Its direct children are laid out by flex rules, NOT by absolute positioning. Generate CSS: \`display: flex; flex-direction: {flexDirection}; justify-content: {justifyContent}; align-items: {alignItems}; gap: {gap}; padding: {padding};\`. Do NOT add \`position: absolute\` or \`left/top\` to flex container nodes or their direct children.

2. **\`layoutStyle.relativeX/relativeY\`** — Use these ONLY for leaf/free nodes that are NOT inside a flex container. For those nodes, apply \`position: absolute; left: {relativeX}px; top: {relativeY}px;\`.

3. **Nested flex containers** — A flex container can contain a child that is ALSO a flex container (e.g. a horizontal toolbar with a vertical menu inside). Each level independently uses its own \`flexContainerInfo\`. **You MUST preserve ALL nesting levels** — do NOT flatten a two-level flex structure into one. For example, a table header cell where "label + sort-icon" form an inner group and "action-icon" sits at the outer level MUST be rendered as TWO nested flex containers, not one flat flex with all three items side by side. Flattening loses the visual grouping (label+sort tightly paired, action-icon separated) and causes layout breakage.

4. **When a child has \`flexGrow\` / \`flexShrink\`** — These are flex item properties. Apply \`flex: {flexGrow} 1 0\` on the child element. Do NOT position it absolutely.

5. **CRITICAL — Flex column with fixed-height children**: When a container uses \`flex-direction: column\` with a FIXED height and \`overflow: hidden\`, ALL children with fixed heights (tabs, headers, pagination bars, footers, scrollbars) MUST have \`flex-shrink: 0\`. Only ONE child — the flexible content area (table body, scrollable region) — should use \`flex: 1\`. If you forget \`flex-shrink: 0\` on fixed-height children, flex layout will squeeze them out of the visible area and they get clipped by \`overflow: hidden\` (e.g. pagination bar becomes invisible).

6. **CRITICAL — Nested FRAME dimensions and spacing**: When a FRAME contains child FRAMEs (e.g. a card panel with an inner content container), the outer element's width/height MUST come from the OUTER node's \`layoutStyle.width/height\` — NOT from the inner content container. A common error is using the inner container's width (e.g. 285px) for the card itself (which should be 317px). Always trace to the correct node: if the DSL shows \`容器A (317×107) > 容器B (285×75, relativeX:16, relativeY:16)\`, the rendered card is 317×107 with 16px padding, and the content inside is 285×75.

7. **CRITICAL — Precise vertical positioning inside cards**: Inside small fixed-height containers (stat cards, info panels, badge boxes), do NOT invent \`gap\` values. Use each child's \`layoutStyle.relativeY\` to position elements precisely. For example, if a card's DSL shows child A at \`relativeY:0\` and child B at \`relativeY:32\`, the vertical gap is 32px (minus child A's height) — NOT a guessed \`gap:16px\` or \`gap:20px\`. Inventing large gaps in small cards pushes content apart and breaks the compact layout. When \`flexContainerInfo.gap\` is present, use that exact value; when it is absent, use \`relativeY\` differences to calculate spacing.

8. **CRITICAL — Overlapping elements in the same container (Switch toggle, icon badges, layered decorations)**: When a container holds multiple sibling elements that visually OVERLAP (one on top of another), the container MUST use \`position: relative\` and each child MUST use \`position: absolute\` with its own \`layoutStyle.relativeX/relativeY\`. Do NOT use \`display: flex\` on the container — flex will place the children SIDE BY SIDE instead of overlapping, shrinking them and destroying the composition. The canonical example is a Switch toggle: the DSL shows a track PATH (\`relativeX:0, relativeY:0, w:40, h:24\`) and a knob circle (\`relativeX:17.5, relativeY:1.5, w:21, h:21\`) as siblings. Generate EXACTLY this structure:
\`\`\`
<div style="position:relative; width:40px; height:24px;">
  <div style="position:absolute; left:0px; top:0px;">@@SVG:{trackSvgKey}@@</div>
  <div style="position:absolute; left:17.5px; top:1.5px;">@@SVG:{knobSvgKey}@@</div>
</div>
\`\`\`
Each child's \`left\` and \`top\` come from that child's own \`layoutStyle.relativeX\` and \`layoutStyle.relativeY\`. Never use a shared \`left:0; top:0\` for all children. Never use flex.

9. **Fallback** — Nodes with NEITHER \`flexContainerInfo\` NOR being inside a flex container: use \`position: absolute; left: {relativeX}px; top: {relativeY}px;\`.
- Generate a single complete HTML file containing ALL sections in order, nested inside the root container.
- token fields must be generated as CSS variables with comments indicating the token name.
- If componentDocumentLinks exists, call mcp__getComponentLink to fetch documentation.
- When splitContainers is present, sections that were split from the same container must share that container's width and be wrapped together. **Apply the container's \`background\` to the parent wrapper**: splitContainer entries now include \`background\` (resolved CSS color) and \`fill\` (paint reference).
- CRITICAL — Table container boundary: when a design has a table (header + data rows), wrap the ENTIRE table area (header row + all data rows + any empty space below the last row down to the pagination) in a single container with the design's background color (usually white) and the table's border. The table may have only 1 data row but the container must extend to fill the design's allocated height — do NOT leave the area below the last row as page background showing through. The pagination bar sits BELOW this container as a sibling, not inside it.

### Text Provenance Self-Check (MANDATORY before finalizing output):
- Before writing the final HTML, enumerate every visible text string you plan to emit.
- For EACH string, verify it exists in \`rootMetadata.allTexts\` (the section LIST response carries this closed-set whitelist of all text in the design) OR in some section's \`dsl.rowTexts\` / \`node.text\`.
- Any string with NO provenance (typical offenders: fabricated column headers like "用户名称/所属组/远程IP", invented cell data like "1.1.3.543.4" or "AES-128", brand-watermark tokens like "Hillstone Design", generic menu labels not in the design) MUST be deleted or replaced with an empty placeholder.
- If you find yourself generating MORE distinct text strings than \`allTexts.length\`, STOP and re-check — you are hallucinating.

### Row Count Self-Check (MANDATORY for tables/lists):
- For every table, list, or repeated-row section in your output, look up its \`structureSiblingCount\`. This field appears in BOTH the section list entry AND each section DSL response (top-level \`structureSiblingCount\`).
- The number of data rows you render MUST equal \`structureSiblingCount\`. This is a hard constraint, not a suggestion.
- \`structureSiblingCount: 1\` means render EXACTLY 1 data row. Do NOT add rows "for visual density", "to look complete", or "because a pagination label says 共10项". Pagination labels reflect a UI control state, NOT a data-row count — they must never inflate the row count.
- Before outputting any table, verify: count your \`<tr>\` (data rows, excluding header) → it MUST equal \`structureSiblingCount\`. If you rendered more, delete the extras now.

### Tool Selection Rules:
- \`mcp__getDesignSections\` is the PRIMARY tool for full-page design-to-code generation. Always start here when you need to generate a complete HTML page from a design.
- \`mcp__getPageLayers\` ENUMERATES layer_ids. Use it when you have a page_id (layerId) and need the list of all layers inside it BEFORE restoring each layer — it returns a lightweight {id, name, type, depth, parentId, childrenCount, width, height} list, then you feed each layer_id back into \`getDesignSections\` or \`getDsl\` to restore. It CANNOT list a document's pages from a fileId alone — you must already have a page_id / layerId.
- \`mcp__extractSvg\` is a STANDALONE tool. Use it DIRECTLY when you only need to extract SVG icons from a design — do NOT call \`getDesignSections\` before it.
- \`mcp__getDsl\` is a FALLBACK — call it ONLY if \`getDesignSections\` returns an error (e.g. tool not available on older servers).
- NEVER call both \`getDesignSections\` AND \`getDsl\` for the same design.
- NEVER combine the section workflow with \`extractSvg\`. If you only need SVG icons, use \`extractSvg\` alone. If you need a full page, use the section workflow (which uses \`@@SVG:{svgShortKey}@@\` placeholders + \`mcp__applyDesign\` for SVG data).
- The section workflow provides COMPLETE data. Do NOT call \`getDsl\` to "verify".

### Output Format:
- The design-data tools (\`getDesignSections\`, \`getDsl\`, \`extractSvg\`, \`getMeta\`) accept an optional \`format\` parameter: \`json\` (default), \`yaml\`, or \`tree\`. \`yaml\`/\`tree\` use fewer tokens for large designs; all three round-trip without data loss. Set a session-wide default with the \`--format\` CLI flag or \`DEFAULT_FORMAT\` env var.

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
- **CRITICAL — splitContainers[].background IS the exact CSS background-color.** Copy it verbatim: \`background-color: <value>;\`. MUST NOT add gradients, MUST NOT change the color. The designer chose this color deliberately.
- **CRITICAL — OPACITY ON FRAME**: a FRAME's \`opacity\` field applies ONLY to its own background, NOT children. Use \`background-color: rgba(R, G, B, <opacity>)\` — NEVER use CSS \`opacity: X\` on the parent, which makes child text/icons translucent.
- **CRITICAL — NEVER promote a child node's gradient/fill onto its parent container.** A gradient \`linear-gradient(...)\` in the DSL is computed against THAT node's own bounding box — its stop offsets (e.g. \`#0063BA 83%\`) are percentages of that specific node's height, NOT the parent's height. If you copy such a gradient onto a differently-sized parent (e.g. a 88px navbar that contains a 195px-tall decorative oval), the stops map to the WRONG size and the visible color shifts or disappears entirely (blue appears only in the bottom 15px, leaving the top transparent). Rules:
  - The background/fill of a node applies to THAT node's element only, at THAT node's size. Render each node at its own \`layoutStyle.width/height\`.
  - A FRAME/GROUP/INSTANCE with NO \`_color\`/\`fill\` (empty) has NO background — leave it transparent. Do NOT borrow a child's fill to fill the parent.
  - Decorative layers with \`filter: blur(...)\` (e.g. \`filter: blur(81.6px)\`) or very low alpha (\`rgba(..., 0.0x)\`) are visual overlay accents (glow, bloom), NOT the container's base background. Keep them as positioned overlays inside the container — never extract their gradient as the container background.
  - If a container (navbar, card, header) needs a solid base background that the DSL doesn't directly provide on the FRAME node, derive it from the dominant opaque color among its children (e.g. the most common solid \`_color\`), not from a decorative gradient overlay.

### Anti-Hallucination Rules:
- You MUST use EXACT text content from the DSL data. NEVER invent, translate, or paraphrase text.
- If a section has empty or missing text data, render it as an empty placeholder — do NOT fabricate text.
- NEVER generate placeholder values, generic tags, fabricated amounts, or invented statistics.
- Every piece of text, every number, every label in your output MUST come directly from the DSL data.
- NEVER fabricate SVG path data for icons or vector shapes — use \`@@SVG:{svgShortKey}@@\` placeholders for ALL icons, then call \`mcp__applyDesign\`.
- NEVER fabricate background colors, gradients, or decorations that are not present in the DSL data.

### Empty Design Tolerance Rules (CLOSED-SET TEXT):
- Many designs are UNFINISHED wireframes or component-library showcases with sparse text. This is NORMAL, not missing data.
- The ONLY allowed text strings in your output are those present in \`dsl.rowTexts\` or \`node.text\` of some fetched section. The section list response carries \`rootMetadata.allTexts\` — the complete closed set of text strings in this design. Treat it as a whitelist: any string NOT in allTexts is a hallucination and MUST be removed.
- Sparse text is especially common when the design reuses a component library: the design itself may have only ~10 distinct text strings total, even though the rendered page looks dense. Do NOT infer more content from visual density or the page's apparent purpose.
- If a section has \`textTotal=0\` or empty \`rowTexts\`, render its STRUCTURE with EMPTY placeholders (\`<td></td>\`, blank labels, empty menu items) — do NOT invent column headers, menu item labels, IP addresses, algorithm names, or any data values to fill it.
- A table with 1 data row in the DSL renders as 1 data row in HTML. Do NOT pad with fabricated rows. Pagination labels like "共 10 项" reflect a UI control state, NOT a data-row count — never synthesize rows to match them.
- Brand-name leakage is forbidden: do NOT generate library/watermark tokens (e.g. "Hillstone Design", "Ant Design", "Material UI") even if they appear in component node names or you recognize the brand from training data. Only render text that appears in the design's own TEXT nodes.
- When in doubt about whether a text string is real: it is NOT real unless you can cite the sectionIndex it came from.

### SVG Icon Anti-Simplification Rules:
- PATH nodes carry a \`svgKey\` — the SVG markup is injected by \`mcp__applyDesign\` at the end. You MUST use \`@@SVG:{svgShortKey}@@\` placeholders — never hand-write \`<path d="...">\`.
- **SVG UNIQUENESS:** Each icon in the DSL is a distinct design artifact — different sections may have DIFFERENT icons even if they look similar (e.g. "搜索" in section 2 vs "搜索" in section 40 are DIFFERENT SVGs). NEVER reuse a \`svgShortKey\` from one section in another. Always use the exact \`svgKey\` from the PATH node in its own section.
- **NEVER substitute vector paths with simplified shapes** — a \`<path>\` containing a house icon is NOT replaceable by a \`<rect>\` + \`<polygon>\`. The designer chose every anchor point; your simplified version WILL look different.
- **VERIFY after copying each SVG**: count the number of \`M\` characters in the source path \`d\` attribute. Your copy MUST have exactly the same count. Fewer \`M\` → you corrupted the icon → redo.
- **SHAPE CHECK**: if the source uses \`<path>\`, your output MUST use \`<path>\`. NOT \`<rect>\`, NOT \`<circle>\`, NOT \`<ellipse>\`. Shape type changes ARE visual changes.
- The only acceptable SVG operation is: copy the complete \`<svg>...</svg>\` block from the DSL data and paste it into your HTML. Nothing else.
- **Common failure pattern**: you saw a complex path and thought "this looks roughly like 4 rectangles" → you drew 4 \`<rect>\`s → the result is visually WRONG. The designer chose a vector path for a reason. Trust the data.
- **COMPOSITE ICONS (logos, multi-subpath marks):** when a logo/brand mark is split into multiple sub-paths and stripped to svgCache, the SVG that \`mcp__applyDesign\` injects for the \`@@SVG:{svgShortKey}@@\` placeholder is the complete \`<svg>...</svg>\`. Keep it whole. The node's \`relativeX\`/\`relativeY\` are canvas placement coordinates — they are NOT to be reused as \`transform="translate(x,y) scale(...)"\` inside a hand-assembled \`<svg>\`. Doing so warps the glyph out of its viewBox.

### INSTANCE Variant State Rules:
- INSTANCE nodes may carry a **\`_variantProps\`** object with semantic state labels extracted from component variant properties (e.g. \`{"状态": "选中", "分类": "幽灵按钮", "尺寸": "24"}\`).
- **Active/selected state**: compare \`_variantProps\` across sibling INSTANCE nodes to find which one has \`"状态": "选中"\` or similar active-state values. Apply the \`.active\` CSS class ONLY to that node — NEVER default to the first item in a list.
- **Sidebar menu items**: each menu item (e.g. 22 submenu entries) is a separate section containing an INSTANCE with \`_variantProps\`. The item with \`"状态": "选中"\` in its \`_variantProps\` is the currently active page — the corresponding section's \`rowTexts[0]\` (or TEXT child) is its label. Render this item with \`class="submenu-item active"\`.
- **Button states**: \`"分类": "幽灵按钮"\` vs \`"分类": "主要按钮"\` determines the button's visual style (outline vs filled). Multiple buttons in the same toolbar may have different variant props — respect each one individually.
- If \`_variantProps\` is absent from all siblings, assume all are in \`default\` state — do NOT invent active states.

### Repeat / Row-Count Rules:
- Each section entry carries \`structureSiblingCount\` = the exact number of times this structure appears in the design.
- For data/table sections: the number of rendered rows MUST equal \`structureSiblingCount\`. A count of 1 means ONE row total — do not pad with fabricated rows "for visual density" or "to fill the table". The single row in the DSL IS the complete dataset.
- For \`structureSiblingCount >= 2\`: reuse the \`structureHash\` template, render exactly that many instances, swap per-instance text/colors from each section's own data.
- Pagination controls, "load more" buttons, and empty-state rows are CONTROLS, not data rows — never counted toward the dataset.

### Placeholder Text Rules:
- TEXT nodes may carry \`_placeholder: true\`. This flag marks text whose node name equals its content — the universal signature of component-library placeholder text (the slot name WAS the placeholder string, e.g. \`{name: "Hillstone Design", text: "Hillstone Design"}\`). This works across ALL component libraries without brand-specific tokens.
- \`_placeholder: true\` is a HINT, not a deletion. Read the surrounding context: if the flagged text does not map to a real column header, label, or content slot in this specific design, treat it as boilerplate and omit it. If it does map to real content, render it normally.
- Never blanket-render every \`_placeholder\` text as visible headers/columns.

### Data Completeness Rules:
- You MUST fetch ALL sections (0..totalSections-1). If totalSections=48, you must call sectionIndex=0 through 47 — no exceptions.
- Some sections may have nodeCount=3 and no visible TEXT nodes (text is in component property overrides). Do NOT skip them — the TEXT is resolved during DSL transfer. These sections contribute real content.
- **textPreview**: each section list entry carries a \`textPreview\` field (first TEXT node found, truncated to 20 chars). If two sections both have nodeCount=3 and empty name, use \`textPreview\` to tell them apart — they are different menu items (e.g. "系统信息" / "权限设置"), NOT duplicates.
- Keep a checklist: track which section indices have been requested. Do not stop until every index 0..N-1 has been fetched.
- If you accidentally skipped a section, go back and request the missing indices. An incomplete section set WILL cause missing content in the final HTML.



### Critical Rendering Checklist (MANDATORY — verify each item before finalizing):
Before declaring the HTML complete, enumerate every structural element below and confirm it is rendered. Missing ANY item is a fidelity defect.

1. **Sidebar menu item icons**: each sidebar menu section carries a PATH icon with a \`svgKey\`. Did you place \`@@SVG:{svgShortKey}@@\` for each? If you used a \`<rect>\` or \`<circle>\` or hand-wrote \`<path d="...">\`, DELETE it — the DSL does NOT contain path data. Use the placeholder.

2. **Table header column icons** (sort/filter/search): each table header cell may carry sort-arrow, filter-funnel, and search-lens PATH icons. Did you place \`@@SVG:{svgShortKey}@@\` for each? If a header cell has no icons, you may have skipped them.

3. **Pagination icons** (refresh, prev/next arrows, dropdown): the pagination section has MULTIPLE PATH icons. Did you place \`@@SVG:{svgShortKey}@@\` for EACH one?

4. **Brand/logo area text**: the brand section has a TEXT node with the actual brand name (present in \`allTexts\`). Did you render it as visible text?

5. **Every PATH node has a placeholder**: walk through every section's DSL — every PATH node must have a corresponding \`@@SVG:{svgShortKey}@@\` in your code. Count: the number of \`@@SVG:\` placeholders in your code MUST equal the total number of PATH nodes across all sections.

6. **Text provenance**: every text string in your output MUST be traceable to \`rootMetadata.allTexts\` or a section's \`dsl.rowTexts\`/\`node.text\`. If you cannot cite the exact source, the text is a hallucination — delete it.

7. **SVG placeholder replacement (HARD GATE)**: your HTML is INVALID and must NOT be output until you have called \`mcp__applyDesign\` with the complete code and used the returned \`patchedCode\`. This is not optional — it is the FINAL mandatory step. If you wrote ANY \`<path d="...">\` by hand instead of using \`@@SVG:{svgShortKey}@@\` placeholders, the \`mcp__applyDesign\` tool will detect it as a FABRICATED path and return an error. You MUST then replace those hand-written paths with placeholders and call \`mcp__applyDesign\` again. The ONLY acceptable output is the \`patchedCode\` returned by \`mcp__applyDesign\` — never your pre-replacement code.

If any item above is unchecked, your HTML is INCOMPLETE. Fix it before outputting.

### Data Interpretation Rules:
- Pagination/table-footer labels (e.g. "共 10 项", "X rows/page", "items per page") reflect UI control state — NOT data to replicate.
- "共 X 项" is the pagination widget showing "total X items". The actual data rows come from the table body sections (preceding the pagination section).
- Do NOT fabricate data rows based on pagination "total" values. Render ONLY the actual data rows present in the DSL.
- If the DSL contains 1 data row, output exactly 1 table row. Do NOT multiply rows to match a pagination label.
- **CRITICAL — SVG icons for table actions**: table action columns (操作列) use PATH icon nodes with \`svgShortKey\` fields. Place \`@@SVG:{svgShortKey}@@\` for each action button. NEVER render action buttons as \`<p>编辑</p>\` or \`<p>删除</p>\` plain text or hand-drawn shapes.
- **CRITICAL — Persistent sidebars**: render all sidebar levels as static visible columns positioned via splitContainers coordinates. Do NOT hide or toggle sidebar levels.
- **CRITICAL — NEVER reuse an SVG from one section in another**: each icon position has its OWN \`svgShortKey\` (e.g. \`S0#5\`) in the DSL. A collapse/fold button icon is a DIFFERENT vector from a menu navigation arrow even if both look like arrows. You MUST use the exact \`svgShortKey\` from the PATH node where the icon appears — never use a svgShortKey from a different PATH node.
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
      version: packageJson.version,
    },
    { instructions: SERVER_INSTRUCTIONS }
  );

  new GetVersionTool().register(server);
  new GetDesignSectionsTool().register(server);
  new GetPageLayersTool().register(server);
  new GetDslTool().register(server);
  new GetD2cTool().register(server);
  new GetC2dTool().register(server);
  new GetComponentLinkTool().register(server);
  new GetMetaTool().register(server);
  new GetComponentWorkflowTool().register(server);
  new GetFlutterWorkflowTool().register(server);
  new ExtractSvgTool().register(server);
  new ApplyDesignTool().register(server);

  server.connect(new StdioServerTransport());
}

main();
