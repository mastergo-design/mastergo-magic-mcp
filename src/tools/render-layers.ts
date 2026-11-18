import { z } from "zod";
import path from "path";
import { existsSync } from "fs";
import { writeFile, mkdir } from "fs/promises";
import { BaseTool } from "./base-tool";
import { httpUtilInstance } from "../utils/api";
import { formatField, formatOutput, formatToolError } from "../utils/format";
import { sanitizeFileName } from "../utils/security";

const RENDER_LAYERS_TOOL_NAME = "mcp__renderLayers";
const RENDER_LAYERS_TOOL_DESCRIPTION = `
Render ANY layer of a MasterGo design to a real image file (PNG / JPG / WEBP) — **you do not need
Export (切图) settings on the layer**. This is the tool for "screenshot this frame / this component
as it looks on canvas".

WHEN TO USE — pick carefully, these three are different:
- \`mcp__getExportList\`  → METADATA ONLY: which nodes the designer marked as slices.
- \`mcp__downloadExportAssets\` → the slices the designer configured (respects their scale/quality).
- \`mcp__renderLayers\` (this one) → ANY layer by id, Export settings NOT required.

Typical uses: visual-regression baselines (design vs implemented page, 1:1 diff), delivery review
(checking an HTML prototype against the lo-fi design), grabbing a screen without asking designers to
add Export settings.

WHAT YOU GET BACK
- \`assets[]\`: { exportId, layerId, format, width, height, bytes, filePath }
  **\`exportId\` equals \`layerId\`** for this tool — so you can also fetch bytes yourself with
  GET /mcp/export-asset?fileId=..&layerId=..&exportId=<layerId>.
- \`skipped[]\`: { layerId, reason } — layers that could not be rendered, with a readable reason.
- \`dir\`: output directory; files are named \`<layerId>.<ext>\`.

SCOPE SEMANTICS (same as the export tools)
- \`layerId\` is the CONTAINER used to fetch design data (a frame / a page id). Default target is that
  container itself.
- \`layerIds\` lets you render several specific layers in one call (max 20 per call; more → \`truncated\`).
  Each must live inside the \`layerId\` container's data.

LIMITATIONS (report them honestly)
- Layers INSIDE a component instance (layer id contains "/") cannot be rendered — render the instance
  itself instead. They come back in \`skipped\` with that reason.
- Only PNG / JPG / WEBP. SVG export is a client-side path, PDF/AVIF are not produced here.
- Engine pixel ceiling is 15000x15000. Oversize targets are rejected up front with the actual size —
  lower \`scale\` or render a smaller container.
- A hidden layer renders to an empty area; the reason will say so (not "too large").
- Image fills are fetched server-side and sent to the renderer; \`images.loaded/skipped\` tells you
  whether any picture was missing (a missing image is drawn as nothing, not as an error).

The returned files are regular image files on disk — reference \`filePath\` in your work; do NOT paste
large base64 into the conversation.
`;

export class RenderLayersTool extends BaseTool {
  name = RENDER_LAYERS_TOOL_NAME;
  description = RENDER_LAYERS_TOOL_DESCRIPTION;

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
          "Container (frame) or page id used to fetch design data. Default render target is this container itself. Required if shortLink is not provided."
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
      layerIds: z
        .array(z.string())
        .optional()
        .describe(
          "Specific layers to render (each must live inside the layerId container). Omit to render the container itself. Max 20 per call."
        ),
      // 刻意不叫 `format`：12 个既有工具里 `format` 一律是「输出格式（json/yaml/tree）」，
      // 而这里的「格式」指的是图片格式。占用 format 会让 LLM 把 format:"json" 传给图片格式，
      // 或者反过来。两件事分开命名，歧义消失。
      imageFormat: z
        .enum(["PNG", "JPG", "WEBP"])
        .optional()
        .describe("Image format for the rendered file. Defaults to PNG. SVG is not supported server-side."),
      scale: z
        .number()
        .optional()
        .describe(
          "Scale factor (default 1). Use 2 for a retina baseline. Values that push the target past 15000x15000 are rejected — lower this instead of guessing."
        ),
      outDir: z
        .string()
        .optional()
        .describe(
          "Output directory for the image files. Relative paths resolve against MG_OUTPUT_ROOT (default: current working directory). Omit to use the current working directory."
        ),
      format: formatField(),
    })
    .passthrough();

  async execute({
    fileId,
    layerId,
    shortLink,
    sourceLayerId,
    layerIds,
    imageFormat,
    scale,
    outDir,
    format,
  }: z.infer<typeof this.schema>) {
    const tool = RENDER_LAYERS_TOOL_NAME;
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

      // 一次性完成渲染 + 下载 + 落盘：
      // 服务端渲染产物落在**它自己的**容器内 os.tmpdir()，这里的 filePath 打不开；
      // 必须再走 GET /mcp/export-asset 把字节拉回来写成真实文件。
      // exportId === layerId 的约定让这一步可以直接复用既有的 downloadExportAsset。
      const rendered = await httpUtilInstance.renderLayers(finalFileId, effectiveLayerId, {
        layerIds,
        format: imageFormat === undefined ? undefined : FORMAT_TO_CODE[imageFormat],
        scale,
      });

      const assets: Array<{
        exportId: string;
        layerId: string;
        fileName: string;
        format: string;
        width?: number;
        height?: number;
        bytes: number;
        filePath: string;
      }> = [];
      const skipped: Array<{ layerId: string; reason: string }> = (rendered.skipped || []).map((s) => ({
        layerId: s.layerId,
        reason: s.reason,
      }));

      for (const item of rendered.assets || []) {
        try {
          const res = await httpUtilInstance.downloadExportAsset(
            finalFileId,
            effectiveLayerId,
            item.exportId
          );
          const targetDir = this.resolveOutDir(outDir);
          if (!existsSync(targetDir)) {
            await mkdir(targetDir, { recursive: true });
          }
          // 文件名用 layerId 派生（含冒号，必须消毒），扩展名按服务端回的 format。
          const ext = (item.format || "png").toLowerCase();
          const fileName = sanitizeFileName(`${item.layerId}.${ext}`, `${item.exportId}.${ext}`);
          const filePath = path.join(targetDir, fileName);
          await writeFile(filePath, res.data);
          assets.push({
            exportId: item.exportId,
            layerId: item.layerId,
            fileName,
            format: ext,
            width: item.width,
            height: item.height,
            bytes: res.data.length,
            filePath,
          });
        } catch (err: any) {
          skipped.push({
            layerId: item.layerId,
            reason:
              err?.response?.status === 404
                ? "render cache expired between render and download (server TTL ~5min); retry this tool"
                : err?.message || String(err),
          });
        }
      }

      const dir = this.resolveOutDir(outDir);

      if (assets.length === 0) {
        // 区分「这个 scope 里真没可渲的图层」与「渲染成功但下载全失败」：
        // 两种情况调用方的下一步动作完全不同（前者换 layerId，后者重试）。
        const reasons = skipped.map((s) => `${s.layerId}: ${s.reason}`).join(" | ");
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error:
                  "No layer image could be produced. " +
                  (reasons
                    ? `Per-target reasons: ${reasons}`
                    : "The renderer returned no asset and no reason — check that the layerId container really contains the requested layers."),
                fileId: finalFileId,
                layerId: effectiveLayerId,
                requestedLayerIds: layerIds,
                total: rendered.total,
                serverNote: rendered.note,
                skipped: rendered.skipped,
              }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: formatOutput(
              {
                success: true,
                fileId: finalFileId,
                layerId: effectiveLayerId,
                dir,
                total: rendered.total,
                assets,
                skipped,
                images: rendered.images,
                truncated: rendered.truncated,
                guidance:
                  "Layer snapshots written to disk. These are WYSIWYG canvas renders (effects, overflow, text included). " +
                  "Use filePath directly; do not paste base64 into the conversation.",
              },
              format
            ),
          },
        ],
      };
    } catch (error: unknown) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: formatToolError(error, tool) }],
      };
    }
  }

  /**
   * 解析输出目录，沿用 applyDesign / downloadExportAssets 的安全约束：
   * 相对路径解析到 MG_OUTPUT_ROOT（默认 cwd），且禁止越出该根目录。
   *
   * outDir 由 LLM 控制、而 LLM 输入本质来自用户消息 → 可被 prompt-injection 利用写任意路径。
   * 这里不能省：同 crate 的另外三处落盘点（apply-design / download-export-assets）
   * 都做了同样校验，少一处就是一个任意文件写入面。
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

/** 对外用可读枚举，对内（服务端 spec）用数字码：0 PNG / 1 JPG / 4 WEBP。 */
const FORMAT_TO_CODE: Record<string, number> = { PNG: 0, JPG: 1, WEBP: 4 };
