import { z } from "zod";
import yaml from "js-yaml";

/**
 * Output-format support for design-data tools.
 *
 * The `format` parameter lets the caller trade readability for token cost on the
 * (often very large) DSL payloads. `json` is the default and matches the prior
 * behavior exactly; `yaml` and `tree` are opt-in compact representations.
 *
 * IMPORTANT (fidelity-first): every non-JSON format must round-trip without data
 * loss. The `tree` renderer therefore renders *all* node properties (known keys
 * inline + a generic pass-through for the rest) so nothing is silently dropped,
 * and any serialization failure falls back to JSON rather than emitting partial
 * output.
 */

export const FORMAT_VALUES = ["json", "yaml", "tree"] as const;
export type OutputFormat = (typeof FORMAT_VALUES)[number];

export const FORMAT_DESCRIPTION = `Output format for design data. Defaults to json.
- json — default; useful when piping output into tools that expect JSON.
- yaml — fewer tokens than JSON for typical designs.
- tree — experimental compact format. Structural keys (id, name, type) are encoded positionally on each node line, and style values stay deduplicated in a globalVars block. Designs with heavy style reuse see the largest token savings.`;

/**
 * Reusable zod field for the `format` tool parameter.
 * Optional on the wire; the effective default (`json`) is applied in `formatOutput`.
 */
export function formatField() {
  return z.enum(FORMAT_VALUES).optional().describe(FORMAT_DESCRIPTION);
}

/**
 * Serialize design data in the requested format.
 *
 * Resolution order: explicit tool param  >  CLI/env default
 * (`process.env.DEFAULT_FORMAT`, set from `--format` in index.ts)  >  `json`.
 *
 * Non-DSL payloads (section lists, meta, svgs, error objects) always fall back to
 * JSON — the `tree` layout only applies to objects carrying a `nodes` array, so it
 * never corrupts data it does not understand.
 */
export function formatOutput(
  data: unknown,
  format?: OutputFormat | string
): string {
  const fmt = resolveFormat(format);
  if (fmt === "yaml") return toYaml(data);
  if (fmt === "tree") return toTree(data);
  return JSON.stringify(data); // json (default) — compact, identical to prior behavior
}

/**
 * Validate a raw format string (from a tool param, CLI flag, or env var).
 * Returns the normalized format, or null if invalid/unset.
 */
export function normalizeFormat(v?: string | null): OutputFormat | null {
  return isOutputFormat(v) ? v : null;
}

/** Explicit format > CLI/env default > json. */
function resolveFormat(format?: string | null): OutputFormat {
  return (
    normalizeFormat(format) ??
    normalizeFormat(process.env.DEFAULT_FORMAT) ??
    "json"
  );
}

function isOutputFormat(v: unknown): v is OutputFormat {
  return typeof v === "string" && (FORMAT_VALUES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// yaml
// ---------------------------------------------------------------------------

function toYaml(data: unknown): string {
  try {
    return yaml.dump(data, {
      lineWidth: -1, // do not wrap long strings / path data
      noRefs: true, // no &anchor / *alias — keeps output self-contained for the LLM
      quotingType: '"',
      sortKeys: false,
    });
  } catch {
    // Never lose data: fall back to JSON (with a marker) if YAML serialization fails.
    return "# yaml serialization failed; falling back to json\n" + JSON.stringify(data);
  }
}

// ---------------------------------------------------------------------------
// tree (experimental compact DSL format)
// ---------------------------------------------------------------------------
//
// Layout:
//   globalVars:            <- the server already-deduplicated `styles` map, verbatim
//     <styleId>: <json>
//   components: <json>      <- if present
//   <otherTopLevelKey>: <json>
//   tree:
//   <TYPE> <id> "<name>" <w>x<h> @<rx>,<ry> fill=<id> stroke=<id>/<w> ...
//     prop <k>=<v>          <- componentInfo.properties
//     flex <json>           <- flexContainerInfo
//     text "<content>" font=<id>
//     textColor <json>
//     <otherKey>=<json>     <- generic pass-through (fidelity safety net)
//     <child ...>           <- children, indented one level deeper

interface DslNode {
  [key: string]: unknown;
}
interface DslPayload {
  styles?: Record<string, unknown>;
  nodes?: DslNode[];
  components?: unknown;
  [key: string]: unknown;
}

/** Node keys rendered specially; all others pass through generically. */
const RESERVED_NODE_KEYS = new Set([
  "type",
  "id",
  "name",
  "layoutStyle",
  "fill",
  "strokeColor",
  "strokeType",
  "strokeAlign",
  "strokeWidth",
  "componentId",
  "componentInfo",
  "flexContainerInfo",
  "text",
  "textColor",
  "children",
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Dispatch on the real response shapes returned by the server:
 *   - Mode 2 section DSL: { sectionIndex, section, dsl: { styles, nodes, ... }, ... }
 *   - getDsl:              { dsl: { styles, nodes, ... }, componentDocumentLinks, rules }
 *   - Raw DSL:             { styles, nodes, components?, ... }
 *   - Mode 1 section list: { sections, totalSections, rootMetadata, ... }
 *   - getDesignSvgs/Texts: { svgs|texts: { key: value }, nodeCount|textCount }
 * Primitives, arrays, and truly unknown objects fall back to JSON so data is never
 * mis-formatted.
 */
function toTree(data: unknown): string {
  if (!isPlainObject(data)) {
    return JSON.stringify(data);
  }
  const obj = data;
  if (isPlainObject(obj.dsl) && Array.isArray((obj.dsl as DslPayload).nodes)) {
    return wrappedDslToTree(obj);
  }
  if (Array.isArray(obj.nodes)) {
    return renderDslBody(obj as DslPayload, []).join("\n");
  }
  if (Array.isArray(obj.sections)) {
    return sectionListToTree(obj);
  }
  if (isPlainObject(obj.svgs) || isPlainObject(obj.texts)) {
    return kvMapToTree(obj);
  }
  return JSON.stringify(data);
}

/**
 * Render a raw DSL object ({ styles, nodes, components? }) as globalVars + tree.
 * Other top-level keys pass through verbatim (fidelity safety net).
 * Appends to (and returns) `lines` so callers can prepend wrapper metadata.
 */
function renderDslBody(dsl: DslPayload, lines: string[]): string[] {
  // globalVars: the styles map is already deduplicated by the server; surface it verbatim.
  lines.push("globalVars:");
  if (isPlainObject(dsl.styles)) {
    for (const [key, val] of Object.entries(dsl.styles)) {
      lines.push(`  ${key}: ${JSON.stringify(val)}`);
    }
  }

  if (dsl.components !== undefined) {
    lines.push(`components: ${JSON.stringify(dsl.components)}`);
  }

  // Other top-level keys (e.g. componentDocumentLinks, rules) pass through.
  for (const [key, val] of Object.entries(dsl)) {
    if (key === "styles" || key === "nodes" || key === "components") continue;
    lines.push(`${key}: ${JSON.stringify(val)}`);
  }

  lines.push("tree:");
  for (const node of dsl.nodes ?? []) {
    renderNode(node, 1, lines);
  }
  return lines;
}

/** Wrapped DSL (Mode 2 section DSL or getDsl): emit sibling metadata, then the nested `dsl` body. */
function wrappedDslToTree(obj: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, val] of Object.entries(obj)) {
    if (key === "dsl") continue; // rendered as body below
    lines.push(`${key}: ${JSON.stringify(val)}`);
  }
  renderDslBody(obj.dsl as DslPayload, lines);
  return lines.join("\n");
}

const SECTION_ENTRY_KEYS = new Set([
  "type", "id", "name", "nodeCount", "x", "y", "width", "height", "layoutStyle",
]);

/** Mode 1: emit list metadata, then a compact `sections:` block (lossless pass-through). */
function sectionListToTree(obj: Record<string, unknown>): string {
  const lines: string[] = [];
  const sections = Array.isArray(obj.sections) ? (obj.sections as DslNode[]) : [];
  for (const [key, val] of Object.entries(obj)) {
    if (key === "sections") continue;
    lines.push(`${key}: ${JSON.stringify(val)}`);
  }
  lines.push("sections:");
  sections.forEach((s, i) => {
    const ls = (s.layoutStyle as Record<string, unknown> | undefined) ?? {};
    const w = s.width ?? ls.width;
    const h = s.height ?? ls.height;
    const x = s.x ?? ls.relativeX;
    const y = s.y ?? ls.relativeY;
    const extras: string[] = [];
    pushIf(extras, "nodeCount", s.nodeCount);
    lines.push(
      `  [${i}] ${s.type ?? "?"} ${s.id ?? "?"} ${quote(s.name)} ` +
        `${fmtNum(w)}x${fmtNum(h)} @${fmtNum(x)},${fmtNum(y)}` +
        (extras.length ? " " + extras.join(" ") : "")
    );
    // Fidelity safety net: any other section field.
    for (const [k, v] of Object.entries(s)) {
      if (SECTION_ENTRY_KEYS.has(k) || v === undefined) continue;
      lines.push(`    ${k}=${JSON.stringify(v)}`);
    }
  });
  return lines.join("\n");
}

/**
 * Flat key→value map payloads: getDesignSvgs `{ svgs, nodeCount }` and
 * getDesignTexts `{ texts, textCount }` (including the empty-cache variants).
 * Sibling scalars pass through; the map renders as a `svgs:`/`texts:` block with
 * one entry per line. Single-line values stay inline; multi-line values (SVG with
 * newlines, long text) indent on the following line(s) — value bytes are emitted
 * verbatim, never escaped, so SVG/text fidelity is preserved exactly.
 */
function kvMapToTree(obj: Record<string, unknown>): string {
  const lines: string[] = [];
  const mapKey = isPlainObject(obj.svgs) ? "svgs" : isPlainObject(obj.texts) ? "texts" : null;
  for (const [key, val] of Object.entries(obj)) {
    if (key === mapKey) continue;
    lines.push(`${key}: ${JSON.stringify(val)}`);
  }
  if (mapKey) {
    lines.push(`${mapKey}:`);
    const map = obj[mapKey] as Record<string, unknown>;
    for (const [k, v] of Object.entries(map)) {
      renderKvEntry(k, v, "  ", lines);
    }
  }
  return lines.join("\n");
}

/**
 * Render one map entry. Single-line string values go inline (`key: value`);
 * anything else puts the key on its own line and the value indented beneath, so
 * multi-line SVG / text content is preserved without escaping.
 */
function renderKvEntry(key: string, v: unknown, pad: string, lines: string[]): void {
  if (typeof v === "string" && !v.includes("\n")) {
    lines.push(`${pad}${key}: ${v}`);
    return;
  }
  lines.push(`${pad}${key}:`);
  const vpad = pad + "  ";
  if (typeof v === "string") {
    if (v === "") {
      lines.push(`${vpad}""`);
    } else {
      for (const ln of v.split("\n")) lines.push(vpad + ln);
    }
  } else {
    lines.push(`${vpad}${JSON.stringify(v)}`);
  }
}

function renderNode(node: DslNode, depth: number, lines: string[]): void {
  const pad = "  ".repeat(depth);
  const ls = (node.layoutStyle as Record<string, unknown> | undefined) ?? {};
  const dim = `${fmtNum(ls.width)}x${fmtNum(ls.height)}`;
  const pos = `@${fmtNum(ls.relativeX)},${fmtNum(ls.relativeY)}`;

  const extras: string[] = [];
  pushIf(extras, "fill", node.fill);
  if (node.strokeColor) {
    extras.push(
      `stroke=${node.strokeColor}${node.strokeWidth ? "/" + node.strokeWidth : ""}`
    );
  }
  pushIf(extras, "strokeType", node.strokeType);
  pushIf(extras, "strokeAlign", node.strokeAlign);
  pushIf(extras, "component", node.componentId);

  lines.push(
    `${pad}${node.type ?? "?"} ${node.id ?? "?"} ${quote(node.name)} ${dim} ${pos}` +
      (extras.length ? " " + extras.join(" ") : "")
  );

  const props = (node.componentInfo as { properties?: Record<string, unknown> } | undefined)
    ?.properties;
  if (props && typeof props === "object") {
    for (const [k, v] of Object.entries(props)) {
      lines.push(`${pad}  prop ${k}=${JSON.stringify(v)}`);
    }
  }

  if (node.flexContainerInfo !== undefined) {
    lines.push(`${pad}  flex ${JSON.stringify(node.flexContainerInfo)}`);
  }

  if (Array.isArray(node.text)) {
    for (const t of node.text as Array<Record<string, unknown>>) {
      const raw = t?.text;
      const content =
        typeof raw === "string" ? raw : JSON.stringify(raw);
      lines.push(`${pad}  text ${quote(content)}${t?.font ? ` font=${t.font}` : ""}`);
    }
  }

  if (node.textColor !== undefined) {
    lines.push(`${pad}  textColor ${JSON.stringify(node.textColor)}`);
  }

  // Fidelity safety net: render any non-reserved property so no data is silently dropped.
  for (const [key, val] of Object.entries(node)) {
    if (RESERVED_NODE_KEYS.has(key) || val === undefined) continue;
    lines.push(`${pad}  ${key}=${JSON.stringify(val)}`);
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children as DslNode[]) {
      renderNode(child, depth + 1, lines);
    }
  }
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function pushIf(arr: string[], label: string, val: unknown): void {
  if (val !== undefined && val !== null && val !== "") {
    arr.push(`${label}=${val}`);
  }
}

function fmtNum(v: unknown): string {
  return v === undefined || v === null ? "?" : String(v);
}

function quote(v: unknown): string {
  const s = v === undefined || v === null ? "" : String(v);
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}
