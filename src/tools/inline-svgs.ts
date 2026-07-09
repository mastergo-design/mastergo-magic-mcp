import { z } from "zod";
import { BaseTool } from "./base-tool";
import { httpUtilInstance } from "../utils/api";

const INLINE_SVGS_TOOL_NAME = "mcp__inlineSvgs";
const INLINE_SVGS_TOOL_DESCRIPTION = `
Replace @@SVG:{svgKey}@@ placeholders in generated code with the real high-precision SVG markup from the design's SVG cache.

WHY this exists: when generating code, copying SVG path data character-for-character is error-prone — coordinates get rounded (17.522848 → 17.523), separators change, M-subpaths get dropped. Instead of hand-copying SVG path data, place a placeholder @@SVG:{svgKey}@@ where each icon should appear, then call this tool once at the end to substitute them with the designer's exact vector data.

WHEN to call: AFTER generating the complete code (HTML/Vue/Flutter/etc.) that contains @@SVG:...@@ placeholders. This is the FINAL step before delivering the code.

WHAT it does:
1. Finds every @@SVG:{svgKey}@@ placeholder in your code.
2. Looks up each svgKey in the SVG cache (populated during getDesignSections / getDesignSvgs).
3. Replaces the placeholder with the complete real <svg>...</svg> markup, character-for-character exact.
4. Returns the patched code + a report (how many replaced, any unresolved).

The placeholder format is @@SVG:{svgKey}@@ where svgKey comes from the PATH node's svgKey field in the section DSL. Examples:
- HTML: <span class="icon">@@SVG:S47:通用/刷新|1:10058/1:09668/1:6273/1:5280@@</span>
- Dart:  SvgPicture.string('@@SVG:S47:通用/刷新|1:10058/1:09668/1:6273/1:5280@@')
- JSX:   <span>{/*@@SVG:S4:图标|1:09203/1:07848/1:4987@@*/}</span>

The replacement works for ANY target language — it's pure string substitution. The placeholder is just a short key the LLM places; the path data never passes through LLM generation.

You can provide either:
1. fileId and layerId directly, or
2. a short link (like https://{domain}/goto/LhGgBAK)

IMPORTANT: Call this tool with the COMPLETE code string. The returned patchedCode is your final deliverable — output it as-is.
`;

export class InlineSvgsTool extends BaseTool {
  name = INLINE_SVGS_TOOL_NAME;
  description = INLINE_SVGS_TOOL_DESCRIPTION;

  constructor() {
    super();
  }

  schema = z.object({
    fileId: z
      .string()
      .optional()
      .describe(
        "MasterGo design file ID (format: file/<fileId> in MasterGo URL). Required if shortLink is not provided. Must match the fileId used in getDesignSections/getDesignSvgs."
      ),
    layerId: z
      .string()
      .optional()
      .describe(
        "Root layer ID of the design (format: ?layer_id=<layerId>). Required if shortLink is not provided. Must match the layerId used in getDesignSections/getDesignSvgs."
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
      .describe("Short link (like https://{domain}/goto/LhGgBAK). Must match the one used in getDesignSections/getDesignSvgs."),
    code: z
      .string()
      .describe(
        "The COMPLETE generated code containing @@SVG:{svgKey}@@ placeholders. This is the full HTML/Vue/Flutter/etc. file you generated. The tool returns the code with all placeholders replaced by real SVG markup."
      ),
  });

  async execute(params: z.infer<typeof this.schema>) {
    try {
      const { fileId, layerId, sourceLayerId, shortLink, code } = params;

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

      if (typeof code !== "string" || !code.trim()) {
        throw new Error("code must be a non-empty string of the generated code");
      }

      const result = await httpUtilInstance.inlineSvgs(
        code,
        finalFileId,
        effectiveLayerId
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
