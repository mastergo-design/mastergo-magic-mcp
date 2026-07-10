import { z } from "zod";
import { BaseTool } from "./base-tool";
import { httpUtilInstance } from "../utils/api";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const APPLY_DESIGN_TOOL_NAME = "mcp__applyDesign";
const APPLY_DESIGN_TOOL_DESCRIPTION = `
Finalize generated design code: replace ALL placeholders (SVG icons + long text) with real high-precision data from the design cache, then write the final file directly to disk.

WHAT it does:
1. Replaces every \`@@SVG:{svgKey}@@\` placeholder with the real high-precision \`<svg>\` markup from the SVG cache (character-for-character exact, no rounding).
2. Replaces every \`T{sectionIndex}|{nodeId}\` text placeholder with the real long text from the text cache.
3. Detects fabricated (hand-written) \`<path d="...">\` that were NOT injected via placeholders — reports them as errors.
4. Writes the finalized code directly to \`{outDir}/{outputFileName}\` on disk.

CRITICAL — outDir is MANDATORY: Always provide outDir so the finalized code is written directly to disk. This ensures the server-injected data reaches the file WITHOUT any LLM re-processing. Do NOT copy the code back into your response and re-output it — that causes precision loss. The file written by this tool IS the final deliverable.

PLACEHOLDER FORMATS:
- SVG icons: \`@@SVG:{svgKey}@@\` — svgKey comes from the PATH node's svgKey field in the section DSL.
  Example: <span class="icon">@@SVG:S47:通用/刷新|1:10058/1:09668/1:6273/1:5280@@</span>
- Long text: \`T{sectionIndex}|{nodeId}\` — appears in TEXT nodes whose text was too long for inline DSL.
  Example: <p>T3|1:1234:5678</p>

The replacement works for ANY target language — it's pure string substitution.

You can provide either:
1. fileId and layerId directly, or
2. a short link (like https://{domain}/goto/LhGgBAK)

IMPORTANT: Call this tool with the COMPLETE code string. After the tool writes the file, you are DONE — do NOT output or edit the code further.
`;

export class ApplyDesignTool extends BaseTool {
  name = APPLY_DESIGN_TOOL_NAME;
  description = APPLY_DESIGN_TOOL_DESCRIPTION;

  constructor() {
    super();
  }

  schema = z.object({
    fileId: z
      .string()
      .optional()
      .describe(
        "MasterGo design file ID. Required if shortLink is not provided. Must match the fileId used in getDesignSections."
      ),
    layerId: z
      .string()
      .optional()
      .describe(
        "Root layer ID of the design. Required if shortLink is not provided. Must match the layerId used in getDesignSections."
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
    code: z
      .string()
      .describe(
        "The COMPLETE generated code containing @@SVG:{svgKey}@@ and/or T{sectionIndex}|{nodeId} placeholders."
      ),
    outDir: z
      .string()
      .describe(
        "Output directory where the final file will be written. The finalized code (with all placeholders replaced by real data) is written directly to this directory — do NOT re-output or edit the code after this tool runs. Example: '/Users/you/project/output' or './output'."
      ),
    outputFileName: z
      .string()
      .optional()
      .describe(
        "Output file name (default: 'index.html'). Include extension. Example: 'snmp-agent.html'."
      ),
  });

  async execute(params: z.infer<typeof this.schema>) {
    try {
      const { fileId, layerId, sourceLayerId, shortLink, code, outDir, outputFileName } = params;

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

      if (!outDir || !outDir.trim()) {
        throw new Error("outDir is required — the finalized code must be written directly to disk to prevent LLM re-processing");
      }

      const result = await httpUtilInstance.applyDesign(
        code,
        finalFileId,
        effectiveLayerId
      );

      // 拿到服务端返回的 finalizedCode，直接写入磁盘
      // 这是关键：finalizedCode 从不回到 LLM 对话里，LLM 没有二次编辑的机会
      const finalizedCode = result.patchedCode;
      const fileName = outputFileName?.trim() || "index.html";
      const targetDir = path.isAbsolute(outDir)
        ? path.join(outDir)
        : path.join(process.cwd(), outDir);
      if (!existsSync(targetDir)) {
        await mkdir(targetDir, { recursive: true });
      }
      const filePath = path.join(targetDir, fileName);
      await writeFile(filePath, finalizedCode, "utf8");

      // 返回简要报告（不返回 finalizedCode 全文——防止 LLM 拿到后又编辑）
      const report = result.report || {};
      const response: any = {
        success: true,
        filePath,
        fileName,
        report,
      };
      if (report.unresolved?.length > 0) {
        response.warning = `${report.unresolved.length} placeholder(s) unresolved — check svgKey values.`;
      }
      if (report.fabricatedPaths?.length > 0) {
        response.error = `${report.fabricatedPaths.length} fabricated path(s) detected — replace them with @@SVG:{svgKey}@@ placeholders and re-run.`;
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(response),
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
