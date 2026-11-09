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
Rendering a slice produces image bytes on the **SERVER's** disk — a \`filePath\` you cannot open
from your machine. This tool fetches those bytes over HTTP and writes them into YOUR local output
directory, returning paths you can actually use.

WHEN TO USE
- You need the actual PNG / JPG / WEBP slice files to reference in generated code.
- \`mcp__getExportList\` told you which nodes are slices (nodes with Export settings).
  Slices MUST be restored as ONE whole image — never decomposed into child layers.

WHAT IT RETURNS
- \`assets[]\`: { exportId, layerId, fileName, format, bytes, filePath } — files actually written locally
- \`skipped[]\`: { exportId, reason } — slices that could not be fetched
- \`dir\`: the directory the files were written to
- \`autoRendered\`: true when this call had to render the slices first (nothing was cached yet)

HOW IT WORKS (fully automatic — ONE call is enough)
1. Reads the server's cached slice list for this file/layer.
2. If nothing is cached, it **renders the slices automatically** (no extra call needed from you).
3. Downloads each slice and writes it to \`outDir\`.

WHY THAT MATTERS
The server caches rendered slice bytes in memory (TTL ~5 minutes). If you call this tool long after
a previous render, the cache may have expired — this tool re-renders on demand instead of failing.

SCOPE SEMANTICS
Scope = the subtree of the \`layerId\` you pass. A node that is ITSELF a slice is NOT part of its own
subtree, so if you expect slices and get none, pass the PAGE id (e.g. \`layerId: "M"\`).

WHAT "NO SLICE" MEANS
If the design genuinely has no Export settings in scope, this tool says so explicitly — in that case
restore the nodes as normal layers (from the DSL), do NOT invent images.

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
          "Layer id (container / node) OR page id — same semantics as mcp__getExportList. A slice node does not include itself in its own subtree scope; use the page id to find slices."
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

      // ① 先读缓存清单。缓存空 → 自动触发一次渲染（POST /mcp/export-render），再读一次。
      //
      // 这一步很关键：客户端拿不到 SSE 工具 mcp__getExportAssets，如果不自己渲染，
      // 服务端缓存永远为空，下载必然 404。自动补渲染让「一步调用即可拿图」成立。
      let list = await httpUtilInstance.listExportAssets(finalFileId, effectiveLayerId);
      let autoRendered: any = null;
      if ((list.assets || []).length === 0) {
        autoRendered = await httpUtilInstance.renderExportAssets(
          finalFileId,
          effectiveLayerId,
          exportIds
        );
        // 渲染后缓存已写入；再读一次清单拿到最新可下载项。
        list = await httpUtilInstance.listExportAssets(finalFileId, effectiveLayerId);
      }

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
              ? "slice cache expired between render and download (server cache TTL ~5min); retry this tool"
              : err?.message || String(err),
          });
        }
      }

      if (assets.length === 0 && skipped.length === 0) {
        // 走到这里说明：自动渲染后依然没有任何可下载切图 —— 通常是这个范围里真的没有切图配置。
        // 把渲染结果里的 total 与渲染说明带回去，让调用方区分「没切图」和「渲染失败」。
        const renderedTotal = autoRendered?.total ?? list.total ?? 0;
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error:
                  "No downloadable slice in this range. " +
                  (renderedTotal === 0
                    ? "The design has NO Export settings in this scope — restore these nodes as normal layers instead. " +
                      "Pass the page id (e.g. layerId=M) if you expected to find slices here, since a slice node does not include itself in its own subtree scope."
                    : "Export settings exist but nothing could be rendered (see render output)."),
                fileId: finalFileId,
                layerId: effectiveLayerId,
                totalInScope: renderedTotal,
                autoRendered: autoRendered ? true : false,
                renderNote: autoRendered?.note,
                renderSkipped: autoRendered?.skipped,
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
        autoRendered: autoRendered ? true : false,
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
