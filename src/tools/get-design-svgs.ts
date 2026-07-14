import { z } from "zod";
import { BaseTool } from "./base-tool";
import { httpUtilInstance } from "../utils/api";
import { formatField, formatOutput } from "../utils/format";

const DESIGN_SVGS_TOOL_NAME = "mcp__getDesignSvgs";
const DESIGN_SVGS_TOOL_DESCRIPTION = `
[DEPRECATED] You do NOT need this tool in the section → applyDesign workflow.
The SVG cache is filled by mcp__getDesignSections during section fetching, and mcp__applyDesign reads the SAME cache to inject real SVG into your \`@@SVG:{svgKey}@@\` placeholders server-side (the SVG data never passes through you). So in the normal workflow you should NOT call this tool — just place \`@@SVG:{svgKey}@@\` placeholders and call mcp__applyDesign at the end.

This tool remains ONLY for legacy/manual workflows that still inline SVG by hand. It will be removed in a future release.

If you still call it (legacy path): after fetching ALL sections via mcp__getDesignSections, it returns the cached SVG HTML strings.
WHAT you get:
1. \`svgs\` — a flat map of svgKey -> complete \`<svg>...</svg>\` HTML string
2. \`resolvedIcons\` — a two-level index {sectionIndex: {iconName: svgKey}} for DIRECT lookup (resolvedIcons["N"]["X"] -> svgKey -> svgs[svgKey])
Do NOT render SVGs by hand or with placeholder shapes — the designer's original vector data is in this cache.

You can provide either:
1. fileId and layerId directly, or
2. a short link (like https://{domain}/goto/LhGgBAK)
`;

export class GetDesignSvgsTool extends BaseTool {
  name = DESIGN_SVGS_TOOL_NAME;
  description = DESIGN_SVGS_TOOL_DESCRIPTION;

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
    sourceLayerId: z
      .string()
      .optional()
      .describe(
        "Source layer ID from URL parameter source_layer_id. When provided, use this instead of layerId for all queries."
      ),
    shortLink: z
      .string()
      .optional()
      .describe("Short link (like https://{domain}/goto/LhGgBAK)."),
    format: formatField(),
  });

  async execute({
    fileId,
    layerId,
    sourceLayerId,
    shortLink,
    format,
  }: z.infer<typeof this.schema>) {
    try {
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

      const result = await httpUtilInstance.getDesignSvgs(
        finalFileId,
        effectiveLayerId
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
