import { z } from "zod";
import { BaseTool } from "./base-tool";
import { httpUtilInstance } from "../utils/api";
import { clearSectionWorkflow } from "./get-dsl";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { toolName } from "../utils/tool-prefix";

const APPLY_DESIGN_TOOL_DESCRIPTION = `
Finalize generated design code: replace ALL placeholders (SVG icons + long text) with real high-precision data from the design cache, then write the final file directly to disk.

WHAT it does:
1. Replaces every \`@@SVG:{svgShortKey}@@\` placeholder with the real high-precision \`<svg>\` markup from the SVG cache (character-for-character exact, no rounding).
2. Replaces every \`T{sectionIndex}|{nodeId}\` text placeholder with the real long text from the text cache.
3. Detects fabricated (hand-written) \`<path d="...">\` that were NOT injected via placeholders — reports them as errors.
4. Writes the finalized code directly to \`{outDir}/{outputFileName}\` on disk.

CRITICAL — outDir is MANDATORY: Always provide outDir so the finalized code is written directly to disk. This ensures the server-injected data reaches the file WITHOUT any LLM re-processing. Do NOT copy the code back into your response and re-output it — that causes precision loss. The file written by this tool IS the final deliverable.

PLACEHOLDER FORMATS:
- SVG icons: \`@@SVG:{svgShortKey}@@\` — svgShortKey comes from the PATH node's svgShortKey field in the section DSL.
  Example: <span class="icon">@@SVG:S0#0@@</span>
- Long text: \`T{sectionIndex}|{nodeId}\` — appears in TEXT nodes whose text was too long for inline DSL.
  Example: <p>T3|1:1234:5678</p>

The server escapes the injected data according to the \`targetLang\` parameter:
- \`html\` (default, also for Vue templates): place the placeholder in element content (\`<span>@@SVG:S0#0@@</span>\`, \`<p>T3|1:2</p>\`). SVG is inserted as-is; long text is HTML-escaped (& < >).
- \`dart\` (Flutter): place the placeholder inside a single-quoted string literal (\`SvgPicture.string('@@SVG:S0#0@@')\`, \`Text('T3|1:2')\`). SVG/text are escaped for that string (\\ ' newline). Pass \`targetLang: "dart"\`.
Pick targetLang to match the code you generated, and place placeholders in that language's standard position shown above.

You can provide either:
1. fileId and layerId directly, or
2. a short link (like https://{domain}/goto/LhGgBAK)

IMPORTANT: Call this tool with the COMPLETE code string. After the tool writes the file, you are DONE — do NOT output or edit the code further.
`;

export class ApplyDesignTool extends BaseTool {
  get name() {
    return toolName("applyDesign");
  }
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
        "The COMPLETE generated code containing @@SVG:{svgShortKey}@@ and/or T{sectionIndex}|{nodeId} placeholders."
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
    targetLang: z
      .enum(["html", "dart"])
      .optional()
      .describe(
        "Target language of the generated code, decides placeholder escaping. 'html' (default, also for Vue): SVG inserted as-is into element content, long text HTML-escaped. 'dart' (Flutter): SVG/text escaped for single-quoted string literals (SvgPicture.string('...'), Text('...'))."
      ),
  });

  async execute(params: z.infer<typeof this.schema>) {
    try {
      const { fileId, layerId, sourceLayerId, shortLink, code, outDir, outputFileName, targetLang } = params;

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
        effectiveLayerId,
        finalSourceLayerId,
        targetLang
      );

      // 服务端必须返回 patchedCode；缺失时给出清晰错误而非误导性的栈异常。
      const finalizedCode = result.patchedCode;
      if (typeof finalizedCode !== "string" || !finalizedCode) {
        throw new Error("Server did not return patchedCode. Check that frontend-mcp-server is up to date.");
      }

      // 路径安全：outputFileName 与 outDir 均由 LLM 控制，MCP 工具输入本质来自用户消息，
      // 可被 prompt-injection 利用写任意路径。双重防护：
      //   1) outputFileName 剥目录分量（basename）防文件名穿越；
      //   2) outDir 解析后必须落在「允许根」内（默认 cwd，可用可信配置 MG_OUTPUT_ROOT 覆盖），
      //      防止把 LLM 可控内容写到 ~/.ssh、shell 配置等任意绝对路径（任意文件覆盖）。
      const fileName = path.basename(outputFileName?.trim() || "index.html");
      const allowedRoot = path.resolve(process.env.MG_OUTPUT_ROOT || process.cwd());
      const requestedDir = path.isAbsolute(outDir)
        ? path.resolve(outDir)
        : path.resolve(allowedRoot, outDir);
      const rel = path.relative(allowedRoot, requestedDir);
      if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
        throw new Error(
          `outDir "${outDir}" resolves outside the allowed output root (${allowedRoot}). ` +
          `Use a path inside it, or set the MG_OUTPUT_ROOT environment variable to permit a different base.`
        );
      }
      const targetDir = requestedDir;
      if (!existsSync(targetDir)) {
        await mkdir(targetDir, { recursive: true });
      }
      const filePath = path.join(targetDir, fileName);
      await writeFile(filePath, finalizedCode, "utf8");

      // 工作流完成：清理该设计的 section 跟踪数据，释放内存（stdio 长驻进程防泄漏）。
      clearSectionWorkflow(finalFileId, effectiveLayerId);

      // 返回简要报告（不返回 finalizedCode 全文——防止 LLM 拿到后又编辑）
      const report = result.report || {};
      const response: any = {
        success: true,
        filePath,
        fileName,
        report,
      };
      // 优先透传服务端已算好的 warning/error（服务端 route 已按 svgUnresolved/textUnresolved 组装）。
      if (result.warning) response.warning = result.warning;
      if (result.error) response.error = result.error;
      // 兜底：服务端未给 warning 时，用正确字段本地补（report 字段是 svgUnresolved/textUnresolved，
      // 无 report.unresolved 字段——旧代码读它恒 undefined，警告永不触发）。
      if (!response.warning) {
        const unresolvedCount =
          (report.svgUnresolved?.length || 0) + (report.textUnresolved?.length || 0);
        if (unresolvedCount > 0) {
          response.warning = `${unresolvedCount} placeholder(s) unresolved — check svgShortKey/text keys.`;
        }
      }
      const fabricated = report.fabricatedPaths ?? [];
      if (!response.error && fabricated.length > 0) {
        response.error = `${fabricated.length} fabricated path(s) detected — replace them with @@SVG:{svgShortKey}@@ placeholders and re-run.`;
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
