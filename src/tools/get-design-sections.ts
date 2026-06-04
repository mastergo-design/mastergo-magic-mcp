import { z } from "zod";
import { BaseTool } from "./base-tool";
import { httpUtilInstance } from "../utils/api";

const DESIGN_SECTIONS_TOOL_NAME = "mcp__getDesignSections";
const DESIGN_SECTIONS_TOOL_DESCRIPTION = `
[PRIMARY] This is the main tool for all designs. Operates in TWO modes:

Mode 1 — Get layout overview (sectionIndex NOT provided):
Returns the list of all sections with id, name, type, and nodeCount, plus totalSections and totalNodes.
Also returns rootMetadata (root layer width/height/name/type/fill) when available.
Use this FIRST to understand the design scope.
Example: { "fileId": "123", "layerId": "456:789" }

Mode 2 — Get section DSL (sectionIndex provided):
Returns the full DSL for ONE specific section.
- PATH nodes have their svgHtml stripped. After fetching ALL sections, call mcp__getDesignSvgs to retrieve them.

IMPORTANT workflow:
1. First call WITHOUT sectionIndex to get the section list with node counts.
2. Then call WITH sectionIndex=0, sectionIndex=1, ... up to totalSections-1.
3. You MUST fetch ALL sections. Do NOT skip any section index.
4. CRITICAL: Fetch sections in BATCHES of 3-5 at a time. Do NOT request all sections simultaneously — too many concurrent requests will cause timeouts. Send 3-5 sectionIndex calls, wait for all results, then send the next batch.
5. After fetching all sections, call mcp__getDesignSvgs to get SVG icons.
6. Generate the complete HTML with all SVG data.

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
      .optional()
      .describe(
        "0-based section index. If omitted, returns the section list only. If provided, returns full DSL for that specific section."
      ),
  });

  async execute({ fileId, layerId, shortLink, sourceLayerId, sectionIndex }: z.infer<typeof this.schema>) {
    try {
      if (!shortLink && (!fileId || !layerId)) {
        throw new Error(
          "Either provide both fileId and layerId, or provide a shortLink"
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

      if (!finalFileId || !finalLayerId) {
        throw new Error("Could not determine fileId or layerId");
      }

      const effectiveLayerId = finalSourceLayerId || finalLayerId;

      const result = await httpUtilInstance.getDesignSections(
        finalFileId,
        effectiveLayerId,
        sectionIndex
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result),
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
