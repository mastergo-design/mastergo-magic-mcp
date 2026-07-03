import { z } from "zod";
import { BaseTool } from "./base-tool";
import { httpUtilInstance } from "../utils/api";
import { formatField, formatOutput } from "../utils/format";

const DESIGN_SECTIONS_TOOL_NAME = "mcp__getDesignSections";
const DESIGN_SECTIONS_TOOL_DESCRIPTION = `
[PRIMARY] This is the main tool for all designs. Operates in TWO modes:

Mode 1 — Get layout overview (sectionIndex NOT provided):
Returns the list of all sections with id, name, type, nodeCount, textPreview (first TEXT node, 20 chars max), and a page-absolute bounding box (x, y, width, height) for each section, plus totalSections and totalNodes.
Also returns rootMetadata (root layer width/height/name/type/fill) when available. rootContainer CSS properties for the page wrapper. splitContainers for large page regions that were split into child sections.
Use this FIRST to understand the design scope. The per-section bbox tells you exactly where each section sits inside the root container — use it for absolute positioning when generating code.
Example: { "fileId": "123", "layerId": "456:789" }

Mode 2 — Get section DSL (sectionIndex provided):
Returns the full DSL for ONE specific section.
- PATH nodes come in TWO forms. (1) INLINED: most PATH nodes carry an \`svg\` field with the complete \`<svg>...</svg>\` string — copy it VERBATIM, no transformation needed. (2) STRIPPED: large sections strip SVGs to a cache; these PATH nodes carry a \`svgKey\` field AND a \`path\` array with empty \`data\`. For stripped nodes, call mcp__getDesignSvgs to get the svgHtml. ALWAYS check \`svg\` first; if absent, use \`svgKey\` to fetch.

CRITICAL — sectionIndex is SINGULAR: the parameter is sectionIndex (a SINGLE integer per call). There is NO plural sectionIndices parameter — passing an array will be rejected with an error. To fetch multiple sections you MUST make multiple calls, each with one sectionIndex.

IMPORTANT workflow:
1. First call WITHOUT sectionIndex to get the section list with node counts.
2. Then call WITH sectionIndex=0, then sectionIndex=1, ... up to totalSections-1 — ONE sectionIndex per call.
3. YOU MUST REQUEST ALL SECTIONS. Do NOT skip any section index — missing sections WILL cause missing content.
4. textPreview helps distinguish same-looking sections: "系统信息", "权限设置", "基本设置" — all may have nodeCount=3 and empty name but DIFFERENT textPreview. They are individual menu items, NOT duplicates.
5. Fetch sections in batches of 3-5 CONCURRENT calls (3-5 separate single-sectionIndex calls in parallel), wait for all results, then send the next batch. Each call has exactly one sectionIndex.
6. After fetching all sections, handle SVGs: inlined PATH nodes use their \`svg\` field directly; for stripped PATH nodes (those with \`svgKey\`), call mcp__getDesignSvgs to get SVG icons.
7. Count your requests. If totalSections=48, you must make exactly 48 sectionIndex calls (each with a SINGLE integer). Keep a checklist and do NOT stop early.
8. Generate the complete HTML with all SVG data.

DO NOT call mcp__getDsl after completing this workflow — all data is already provided.
If this tool returns an error (e.g. old server), fall back to mcp__getDsl.

You can provide either:
1. fileId and layerId directly, or
2. a short link (like https://{domain}/goto/LhGgBAK)
`;

export class GetDesignSectionsTool extends BaseTool {
  name = DESIGN_SECTIONS_TOOL_NAME;
  description = DESIGN_SECTIONS_TOOL_DESCRIPTION;

  constructor() {
    super();
  }

  schema = z.object({
    fileId: z
      .string()
      .optional()
      .describe(
        "MasterGo design file ID. Required if shortLink is not provided."
      ),
    layerId: z
      .string()
      .optional()
      .describe(
        "Root layer ID of the design. Required if shortLink is not provided."
      ),
    shortLink: z
      .string()
      .optional()
      .describe("Short link (like https://{domain}/goto/LhGgBAK)."),
    sourceLayerId: z
      .string()
      .optional()
      .describe(
        "Source layer ID from URL parameter source_layer_id. When provided, use this instead of layerId for all queries."
      ),
    sectionIndex: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "0-based section index (SINGULAR — a single integer per call). If omitted, returns the section list only. If provided, returns full DSL for that ONE specific section. To fetch multiple sections, make MULTIPLE separate calls each with a single sectionIndex. Do NOT pass an array."
      ),
    format: formatField(),
  }).passthrough();

  async execute({ fileId, layerId, shortLink, sourceLayerId, sectionIndex, format, ...rest }: z.infer<typeof this.schema>) {
    try {
      // 拦截 LLM 误用的复数参数 sectionIndices（schema 不声明它，但 passthrough 保留未知字段）。
      // 引导 LLM 改用单数 sectionIndex（每次一个，多次调用）。
      const sectionIndices = (rest as Record<string, unknown>).sectionIndices;
      if (sectionIndices !== undefined) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "Parameter 'sectionIndices' (plural) is NOT supported. Use 'sectionIndex' (SINGULAR — a single integer) instead. Make MULTIPLE separate calls, each with one sectionIndex (e.g. sectionIndex=15, then sectionIndex=16, ...). Passing an array will always return this error.",
              }),
            },
          ],
        };
      }

      if (!shortLink && (!fileId || (!layerId && !sourceLayerId))) {
        throw new Error(
          "Either provide fileId with layerId (or sourceLayerId), or provide a shortLink"
        );
      }

      let finalFileId = this.normalizeFileId(fileId);
      let finalLayerId = layerId;
      let finalSourceLayerId = sourceLayerId;

      if (shortLink) {
        const ids = await httpUtilInstance.extractIdsFromUrl(shortLink);
        finalFileId = this.normalizeFileId(ids.fileId);
        finalLayerId = ids.layerId;
        finalSourceLayerId = ids.sourceLayerId ?? sourceLayerId;
      }

      const effectiveLayerId = finalSourceLayerId || finalLayerId;
      if (!finalFileId || !effectiveLayerId) {
        throw new Error("Could not determine fileId or layerId (need layerId or sourceLayerId)");
      }

      const result = await httpUtilInstance.getDesignSections(
        finalFileId,
        effectiveLayerId,
        sectionIndex
      );

      return {
        content: [
          {
            type: "text" as const,
            text: formatOutput(result, format),
          },
        ],
      };
    } catch (error: any) {
      const errorMessage = error.response?.data ?? error?.message;
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(errorMessage),
          },
        ],
      };
    }
  }
}
