import { z } from "zod";
import { BaseTool } from "./base-tool";
import { httpUtilInstance } from "../utils/api";
import { formatField, formatOutput } from "../utils/format";

const DESIGN_SVGS_TOOL_NAME = "mcp__getDesignSvgs";
const DESIGN_SVGS_TOOL_DESCRIPTION = `
After fetching ALL sections via mcp__getDesignSections, call this tool to retrieve all cached SVG HTML strings.

This tool returns the SVG HTML for ALL sections that had stripped SVGs during the section fetch.

WHEN to call: AFTER you have fetched every section (0..totalSections-1) via mcp__getDesignSections.
The SVG cache is populated during section fetching — call getDesignSvgs after ALL sections are done.

WHAT you get: two structures in the response:
1. \`svgs\` — a flat map of svgKey -> complete \`<svg>...</svg>\` HTML string
2. \`resolvedIcons\` — a two-level index {sectionIndex: {iconName: svgKey}} for DIRECT lookup

HOW to use: for section N with an icon named "X", do:
  resolvedIcons["N"]["X"] -> svgKey -> svgs[svgKey] -> svgHtml
This is zero string matching — just dictionary lookups.

CRITICAL — DO NOT skip this step if any section has hasStrippedSvgs: true.
Missing SVGs include: logo/brand marks, pagination arrows (prev/next), table action icons (edit/delete), refresh buttons, filter/search icons, sidebar menu icons, and more.
CRITICAL — DO NOT render stripped SVGs by hand or with placeholder shapes. The designer's original vector data is in this cache — use it.

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
