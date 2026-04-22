import { z } from "zod";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import axios from "axios";
import https from "https";
import { BaseTool } from "./base-tool";
import { httpUtilInstance } from "../utils/api";
import flutterComponentWorkflow from "../markdown/flutter-component-workflow.md";

const FLUTTER_GENERATOR_TOOL_NAME = "mcp__getFlutterGenerator";
const FLUTTER_GENERATOR_TOOL_DESCRIPTION = `
Users need to actively call this tool to get the Flutter component development workflow. When Flutter Generator or Flutter Component is mentioned, please actively call this tool.
This tool provides a structured workflow for Flutter component development following best practices.
It includes MasterGo DSL to Flutter Widget mapping rules, screen adaptation with flutter_screenutil, and feature-based architecture guidance.
It also downloads all image resources from the design file to local disk, rewrites CSS and DSL references to point at Flutter asset paths, and generates an asset manifest.
You must provide an absolute rootPath of workspace to save workflow files.
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AssetRecord {
  token: string;
  sourceUrl: string;
  localPath: string;
  flutterPath: string;
  format: string;
  status: "downloaded" | "skipped" | "failed";
  needsColorFilter?: boolean;
  error?: string;
}

interface AssetSummary {
  discovered: number;
  downloaded: number;
  skipped: number;
  failed: number;
  lost: number;
  byFormat: Record<string, number>;
}

interface FailedAsset {
  token: string;
  url: string;
  error: string;
}

interface LostImageRef {
  nodeId: string;
  token: string;
  rawCssFragment: string;
}

interface DiscoveredAsset {
  token: string;
  url: string;
  kind: "remote" | "data";
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DOWNLOAD_TIMEOUT = 15_000;
const MAX_RETRIES = 2;
const DOWNLOAD_CONCURRENCY = 6;

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "svg", "gif", "bmp"];

/** Relaxed HTTPS agent — handles self-signed / misconfigured TLS */
const relaxedAgent = new https.Agent({ rejectUnauthorized: false });

// ---------------------------------------------------------------------------
// String / path helpers
// ---------------------------------------------------------------------------

/** Sanitise a string for use as a file/directory name */
function safeName(raw: string): string {
  return String(raw ?? "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Short, stable hash for URL → filename deduping */
function shortHash(input: string): string {
  return crypto.createHash("md5").update(input).digest("hex").slice(0, 10);
}

/** Extract file extension from a URL path, or return undefined */
function extFromUrl(url: string): string | undefined {
  try {
    const pathname = new URL(url, "https://placeholder.local").pathname;
    const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
    if (match && IMAGE_EXTENSIONS.includes(match[1].toLowerCase())) {
      return match[1].toLowerCase();
    }
  } catch {
    // ignore
  }
  return undefined;
}

/** Infer extension from content-type header */
function extFromContentType(ct: string | undefined): string {
  if (!ct) return "png";
  const lower = ct.toLowerCase();
  if (lower.includes("svg")) return "svg";
  if (lower.includes("webp")) return "webp";
  if (lower.includes("jpeg") || lower.includes("jpg")) return "jpg";
  if (lower.includes("gif")) return "gif";
  if (lower.includes("bmp")) return "bmp";
  return "png";
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// URL classification
// ---------------------------------------------------------------------------

/** Check if a URL looks like it points to a downloadable image resource */
function looksLikeImageUrl(url: string): boolean {
  if (!url) return false;

  // Data URLs are always images when prefix matches
  if (url.startsWith("data:image/")) return true;

  // Protocol-relative → normalize for probing
  const probe = url.startsWith("//") ? `https:${url}` : url;
  if (!/^https?:\/\//i.test(probe)) return false;

  // Exclude obvious non-image URLs
  if (
    probe.includes("/api/") ||
    probe.includes("graphql") ||
    probe.endsWith(".json") ||
    probe.endsWith(".js") ||
    probe.endsWith(".css")
  ) {
    return false;
  }

  try {
    const pathname = new URL(probe).pathname.toLowerCase();
    if (IMAGE_EXTENSIONS.some((ext) => pathname.endsWith(`.${ext}`))) return true;
    if (
      pathname.includes("/image/") ||
      pathname.includes("/img/") ||
      pathname.includes("/picture/") ||
      probe.includes("x-oss-process=image") ||
      probe.includes("imageView") ||
      probe.includes("format,") ||
      pathname.includes("/thumbnail/")
    ) {
      return true;
    }
    if (probe.includes("mastergo") && (pathname.includes("/resource/") || pathname.includes("/file/"))) {
      return true;
    }
    if (probe.match(/[?&](w|width|h|height|resize|format)=/i)) {
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

async function downloadFile(url: string, destPath: string): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: DOWNLOAD_TIMEOUT,
        httpsAgent: relaxedAgent,
        maxRedirects: 5,
      });
      fs.writeFileSync(destPath, Buffer.from(resp.data));
      return;
    } catch (err: any) {
      lastError = err;

      // TLS fallback: https → http (some CDNs are misconfigured)
      const isWrongSsl =
        err?.code === "EPROTO" ||
        String(err?.message ?? "").includes("wrong version number");
      if (isWrongSsl && url.startsWith("https://")) {
        try {
          const httpUrl = url.replace(/^https:\/\//, "http://");
          const resp = await axios.get(httpUrl, {
            responseType: "arraybuffer",
            timeout: DOWNLOAD_TIMEOUT,
            maxRedirects: 5,
          });
          fs.writeFileSync(destPath, Buffer.from(resp.data));
          return;
        } catch (httpErr) {
          lastError = httpErr;
        }
      }

      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

async function persistDataUrl(dataUrl: string, destPath: string): Promise<string> {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Unsupported data URL format");
  const mime = match[1];
  const payload = match[2];
  const ext = extFromContentType(mime);
  const finalDest = destPath.endsWith(`.${ext}`) ? destPath : `${destPath}.${ext}`;
  fs.writeFileSync(finalDest, Buffer.from(payload, "base64"));
  return finalDest;
}

/**
 * Run async tasks with a fixed concurrency cap.
 * Preserves input order in the returned array.
 */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const pool = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  });

  await Promise.all(pool);
  return results;
}

// ---------------------------------------------------------------------------
// pubspec.yaml patching
// ---------------------------------------------------------------------------

/**
 * Ensure a Flutter asset directory is registered in pubspec.yaml while preserving
 * existing comments and key order. Uses textual patching rather than YAML parsing
 * because js-yaml strips comments on stringify.
 */
function ensurePubspecAsset(rootPath: string, assetDirRelative: string): "added" | "exists" | "no-pubspec" {
  const pubspecPath = path.join(rootPath, "pubspec.yaml");
  if (!fs.existsSync(pubspecPath)) return "no-pubspec";

  const content = fs.readFileSync(pubspecPath, "utf-8");
  const entryLine = `    - ${assetDirRelative}/`;

  // Already present (check the exact line to avoid a false positive on
  // `assets/image/foo/` matching `assets/image/foo_bar/` as substring)
  const linePresent = content
    .split(/\r?\n/)
    .some((line) => line.trimEnd() === entryLine.trimEnd());
  if (linePresent) return "exists";

  let next = content;

  // Prefer inserting into an existing `flutter:` → `assets:` block
  const flutterBlock = /^(flutter:[\s\S]*?)(?=^\S|\Z)/m.exec(content);
  if (flutterBlock) {
    const block = flutterBlock[0];
    const assetsMatch = /^(\s{2,})assets:\s*\n/m.exec(block);
    if (assetsMatch) {
      // Insert under existing assets list (after assets: marker)
      const insertAt = flutterBlock.index + assetsMatch.index + assetsMatch[0].length;
      next = content.slice(0, insertAt) + `${entryLine}\n` + content.slice(insertAt);
    } else {
      // flutter: exists but no assets: yet — append an assets block at end of flutter block
      const blockEnd = flutterBlock.index + block.length;
      const suffix =
        (block.endsWith("\n") ? "" : "\n") +
        `  assets:\n${entryLine}\n`;
      next = content.slice(0, blockEnd) + suffix + content.slice(blockEnd);
    }
  } else {
    // No flutter block at all
    const suffix =
      (content.endsWith("\n") ? "" : "\n") + `\nflutter:\n  assets:\n${entryLine}\n`;
    next = content + suffix;
  }

  fs.writeFileSync(pubspecPath, next);
  return "added";
}

/**
 * Resolve the Flutter asset subdirectory for resolution-aware PNGs (@2x/@3x).
 */
function resolveFlutterAssetSubdir(featureAssetDir: string, url: string, fileName: string): string {
  if (url.includes("@3x") || url.includes("_3x") || url.includes("/3.0x/")) {
    const dir = path.join(featureAssetDir, "3.0x");
    ensureDir(dir);
    return path.join(dir, fileName);
  }
  if (url.includes("@2x") || url.includes("_2x") || url.includes("/2.0x/")) {
    const dir = path.join(featureAssetDir, "2.0x");
    ensureDir(dir);
    return path.join(dir, fileName);
  }
  return path.join(featureAssetDir, fileName);
}

// ---------------------------------------------------------------------------
// DSL walking — image discovery
// ---------------------------------------------------------------------------

/**
 * Extract URLs embedded in a `cssCode` string, including:
 *  - `background-image: url(<url>)`
 *  - `background: ... url(<url>) ...`
 * Supports quoted and unquoted URL forms. Ignores the literal `[object Object]`
 * (which is an upstream serialisation bug — see `lostImageRefs`).
 */
function extractCssUrls(css: string): { urls: string[]; lostFragments: string[] } {
  const urls: string[] = [];
  const lostFragments: string[] = [];
  if (!css || typeof css !== "string") return { urls, lostFragments };

  // Match url( ... ) with optional quotes; capture inner content
  const re = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (!raw) continue;
    if (raw === "[object Object]" || raw.includes("[object Object]")) {
      lostFragments.push(m[0]);
      continue;
    }
    urls.push(raw);
  }
  return { urls, lostFragments };
}

/**
 * Recursively walk the DSL tree, collecting:
 *  - image URLs from generic string fields (legacy behaviour)
 *  - image URLs embedded in `cssCode`
 *  - image paints in `fills` / `strokes` / `backgrounds` arrays (defensive)
 *  - nodes whose cssCode references a lost (`[object Object]`) image
 */
function walkForAssets(
  node: any,
  prefix: string,
  discovered: Map<string, DiscoveredAsset>,
  lost: LostImageRef[]
): void {
  if (!node || typeof node !== "object") return;

  if (Array.isArray(node)) {
    node.forEach((item, idx) => walkForAssets(item, `${prefix}[${idx}]`, discovered, lost));
    return;
  }

  const nodeId = typeof node.id === "string" ? node.id : "";

  for (const [key, value] of Object.entries(node)) {
    const tokenPath = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "string") {
      if (key === "cssCode") {
        const { urls, lostFragments } = extractCssUrls(value);
        for (const url of urls) {
          const kind = url.startsWith("data:image/") ? "data" : "remote";
          const normalized = url.startsWith("//") ? `https:${url}` : url;
          if (kind === "data" || looksLikeImageUrl(normalized)) {
            if (!discovered.has(normalized)) {
              discovered.set(normalized, { token: tokenPath, url: normalized, kind });
            }
          }
        }
        for (const frag of lostFragments) {
          lost.push({ nodeId, token: tokenPath, rawCssFragment: frag });
        }
      } else if (value.startsWith("data:image/")) {
        if (!discovered.has(value)) {
          discovered.set(value, { token: tokenPath, url: value, kind: "data" });
        }
      } else if (value.startsWith("http") || value.startsWith("//")) {
        const normalized = value.startsWith("//") ? `https:${value}` : value;
        if (looksLikeImageUrl(normalized) && !discovered.has(normalized)) {
          discovered.set(normalized, { token: tokenPath, url: normalized, kind: "remote" });
        }
      }
    } else if (value && typeof value === "object") {
      walkForAssets(value, tokenPath, discovered, lost);
    }
  }
}

/**
 * Emit an SVG file for a vector layer, preserving individual path fills when
 * the layer is multi-colour. Returns metadata used to register the asset.
 */
function emitLayerSvg(
  layer: any,
  imageDir: string,
  featureAssetDir: string,
  assetDirRelative: string
): { flutterPath: string; needsColorFilter: boolean } | null {
  if (!Array.isArray(layer?.path) || layer.path.length === 0) return null;

  const id = safeName(String(layer.id ?? "icon"));
  const w = layer.width ?? 16;
  const h = layer.height ?? 16;
  const pathCount = layer.path.length;
  // single path = single color = safe to tint via colorFilter
  const needsColorFilter = pathCount === 1;

  const svgFileName = `${id}.svg`;
  const filePath = path.join(imageDir, svgFileName);

  if (!fs.existsSync(filePath)) {
    const pathElements = layer.path
      .map((d: string, i: number) => {
        let fill = "currentColor";
        if (!needsColorFilter) {
          const color = layer.fills?.[i]?.color ?? layer.strokes?.[i]?.color;
          if (color) {
            fill = `rgb(${Math.round((color.r ?? 0) * 255)},${Math.round(
              (color.g ?? 0) * 255
            )},${Math.round((color.b ?? 0) * 255)})`;
          }
        }
        return `  <path d="${d}" fill="${fill}"/>`;
      })
      .join("\n");
    fs.writeFileSync(
      filePath,
      `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">\n${pathElements}\n</svg>`
    );
  }

  const flutterSvgPath = path.join(featureAssetDir, svgFileName);
  if (!fs.existsSync(flutterSvgPath)) {
    fs.copyFileSync(filePath, flutterSvgPath);
  }

  return {
    flutterPath: `${assetDirRelative}/${svgFileName}`,
    needsColorFilter,
  };
}

function walkVectorLayers(
  layer: any,
  imageDir: string,
  featureAssetDir: string,
  assetDirRelative: string
): void {
  const result = emitLayerSvg(layer, imageDir, featureAssetDir, assetDirRelative);
  if (result) {
    layer.imageUrls = layer.imageUrls ?? [];
    layer.imageUrls.push(result);
    delete layer.path;
  }
  if (Array.isArray(layer?.children)) {
    layer.children.forEach((child: any) =>
      walkVectorLayers(child, imageDir, featureAssetDir, assetDirRelative)
    );
  }
}

// ---------------------------------------------------------------------------
// DSL rewrite — replace URLs with Flutter asset paths
// ---------------------------------------------------------------------------

/**
 * Walk the DSL object and rewrite URL occurrences (both plain string fields
 * and embedded `url(...)` tokens in `cssCode`) to Flutter asset paths.
 */
function rewriteDslUrls(node: any, urlMap: Map<string, string>): void {
  if (!node || typeof node !== "object") return;

  if (Array.isArray(node)) {
    node.forEach((item) => rewriteDslUrls(item, urlMap));
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    if (typeof value === "string") {
      if (key === "cssCode") {
        node[key] = value.replace(
          /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,
          (match, q1, q2, q3) => {
            const raw = (q1 ?? q2 ?? q3 ?? "").trim();
            const normalized = raw.startsWith("//") ? `https:${raw}` : raw;
            const replacement = urlMap.get(normalized) ?? urlMap.get(raw);
            return replacement ? `url(${replacement})` : match;
          }
        );
      } else {
        const normalized = value.startsWith("//") ? `https:${value}` : value;
        const replacement = urlMap.get(normalized) ?? urlMap.get(value);
        if (replacement) node[key] = replacement;
      }
    } else if (value && typeof value === "object") {
      rewriteDslUrls(value, urlMap);
    }
  }
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export class GetFlutterWorkflowTool extends BaseTool {
  name = FLUTTER_GENERATOR_TOOL_NAME;
  description = FLUTTER_GENERATOR_TOOL_DESCRIPTION;

  constructor() {
    super();
  }

  schema = z.object({
    rootPath: z
      .string()
      .describe(
        "The root path of the Flutter project, if the user does not provide, you can use the current directory as the root path"
      ),
    fileId: z
      .string()
      .describe("MasterGo design file ID (format: file/<fileId> in MasterGo URL)"),
    layerId: z
      .string()
      .describe(
        "Layer ID of the specific component or element to retrieve (format: ?layer_id=<layerId> / file=<fileId> in MasterGo URL)"
      ),
    featureName: z
      .string()
      .optional()
      .describe(
        "Optional feature directory name under assets/image/ and the Flutter feature module. Defaults to the root component name."
      ),
  });

  async execute({
    rootPath,
    fileId,
    layerId,
    featureName,
  }: z.infer<typeof this.schema>) {
    const warnings: string[] = [];
    const failedAssets: FailedAsset[] = [];
    const lostImageRefs: LostImageRef[] = [];

    // -----------------------------------------------------------------------
    // 1. Set up output directories
    // -----------------------------------------------------------------------
    const baseDir = path.resolve(rootPath, ".mastergo");
    const imageDir = path.join(baseDir, "images");
    ensureDir(baseDir);
    ensureDir(imageDir);

    // -----------------------------------------------------------------------
    // 2. Fetch DSL data from MasterGo
    // -----------------------------------------------------------------------
    const jsonData = await httpUtilInstance.getComponentStyleJson(fileId, layerId);
    const rootNode = jsonData?.[0] ?? {};
    const componentName = rootNode.name ?? "component";

    const explicitFeature = featureName ? safeName(featureName) : "";
    const componentDirName =
      explicitFeature || safeName(componentName) || safeName(layerId) || "component";

    const componentJsonPath = path.join(baseDir, `${componentDirName}.json`);

    const assetDirRelative = `assets/image/${componentDirName}`;
    const featureAssetDir = path.join(rootPath, assetDirRelative);
    ensureDir(featureAssetDir);

    // -----------------------------------------------------------------------
    // 3. Extract vector (SVG path) layers into on-disk SVGs
    // -----------------------------------------------------------------------
    walkVectorLayers(rootNode, imageDir, featureAssetDir, assetDirRelative);

    // -----------------------------------------------------------------------
    // 4. Discover image assets (URLs + data URLs + lost refs)
    // -----------------------------------------------------------------------
    const discoveredMap = new Map<string, DiscoveredAsset>();
    walkForAssets(rootNode, "", discoveredMap, lostImageRefs);
    const discoveredAssets = Array.from(discoveredMap.values());

    // -----------------------------------------------------------------------
    // 5. Download / persist assets with bounded concurrency
    // -----------------------------------------------------------------------
    const summary: AssetSummary = {
      discovered: discoveredAssets.length,
      downloaded: 0,
      skipped: 0,
      failed: 0,
      lost: lostImageRefs.length,
      byFormat: {},
    };

    const processAsset = async (asset: DiscoveredAsset): Promise<AssetRecord> => {
      const hash = shortHash(asset.url);
      let ext = extFromUrl(asset.url);
      const safeToken = safeName(asset.token.replace(/:/g, "_")) || "asset";
      const baseFileName = `${safeToken}_${hash}`;

      try {
        // Data URLs — persist locally, no HTTP
        if (asset.kind === "data") {
          const ct = asset.url.match(/^data:([^;]+);base64,/)?.[1];
          ext = extFromContentType(ct);
          const fileName = `${baseFileName}.${ext}`;
          const localPath = path.join(imageDir, fileName);
          if (!fs.existsSync(localPath)) {
            await persistDataUrl(asset.url, path.join(imageDir, baseFileName));
          }
          const flutterAssetPath = resolveFlutterAssetSubdir(featureAssetDir, asset.url, fileName);
          if (!fs.existsSync(flutterAssetPath)) fs.copyFileSync(localPath, flutterAssetPath);
          summary.downloaded++;
          summary.byFormat[ext] = (summary.byFormat[ext] ?? 0) + 1;
          return {
            token: asset.token,
            sourceUrl: asset.url,
            localPath,
            flutterPath: `${assetDirRelative}/${fileName}`,
            format: ext,
            status: "downloaded",
          };
        }

        // Remote URL — resolve extension (HEAD fallback) then download
        if (!ext) {
          try {
            const head = await axios.head(asset.url, {
              timeout: 5000,
              httpsAgent: relaxedAgent,
              maxRedirects: 5,
            });
            ext = extFromContentType(head.headers["content-type"]);
          } catch {
            ext = "png";
          }
        }

        const fileName = `${baseFileName}.${ext}`;
        const localPath = path.join(imageDir, fileName);

        if (fs.existsSync(localPath)) {
          const flutterAssetPath = resolveFlutterAssetSubdir(featureAssetDir, asset.url, fileName);
          if (!fs.existsSync(flutterAssetPath)) fs.copyFileSync(localPath, flutterAssetPath);
          summary.skipped++;
          summary.byFormat[ext] = (summary.byFormat[ext] ?? 0) + 1;
          return {
            token: asset.token,
            sourceUrl: asset.url,
            localPath,
            flutterPath: `${assetDirRelative}/${fileName}`,
            format: ext,
            status: "skipped",
          };
        }

        await downloadFile(asset.url, localPath);
        const flutterAssetPath = resolveFlutterAssetSubdir(featureAssetDir, asset.url, fileName);
        fs.copyFileSync(localPath, flutterAssetPath);

        summary.downloaded++;
        summary.byFormat[ext] = (summary.byFormat[ext] ?? 0) + 1;
        return {
          token: asset.token,
          sourceUrl: asset.url,
          localPath,
          flutterPath: `${assetDirRelative}/${fileName}`,
          format: ext,
          status: "downloaded",
        };
      } catch (err: any) {
        const errorMsg = err?.message ?? String(err);
        summary.failed++;
        failedAssets.push({ token: asset.token, url: asset.url, error: errorMsg });
        warnings.push(`Failed to download ${asset.token}: ${errorMsg}`);
        return {
          token: asset.token,
          sourceUrl: asset.url,
          localPath: "",
          flutterPath: "",
          format: ext ?? "unknown",
          status: "failed",
          error: errorMsg,
        };
      }
    };

    const assetRecords = await runWithConcurrency(
      discoveredAssets,
      DOWNLOAD_CONCURRENCY,
      processAsset
    );

    // -----------------------------------------------------------------------
    // 6. Register asset directory in pubspec.yaml
    // -----------------------------------------------------------------------
    const pubspecResult = ensurePubspecAsset(rootPath, assetDirRelative);
    if (pubspecResult === "no-pubspec") {
      warnings.push(
        "pubspec.yaml not found — asset directory was NOT registered. Add it manually."
      );
    }

    // -----------------------------------------------------------------------
    // 7. Rewrite DSL — replace remote URLs with Flutter asset paths
    // -----------------------------------------------------------------------
    const urlMap = new Map<string, string>();
    for (const r of assetRecords) {
      if (r.status !== "failed" && r.flutterPath) {
        urlMap.set(r.sourceUrl, r.flutterPath);
      }
    }
    rewriteDslUrls(rootNode, urlMap);

    // -----------------------------------------------------------------------
    // 8. Write output files
    // -----------------------------------------------------------------------
    fs.writeFileSync(componentJsonPath, JSON.stringify(rootNode, null, 2));

    const workflowFilePath = path.join(baseDir, "flutter-component-workflow.md");
    if (!fs.existsSync(workflowFilePath)) {
      fs.writeFileSync(workflowFilePath, flutterComponentWorkflow);
    }

    const manifestPath = path.join(baseDir, "assets-manifest.json");
    const manifest = {
      fileId,
      layerId,
      featureName: componentDirName,
      generatedAt: new Date().toISOString(),
      summary,
      assets: assetRecords.map((r) => ({
        token: r.token,
        sourceUrl: r.sourceUrl,
        localPath: r.localPath,
        flutterPath: r.flutterPath,
        format: r.format,
        status: r.status,
        ...(r.needsColorFilter !== undefined ? { needsColorFilter: r.needsColorFilter } : {}),
        ...(r.error ? { error: r.error } : {}),
      })),
      lostImageRefs,
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    // -----------------------------------------------------------------------
    // 9. Return result to caller
    // -----------------------------------------------------------------------
    const assetRulePath = assetDirRelative;
    const lostMsg =
      lostImageRefs.length > 0
        ? `WARNING: ${lostImageRefs.length} image references were LOST by the MasterGo upstream (cssCode contains url([object Object])). These cannot be recovered from the style API. Affected node IDs: ${Array.from(
            new Set(lostImageRefs.map((l) => l.nodeId))
          )
            .slice(0, 20)
            .join(", ")}${
            lostImageRefs.length > 20 ? " …" : ""
          }. Use placeholder widgets (Container with grey background + Icon) or ask the user to re-export via mcp__getD2c for those nodes.`
        : null;

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            files: {
              workflow: workflowFilePath,
              componentSpec: componentJsonPath,
              assetDir: imageDir,
              flutterAssetDir: featureAssetDir,
              assetManifest: manifestPath,
            },
            assetSummary: summary,
            failedAssets,
            lostImageRefs: lostImageRefs.slice(0, 50),
            warnings,
            message: `Flutter component files created. ${summary.downloaded} downloaded, ${summary.skipped} skipped, ${summary.failed} failed, ${summary.lost} lost upstream. Assets copied to ${assetDirRelative}/${
              pubspecResult === "added"
                ? " and registered in pubspec.yaml."
                : pubspecResult === "exists"
                ? "; pubspec entry already present."
                : "; pubspec.yaml NOT updated (file missing)."
            }`,
            rules: [
              `Follow the Flutter component workflow process defined in file://${workflowFilePath} for structured Flutter development. This workflow contains DSL-to-Flutter mapping rules, you'll need to read it carefully.`,
              `Implement the Flutter widget according to the specifications in file://${componentJsonPath}, ensuring all properties and states are properly handled.`,
              `All image URLs in the component spec have been replaced with Flutter asset paths under ${assetRulePath}/. Use Image.asset()/SvgPicture.asset() with these paths directly.`,
              `SVG icons with needsColorFilter=true should use SvgPicture.asset with ColorFilter.mode(..., BlendMode.srcIn); those with needsColorFilter=false should render without color override.`,
              `An asset manifest is available at file://${manifestPath} listing every resource and its status (downloaded/skipped/failed/lost).`,
              `Use flutter_screenutil for screen adaptation: width/height/padding/margin/radius use .w; font sizes use .sp.`,
              `Use standard Flutter Color(0xFFxxxxxx) for colors. Do NOT create custom color utility classes.`,
              ...(failedAssets.length > 0
                ? [
                    `WARNING: ${failedAssets.length} assets failed to download. See failedAssets for details; substitute placeholders.`,
                  ]
                : []),
              ...(lostMsg ? [lostMsg] : []),
            ],
          }),
        },
      ],
    };
  }
}
