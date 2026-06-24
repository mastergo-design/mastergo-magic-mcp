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

function isDslPayload(data: unknown): data is DslPayload {
  return (
    typeof data === "object" &&
    data !== null &&
    !Array.isArray(data) &&
    Array.isArray((data as DslPayload).nodes)
  );
}

function toTree(data: unknown): string {
  if (!isDslPayload(data)) {
    // Only DSL node-trees get the compact layout; everything else stays JSON.
    return JSON.stringify(data);
  }
  const dsl = data;
  const lines: string[] = [];

  // globalVars: the styles map is already deduplicated by the server; surface it verbatim.
  lines.push("globalVars:");
  if (dsl.styles && typeof dsl.styles === "object") {
    for (const [key, val] of Object.entries(dsl.styles)) {
      lines.push(`  ${key}: ${JSON.stringify(val)}`);
    }
  }

  if (dsl.components !== undefined) {
    lines.push(`components: ${JSON.stringify(dsl.components)}`);
  }

  // Other top-level keys (e.g. componentDocumentLinks, rules, sectionIndex) pass through.
  for (const [key, val] of Object.entries(dsl)) {
    if (key === "styles" || key === "nodes" || key === "components") continue;
    lines.push(`${key}: ${JSON.stringify(val)}`);
  }

  lines.push("tree:");
  for (const node of dsl.nodes ?? []) {
    renderNode(node, 1, lines);
  }
  return lines.join("\n");
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
