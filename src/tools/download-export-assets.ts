import { z } from "zod";
import path from "path";
import { existsSync } from "fs";
import { writeFile, mkdir } from "fs/promises";
import { BaseTool } from "./base-tool";
import { httpUtilInstance } from "../utils/api";
import { formatField, formatOutput, formatToolError } from "../utils/format";

const EXPORT_ASSET_TOOL_NAME = "mcp__downloadExportAssets";
const EXPORT_ASSET_TOOL_DESCRIPTION = `
Download the REAL slice images (切图) that the designer configured on a MasterGo design,
and save them as local image files.

WHY THIS TOOL EXISTS
\`mcp__getExportAssets\` renders the slices server-side and returns a \`filePath\` — but that path
is on the SERVER's own disk, not yours. You cannot open it. This tool fetches the same bytes
over HTTP and writes them into YOUR local output directory, returning paths you can actually use.

WHEN TO USE
- You need the actual PNG / JPG / WEBP slice files to reference in generated code.
- \`mcp__getExportList\` told you which nodes are slices (nodes with Export settings).
  Slices MUST be restored as ONE whole image — never decomposed into child layers.

WHAT IT RETURNS
- \`assets[]\`: { exportId, layerId, fileName, format, bytes, filePath } — files actually written locally
- \`skipped[]\`: { exportId, reason } — slices that could not be fetched
- \`dir\`: the directory the files were written to

HOW IT WORKS (two-step, both automatic)
1. Lists the cached slices for this file/layer (\`exportId\` + metadata).
2. Downloads each one and writes it to \`outDir\`.

IMPORTANT — CACHE PREREQUISITE
The slice bytes are cached **in memory on the server** when \`mcp__getExportAssets\` renders them
(cache TTL ~5 minutes). So the correct order is:
  1) \`mcp__getExportList\` (or \`mcp__getExportAssets\`) to see/trigger the slices
  2) **this tool** to download them locally
If nothing is cached, this tool reports which exportIds are unavailable — call \`mcp__getExportAssets\`
first, then retry.

LIMITATIONS
- Only PNG / JPG / WEBP are produced server-side (SVG / PDF / AVIF are not).
- Slices attached to layers INSIDE a component instance are skipped by the renderer.
- At most 20 slices per underlying render call.
`;

export class DownloadExportAssetsTool extends BaseTool {
  name = EXPORT_ASSET_TOOL_NAME;
  description = EXPORT_ASSET_TOOL_DESCRIPTION;

  constructor() {
    super();
  }

  schema = z
    .object({
      fileId: z
        .string()
        .optional()
        .describe(
          "MasterGo design file ID (format: file/<fileId> in MasterGo URL). Required if shortLink is not provided."
        ),
      layerId: z
        .string()
        .optional()
        .describe(
          "Layer id (container / node) OR page id — same semantics as mcp__getExportList / mcp__getExportAssets."
        ),
      sourceLayerId: z
        .string()
        .optional()
        .describe(
          "Source layer ID from URL parameter source_layer_id. When provided, use this instead of layerId."
        ),
      shortLink: z
        .string()
        .optional()
        .describe("Short link (like https://{domain}/goto/LhGgBAK)."),
      exportIds: z
        .array(z.string())
        .optional()
        .describe(
          "Only download these export settings ids. Omit to download every cached slice in scope."
        ),
      outDir: z
        .string()
        .optional()
        .describe(
          "Output directory for the slice image files. Relative paths resolve against MG_OUTPUT_ROOT (default: current working directory). Omit to use the current working directory."
        ),
      format: formatField(),
    })
    .passthrough();

  async execute({
    fileId,
    layerId,
    shortLink,
    sourceLayerId,
    exportIds,
    outDir,
    format,
    ...rest
  }: z.infer<typeof this.schema>) {
    try {
      // 阻断未知参数（与其他工具一致）：排除 _ 前缀元字段。
      const unknownKeys = Object.keys(rest as Record<string, unknown>).filter(
        (k) => !k.startsWith("_")
      );
      if (unknownKeys.length > 0) {
        const errorText = `Unknown parameter(s): ${unknownKeys.join(", ")}. This tool only accepts: fileId, layerId, sourceLayerId, shortLink, exportIds, outDir, format. Remove the unknown parameter(s) and retry.`;
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify({ error: errorText }) }],
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

      // ① 列出服务端已缓存的切图（渲染发生在 mcp__getExportAssets）
      const list = await httpUtilInstance.listExportAssets(finalFileId, effectiveLayerId);
      const wanted = exportIds && exportIds.length > 0 ? new Set(exportIds) : null;
      const candidates = (list.assets || []).filter((a) => !wanted || wanted.has(a.exportId));

      const assets: Array<{
        exportId: string;
        layerId: string;
        fileName: string;
        format: string;
        bytes: number;
        filePath: string;
      }> = [];
      const skipped: Array<{ exportId: string; reason: string }> = [];

      for (const item of candidates) {
        try {
          // ② 逐个下载并落盘到本地
          const res = await httpUtilInstance.downloadExportAsset(
            finalFileId,
            effectiveLayerId,
            item.exportId
          );
          const targetDir = this.resolveOutDir(outDir);
          if (!existsSync(targetDir)) {
            await mkdir(targetDir, { recursive: true });
          }
          // 优先用服务端给的 Content-Disposition 文件名，失败再退回缓存清单里的名字。
          const headerName = parseFilename(res.contentDisposition);
          const fileName = sanitizeFileName(headerName || item.fileName || `${item.exportId}.png`);
          const filePath = path.join(targetDir, fileName);
          await writeFile(filePath, res.data);
          assets.push({
            exportId: item.exportId,
            layerId: item.layerId,
            fileName,
            format: item.format,
            bytes: res.data.length,
            filePath,
          });
        } catch (err: any) {
          skipped.push({
            exportId: item.exportId,
            reason: err?.response?.status === 404
              ? "slice not cached on the server (call mcp__getExportAssets first, cache TTL ~5min)"
              : err?.message || String(err),
          });
        }
      }

      if (assets.length === 0 && skipped.length === 0) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error:
                  "No cached slice found for this file/layer. Run mcp__getExportAssets (or mcp__getExportList to confirm there ARE export settings) first, then retry this tool. Slice bytes live in server memory for ~5 minutes after rendering.",
                fileId: finalFileId,
                layerId: effectiveLayerId,
                totalInScope: list.total ?? 0,
              }),
            },
          ],
        };
      }

      const dir = this.resolveOutDir(outDir);
      const result = {
        fileId: finalFileId,
        layerId: effectiveLayerId,
        totalInScope: list.total ?? 0,
        downloadedCount: assets.length,
        dir,
        assets,
        skipped,
        note:
          "Files were written to your LOCAL disk. Reference these filePath values in the code you generate. " +
          "Slices must be rendered as one whole image block, never decomposed into inner layers. " +
          "切图已下载到你本地目录，直接在生成的代码里引用 filePath；切图作为整体图片还原，不要拆解内部结构。",
      };

      return {
        content: [
          {
            type: "text" as const,
            text: formatOutput(result, format),
          },
        ],
      };
    } catch (error: any) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: formatToolError(error, "downloadExportAssets"),
          },
        ],
      };
    }
  }

  /**
   * 解析输出目录，沿用 applyDesign 的安全约束：相对路径解析到 MG_OUTPUT_ROOT
   * （默认 cwd），且禁止越出该根目录，避免 LLM 把文件写到任意位置。
   */
  private resolveOutDir(outDir?: string): string {
    const allowedRoot = path.resolve(process.env.MG_OUTPUT_ROOT || process.cwd());
    if (!outDir || !outDir.trim()) return allowedRoot;
    const requested = path.isAbsolute(outDir)
      ? path.resolve(outDir)
      : path.resolve(allowedRoot, outDir);
    const rel = path.relative(allowedRoot, requested);
    if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
      throw new Error(
        `outDir "${outDir}" resolves outside the allowed output root (${allowedRoot}). ` +
          `Use a path inside it, or set the MG_OUTPUT_ROOT environment variable to permit a different base.`
      );
    }
    return requested;
  }
}

/** 从 Content-Disposition 里取 filename（server 用双引号包裹）。 */
function parseFilename(contentDisposition?: string): string | null {
  if (!contentDisposition) return null;
  const m = /filename="?([^";]+)"?/i.exec(contentDisposition);
  return m ? m[1].trim() : null;
}

/** 去掉路径分隔符等不安全字符，防止文件名穿越。 */
function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "") || "slice.png";
}
