import { z } from "zod";
import { BaseTool } from "./base-tool";
import { httpUtilInstance } from "../utils/api";
import axios from "axios";
import path from "path";
import { existsSync, mkdirSync } from "fs";
import { writeFile } from "fs/promises";
import { toolName } from "../utils/tool-prefix";

const D2C_TOOL_DESCRIPTION = `
使用此工具从 MasterGo 获取 D2C 数据，并在本地落盘：
1）将返回的 code 写入 html；
2）将返回的 svg / image 资源按 resourcePath 落盘到对应目录；
3）返回落盘摘要，避免把大体积资源塞进上下文。
`;

type ResourcePathMap = Record<"image" | "svg", string>;

type SaveResult = {
  targetDir: string;
  htmlFileName: string;
  htmlPath: string;
  svgCount: number;
  imageCount: number;
  resourcePathMap: ResourcePathMap;
};

type WriteResourceResult = {
  savedCount: number;
  attemptedCount: number;
  errorCount: number;
  /** 原始资源 key -> 最终落盘文件名（相对资源目录），用于同步重写 HTML 中的引用。 */
  fileNameMap: Record<string, string>;
};

function isEmpty(value: any): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function hasContent(value: any): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return false;
}

function pickFirstWithContent(values: any[]): any {
  for (const v of values) {
    if (hasContent(v)) return v;
  }
  return undefined;
}

function parseResourcePath(resourcePath: any): ResourcePathMap {
  const map: ResourcePathMap = {
    image: "asset/images",
    svg: "asset/icons",
  };
  if (!isEmpty(resourcePath)) {
    try {
      const parsed = typeof resourcePath === "string" ? JSON.parse(resourcePath) : resourcePath;
      if (parsed.image) {
        map.image = String(parsed.image)
          .replace(/^(\.\/|\/)/, "")
          .replace(/\/+$/, "");
      }
      if (parsed.svg) {
        map.svg = String(parsed.svg).replace(/^(\.\/|\/)/, "").replace(/\/+$/, "");
      }
    } catch {
      return map;
    }
  }
  return map;
}

const IMAGE_MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpg": "jpg",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "image/x-icon": "ico",
};

export function extFromMime(mime: string): string | undefined {
  const normalized = String(mime).toLowerCase().split(";")[0].trim();
  return IMAGE_MIME_EXT[normalized];
}

export function decodeDataUrl(dataUrl: string): { data: Buffer; ext?: string } | undefined {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) return undefined;
  const ext = match[1] ? extFromMime(match[1]) : undefined;
  const isBase64 = Boolean(match[2]);
  const data = isBase64
    ? Buffer.from(match[3], "base64")
    : Buffer.from(decodeURIComponent(match[3]), "utf8");
  return { data, ext };
}

/**
 * 把资源 key 清洗成可落盘文件名：
 * - 保留中文等非 ASCII 字符（此前的 [^a-zA-Z0-9_-] 过滤会把中文全部替换成下划线，
 *   导致落盘文件名与 HTML 引用不一致）；
 * - 仅剔除路径分隔符与 `.`/`..`，避免目录穿越。
 */
export function sanitizeResourceKey(key: string): string {
  return String(key)
    .replace(/\\/g, "/")
    .split("/")
    .filter((seg) => seg.length > 0 && seg !== "." && seg !== "..")
    .join("/");
}

export function splitResourceKey(key: string): { stem: string; ext?: string } {
  const match = String(key).match(/^(.+)\.([a-zA-Z0-9]+)$/);
  if (!match) return { stem: String(key) };
  return { stem: match[1], ext: match[2].toLowerCase() };
}

/**
 * 重写 HTML/code 中指定资源名的引用。使用前后边界检查，避免
 * `a.jpg` 误伤 `ba.jpg`；保留目录前缀，只替换 key 本身。
 */
export function replaceResourceRef(code: string, originalKey: string, finalName: string): string {
  if (originalKey === finalName) return code;
  const escaped = originalKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, "g");
  return code.replace(pattern, () => finalName);
}

export function detectImageExt(buffer: Buffer): string | undefined {
  if (!buffer || buffer.length < 4) return undefined;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "png";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpg";
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return "gif";
  }
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "webp";
  }
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return "bmp";
  }
  const head = buffer.slice(0, 512).toString("latin1").toLowerCase();
  if (head.includes("<svg") || head.startsWith("<?xml")) {
    return "svg";
  }
  return undefined;
}

function pickStringFromObject(value: any): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  for (const key of ["url", "src", "href", "data", "content", "base64", "value"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) return candidate;
  }
  return undefined;
}

async function downloadHttpResource(url: string): Promise<{ data: Buffer; ext?: string }> {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 30000,
  });
  const data = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data);
  const headerExt = extFromMime(String(response.headers?.["content-type"] ?? ""));
  return { data, ext: headerExt ?? detectImageExt(data) };
}

async function resolveResourceContent(
  content: any,
  extHint: string
): Promise<{ data: Buffer; ext?: string } | undefined> {
  if (typeof content === "string") {
    if (/^https?:\/\//i.test(content)) {
      try {
        return await downloadHttpResource(content);
      } catch (err: any) {
        const isWrongSsl =
          err?.code === "EPROTO" || String(err?.message ?? "").includes("wrong version number");

        // 有些资源链接会误把 http 服务包装成 https，导致 EPROTO：
        // 尝试回退到 http 再请求一次。
        if (isWrongSsl && content.startsWith("https://")) {
          return await downloadHttpResource(content.replace(/^https:\/\//, "http://"));
        }

        throw err;
      }
    }

    if (content.startsWith("data:")) {
      return decodeDataUrl(content);
    }

    if (extHint === "svg" || /^\s*<svg[\s>]/i.test(content) || /^\s*<\?xml/i.test(content)) {
      return { data: Buffer.from(content, "utf8"), ext: "svg" };
    }

    // 裸 base64 图片：先嗅探真实字节格式，避免把 png 字节存成 jpg 文件。
    const buffer = Buffer.from(content, "base64");
    return { data: buffer, ext: detectImageExt(buffer) };
  }

  if (typeof content === "object" && content !== null) {
    const nested = pickStringFromObject(content);
    if (nested) return resolveResourceContent(nested, extHint);
  }

  return undefined;
}

async function writeResource(
  resData: any,
  targetDir: string,
  folderName: string,
  extHint: string
): Promise<WriteResourceResult> {
  const emptyResult: WriteResourceResult = {
    savedCount: 0,
    attemptedCount: 0,
    errorCount: 0,
    fileNameMap: {},
  };
  if (isEmpty(resData)) return emptyResult;

  let parsed: any;
  try {
    parsed = typeof resData === "string" ? JSON.parse(resData) : resData;
  } catch {
    return { ...emptyResult, errorCount: 1 };
  }

  if (!parsed || typeof parsed !== "object") {
    return { ...emptyResult, errorCount: 1 };
  }

  const keys = Object.keys(parsed);
  if (keys.length === 0) {
    return emptyResult;
  }

  const resDir = path.join(targetDir, folderName);
  if (!existsSync(resDir)) mkdirSync(resDir, { recursive: true });

  const fileNameMap: Record<string, string> = {};
  let successCount = 0;
  let errorCount = 0;
  let attemptedCount = 0;

  await Promise.all(
    Object.entries(parsed).map(async ([key, value]) => {
      attemptedCount += 1;
      const originalKey = String(key);
      const safeKey = sanitizeResourceKey(originalKey);
      if (!safeKey) {
        errorCount += 1;
        return;
      }

      try {
        const outcome = await resolveResourceContent(value, extHint);
        if (!outcome) {
          errorCount += 1;
          return;
        }

        const { stem, ext: keyExt } = splitResourceKey(safeKey);
        const finalExt = outcome.ext ?? keyExt ?? extHint;
        const finalName = `${stem}.${finalExt}`;
        const filePath = path.join(resDir, finalName);

        if (finalName.includes("/")) {
          mkdirSync(path.dirname(filePath), { recursive: true });
        }

        await writeFile(filePath, outcome.data);
        fileNameMap[originalKey] = finalName;
        successCount += 1;
      } catch {
        errorCount += 1;
      }
    })
  );

  return { savedCount: successCount, attemptedCount, errorCount, fileNameMap };
}

async function saveCodeAndResources(params: {
  outDir?: string;
  contentId: string;
  code: string;
  resourcePath?: any;
  svg?: any;
  image?: any;
}): Promise<SaveResult> {
  const { outDir, contentId, code, resourcePath, svg, image } = params;

  const targetDir = outDir
    ? path.isAbsolute(outDir)
      ? path.join(outDir)
      : path.join(process.cwd(), outDir)
    : process.cwd();

  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

  const htmlFileName = `${contentId || "index"}.html`;
  const htmlPath = path.join(targetDir, htmlFileName);

  const resPathMap = parseResourcePath(resourcePath);

  // 即使资源为空，也确保目录按 resourcePath 规划创建出来，便于后续排查
  const ensureResDir = (folderName: string) => {
    const dirPath = path.join(targetDir, folderName);
    if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
  };
  ensureResDir(resPathMap.image);
  ensureResDir(resPathMap.svg);

  // 先落盘资源，拿到「原始 key -> 最终文件名」映射，再据此重写 HTML 引用；
  // 否则 HTML 里的中文文件名和实际落盘的下划线文件名会对不上。
  const [svgWrite, imageWrite] = await Promise.all([
    writeResource(svg, targetDir, resPathMap.svg, "svg"),
    writeResource(image, targetDir, resPathMap.image, "png"),
  ]);

  let finalCode = code;
  const rewriteRefs = (fileNameMap: Record<string, string>) => {
    for (const [originalKey, fileName] of Object.entries(fileNameMap)) {
      finalCode = replaceResourceRef(finalCode, originalKey, fileName);
    }
  };
  rewriteRefs(imageWrite.fileNameMap);
  rewriteRefs(svgWrite.fileNameMap);

  if (!isEmpty(finalCode)) {
    await writeFile(htmlPath, finalCode, "utf8");
  }

  return {
    targetDir,
    htmlFileName,
    htmlPath,
    svgCount: svgWrite.savedCount,
    imageCount: imageWrite.savedCount,
    resourcePathMap: resPathMap,
  };
}

function extractPayload(d2c: any): {
  contentId: string;
  frameType?: string;
  code: string;
  resourcePath?: any;
  shape?: any;
  svg?: any;
  image?: any;
} {
  const data = d2c?.data;
  const firstItem = Array.isArray(data) ? data[0] : undefined;

  const payload =
    firstItem?.payload ??
    d2c?.payload ??
    d2c?.data?.payload ??
    firstItem?.payload?.payload ??
    data?.payload ??
    {};

  const codeCandidate =
    payload?.code ?? payload?.html ?? payload?.content ?? d2c?.code ?? "";

  const resourcePath = pickFirstWithContent([
    payload?.resourcePath,
    d2c?.resourcePath,
    firstItem?.resourcePath,
  ]);

  const image = pickFirstWithContent([payload?.image, firstItem?.image]);
  const svg = pickFirstWithContent([payload?.svg, firstItem?.svg]);
  const shape = pickFirstWithContent([payload?.shape, firstItem?.shape]);

  return {
    contentId: String(firstItem?.contentId ?? payload?.contentId ?? d2c?.contentId ?? ""),
    frameType: payload?.frameType ?? firstItem?.frameType ?? d2c?.frameType,
    code: String(codeCandidate ?? ""),
    resourcePath,
    shape,
    svg,
    image,
  };
}

export class GetD2cTool extends BaseTool {
  get name() {
    return toolName("getD2c");
  }
  description = D2C_TOOL_DESCRIPTION;

  constructor() {
    super();
  }

  schema = z.object({
    contentId: z
      .string()
      .describe(
        "MasterGo D2C contentId，例如 mastergo://getd2c/176452330285910-2-2845 中的 176452330285910-2-2845。"
      ),
    documentId: z
      .string()
      .describe(
        "MasterGo 文档 ID，通常为 contentId 的第一段，例如 contentId 为 176452330285910-2-9032 时 documentId 为 176452330285910。"
      ),
    outDir: z
      .string()
      .optional()
      .describe("可选，输出目录（绝对路径或相对当前工作目录）。"),
  });

  async execute({
    contentId,
    documentId,
    outDir,
  }: z.infer<typeof this.schema>) {
    try {
      if (!contentId) throw new Error("contentId 不能为空");
      if (!documentId) throw new Error("documentId 不能为空");

      const d2c = await httpUtilInstance.getD2c(contentId, documentId);

      const payloadExtracted = extractPayload(d2c);
      const finalContentId = payloadExtracted.contentId || contentId;

      const saveResult = await saveCodeAndResources({
        outDir,
        contentId: finalContentId,
        code: payloadExtracted.code,
        resourcePath: payloadExtracted.resourcePath,
        svg: payloadExtracted.svg,
        image: payloadExtracted.image,
      });

      // 资源已落盘，仅回传摘要给 LLM，避免把大体积 code/svg/image 数据塞进上下文。
      // 完整 d2c 响应体积可达数百 KB（含 base64 图片、svg 字符串、html 代码），
      // 全量回传会导致 LLM 上下文爆炸。
      const summary = {
        contentId: finalContentId,
        documentId,
        frameType: payloadExtracted.frameType,
        targetDir: saveResult.targetDir,
        htmlFileName: saveResult.htmlFileName,
        htmlPath: saveResult.htmlPath,
        resourcePathMap: saveResult.resourcePathMap,
        savedFiles: {
          svg: saveResult.svgCount,
          image: saveResult.imageCount,
        },
        message: `D2C 资源已落盘到 ${saveResult.htmlPath}。HTML 文件名：${saveResult.htmlFileName}。SVG 资源 ${saveResult.svgCount} 个，图片资源 ${saveResult.imageCount} 个。可直接打开 html 文件查看效果。`,
      };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(summary),
          },
        ],
      };
    } catch (error: any) {
      const errorMessage = error?.response?.data ?? error?.message;
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