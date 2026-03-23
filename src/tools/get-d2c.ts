import { z } from "zod";
import { BaseTool } from "./base-tool";
import { httpUtilInstance } from "../utils/api";
import axios from "axios";
import path from "path";
import { existsSync, mkdirSync } from "fs";
import { writeFile } from "fs/promises";

const D2C_TOOL_NAME = "mcp__getD2c";
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

async function writeResource(
  resData: any,
  targetDir: string,
  folderName: string,
  ext: string
): Promise<WriteResourceResult> {
  if (isEmpty(resData)) return { savedCount: 0, attemptedCount: 0, errorCount: 0 };

  let parsed: any;
  try {
    parsed = typeof resData === "string" ? JSON.parse(resData) : resData;
  } catch {
    return { savedCount: 0, attemptedCount: 0, errorCount: 1 };
  }

  if (!parsed || typeof parsed !== "object") {
    return { savedCount: 0, attemptedCount: 0, errorCount: 1 };
  }

  const keys = Object.keys(parsed);
  if (keys.length === 0) {
    return { savedCount: 0, attemptedCount: 0, errorCount: 0 };
  }

  const resDir = path.join(targetDir, folderName);
  if (!existsSync(resDir)) mkdirSync(resDir, { recursive: true });

  let successCount = 0;
  let errorCount = 0;

  await Promise.all(
    Object.entries(parsed).map(async ([key, value]) => {
      const match = String(key).match(/(.+)\.([a-zA-Z0-9]+)$/);
      const safeKey = (match ? match[1] : key).replace(/[^a-zA-Z0-9_-]/g, "_");
      const finalExt = match ? match[2] : ext;
      const filePath = path.join(resDir, `${safeKey}.${finalExt}`);

      const content = value as any;

      try {
        if (typeof content === "string" && content.startsWith("http")) {
          try {
            const response = await axios.get(content, {
              responseType: "arraybuffer",
              timeout: 30000,
            });
            await writeFile(filePath, response.data);
            successCount += 1;
            return;
          } catch (err: any) {
            const isWrongSsl =
              err?.code === "EPROTO" ||
              String(err?.message ?? "").includes("wrong version number");

            // 有些资源链接会误把 http 服务包装成 https，导致 EPROTO：
            // 尝试回退到 http 再请求一次。
            if (isWrongSsl && content.startsWith("https://")) {
              const httpUrl = content.replace(/^https:\/\//, "http://");
              const response = await axios.get(httpUrl, {
                responseType: "arraybuffer",
                timeout: 30000,
              });
              await writeFile(filePath, response.data);
              successCount += 1;
              return;
            }

            errorCount += 1;
            return;
          }
        }

        if (typeof content === "string" && content.startsWith("data:image/")) {
          const parts = content.split(";base64,");
          if (parts.length === 2) {
            await writeFile(filePath, parts[1], "base64");
            successCount += 1;
          }
          return;
        }

        const dataToWrite =
          typeof content === "object" ? JSON.stringify(content, null, 2) : String(content ?? "");
        const encoding: BufferEncoding =
          finalExt === "png" || finalExt === "jpg" || finalExt === "jpeg" ? "base64" : "utf8";
        await writeFile(filePath, dataToWrite, encoding);
        successCount += 1;
      } catch {
        errorCount += 1;
        return;
      }
    })
  );

  return { savedCount: successCount, attemptedCount: keys.length, errorCount };
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

  if (!isEmpty(code)) {
    await writeFile(htmlPath, code, "utf8");
  }

  const resPathMap = parseResourcePath(resourcePath);

  // 即使资源为空，也确保目录按 resourcePath 规划创建出来，便于后续排查
  const ensureResDir = (folderName: string) => {
    const dirPath = path.join(targetDir, folderName);
    if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
  };
  ensureResDir(resPathMap.image);
  ensureResDir(resPathMap.svg);


  const [svgWrite, imageWrite] = await Promise.all([
    writeResource(svg, targetDir, resPathMap.svg, "svg"),
    writeResource(image, targetDir, resPathMap.image, "png"),
  ]);

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
  name = D2C_TOOL_NAME;
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

      await saveCodeAndResources({
        outDir,
        contentId: finalContentId,
        code: payloadExtracted.code,
        resourcePath: payloadExtracted.resourcePath,
        svg: payloadExtracted.svg,
        image: payloadExtracted.image,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(d2c),
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