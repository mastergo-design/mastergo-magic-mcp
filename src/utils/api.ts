import axios, { AxiosRequestConfig } from "axios";
import { parseToken, parseUrl, parseRules, parseNoRule, parseProxy, getEffectiveHeaders } from "./args";
import https from "https";
import { HttpsProxyAgent } from "https-proxy-agent";

// Configure proxy from --proxy arg or HTTP_PROXY/HTTPS_PROXY env vars
const proxyUrl =
  parseProxy() ||
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy;

if (proxyUrl) {
  try {
    const proxyAgent = new HttpsProxyAgent(proxyUrl, {
      rejectUnauthorized: false,
    });
    axios.defaults.httpAgent = proxyAgent;
    axios.defaults.httpsAgent = proxyAgent;
    // Disable axios built-in proxy to avoid double-proxying via proxy-from-env
    axios.defaults.proxy = false;
  } catch {
    throw new Error(`Invalid proxy URL: ${proxyUrl}`);
  }
} else {
  axios.defaults.httpsAgent = new https.Agent({
    rejectUnauthorized: false,
  });
}

// DSL response interface
export interface DslResponse {
  [key: string]: any;
}

// Code generation response interface
export interface CodeResponse {
  code: string;
  [key: string]: any;
}

// Memoized: the header set is fixed at process boot (token env/argv + MG_EXTRA_HEADERS),
// and this is called on every HTTP request. Callers spread the result into a new object,
// so returning the shared cached reference is safe from mutation.
let _commonHeaderCache: Record<string, string> | null = null;
const getCommonHeader = (): Record<string, string> => {
  if (_commonHeaderCache) return _commonHeaderCache;
  _commonHeaderCache = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-MG-UserAccessToken":
      process.env.MG_MCP_TOKEN || process.env.MASTERGO_API_TOKEN || parseToken(),
    ...getEffectiveHeaders(),
  };
  return _commonHeaderCache;
};

// Memoized: the base URL is fixed at process boot (API_BASE_URL env / --url argv)
// and this is called on every HTTP request. A parse failure is NOT cached, so the
// next call re-evaluates (and re-throws) — caching an error would make a bad state
// permanent.
let _baseUrlCache: string | null = null;
const getBaseUrl = (): string => {
  if (_baseUrlCache !== null) return _baseUrlCache;
  const url = process.env.API_BASE_URL || parseUrl();
  try {
    // 解析URL
    const urlObj = new URL(url);

    // 提取域名和协议
    const protocol = urlObj.protocol;
    const hostname = urlObj.hostname;
    const port = urlObj.port;

    // 构建基础URL
    let baseUrl = `${protocol}//${hostname}`;
    if (port) {
      baseUrl += `:${port}`;
    }

    _baseUrlCache = baseUrl;
    return _baseUrlCache;
  } catch {
    throw new Error(
      `无效的URL格式: ${url}。请提供正确的URL格式，例如: https://mastergo.com`
    );
  }
};

// Compare only the host (hostname + port) of two URLs, ignoring protocol/path.
// Returns false on any parse error rather than throwing. Exported for unit tests.
// SECURITY: this gates whether a user/LLM-supplied shortLink may receive our
// credentials — a wrong `true` here leaks X-MG-UserAccessToken (and custom gateway
// auth) to an attacker-controlled host.
export const isSameHost = (a: string, b: string): boolean => {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
};

const extractComponentDocumentLinks = (dsl: DslResponse): string[] => {
  const documentLinks = new Set<string>();

  const traverse = (node: any) => {
    if (node?.componentInfo?.componentSetDocumentLink?.[0]) {
      documentLinks.add(node.componentInfo.componentSetDocumentLink[0]);
    }
    node.children?.forEach?.(traverse);
  };

  dsl.nodes?.forEach(traverse);
  return Array.from(documentLinks);
};

const buildDslRules = (): string[] => {
  return [
    "CRITICAL — Page positioning: the section LIST response contains splitContainers with page-absolute coordinates for each page region. Use splitContainers to construct the page skeleton (position:absolute with exact coordinates). Do NOT guess or stack with flex.",
    "CRITICAL — Sidebar columns: render ALL sidebar levels as persistent columns at splitContainers positions. Do NOT hide or toggle them.",
    "token filed must be generated as a variable (colors, shadows, fonts, etc.) and the token field must be displayed in the comment",
    "componentDocumentLinks is a list of frontend component documentation links. When it exists and is not empty, use mcp__getComponentLink to get the documentation.",
    "",
    "CRITICAL — SVG FROM PATH NODES: Every PATH node has a `svgKey` field. The SVG markup is NOT in the DSL. Place `@@SVG:{svgKey}@@` where each icon goes, then call `mcp__applyDesign` to inject real SVG. NEVER hand-write `<path d=\"...\">`.",
    "CRITICAL — RENDER EVERY PATH NODE ICON: do NOT skip any PATH node. Each PATH node must have a `@@SVG:{svgKey}@@` placeholder in your code. Table headers have sort/filter/search icons, sidebar menu items have PATH icons, pagination has prev/next/refresh/dropdown icons. A header cell with only plain text is a fidelity defect. After all placeholders are placed, call `mcp__applyDesign`.",
    "",
    "CRITICAL — OMIT _placeholder TEXT: any TEXT node with `_placeholder: true` is component-library boilerplate — the node name equals its text content (e.g. name=\"Hillstone Design\" and text=\"Hillstone Design\"). These appear in rowTexts[] with `_placeholder: true` — skip them. allTexts does NOT include placeholder strings. EXCEPTION: if _placeholder TEXT is the ONLY text in its section, it may be real content with an auto-generated name — evaluate carefully.",
    "CRITICAL — CLOSED-SET TEXT: the section LIST response carries `rootMetadata.allTexts` — the complete whitelist of real text strings in this design. Any visible string NOT in allTexts is either placeholder (omit) or hallucination (delete). allTexts EXCLUDES _placeholder boilerplate.",
    "",
    "CRITICAL — INSTANCE fill color: when an INSTANCE has both `fill` and `_color`, use `_color` directly as the CSS value. Do NOT guess colors from _variantProps semantics.",
    "CRITICAL — INSTANCE _variantProps: compare across siblings for selected/hovered/disabled. Active class MUST match DSL variant state, NOT a default index.",
    "CRITICAL — Render count = structureSiblingCount: if ssc=1, that single instance IS complete — do NOT fabricate extra rows/items.",
    "CRITICAL — BACKGROUND FROM splitContainers: splitContainers[].background IS the exact CSS background-color. Copy verbatim, no changes.",
    "CRITICAL — FRAME/GROUP opacity: translate to rgba() on background only, NOT CSS opacity (would make children translucent).",
    "CRITICAL — rowTexts: each entry has parentType/parentName for context and `_placeholder: true` if boilerplate. Use parentName to place text correctly; skip _placeholder entries.",
    "Render ALL nodes recursively. Section root layoutStyle.width = section width. Do not call mcp__getDsl after completing section workflow.",
    ...(JSON.parse(process.env.RULES ?? "[]") as string[]),
    ...parseRules(),
  ];
};

/**
 * Create HTTP utility functions with configured baseUrl and token
 */
const createHttpUtil = () => {
  return {
    async getMeta(fileId: string, layerId: string, sourceLayerId?: string): Promise<string> {
      const response = await axios.get(`${getBaseUrl()}/mcp/meta`, {
        timeout: 30000,
        params: { fileId, layerId, ...(sourceLayerId ? { sourceLayerId } : {}) },
        headers: getCommonHeader(),
      });
      return response.data;
    },

    async getDsl(
      fileId: string,
      layerId: string,
      options?: { sourceLayerId?: string }
    ): Promise<DslResponse> {
      const params: Record<string, any> = { fileId, layerId };
      if (options?.sourceLayerId !== undefined) params.sourceLayerId = options.sourceLayerId;

      const response = await axios.get(`${getBaseUrl()}/mcp/dsl`, {
        timeout: 30000,
        params,
        headers: getCommonHeader(),
      });

      return {
        dsl: response.data,
        componentDocumentLinks: extractComponentDocumentLinks(response.data),
        rules: parseNoRule() ? [] : buildDslRules(),
      };
    },

    async extractSvg(
      fileId: string,
      layerId: string,
      backgroundColor?: string,
      page?: number,
      pageSize?: number
    ): Promise<any> {
      const params: Record<string, any> = { fileId, layerId };
      if (backgroundColor) params.backgroundColor = backgroundColor;
      if (page !== undefined) params.page = page;
      if (pageSize !== undefined) params.pageSize = pageSize;

      const response = await axios.get(`${getBaseUrl()}/mcp/extract-svg`, {
        timeout: 30000,
        params,
        headers: getCommonHeader(),
      });
      return response.data;
    },

    async getDesignSections(fileId: string, layerId: string, sectionIndex?: number): Promise<any> {
      const params: Record<string, any> = { fileId, layerId };
      if (sectionIndex !== undefined) params.sectionIndex = sectionIndex;

      try {
        const response = await axios.get(`${getBaseUrl()}/mcp/design-sections`, {
          timeout: 120000,
          params,
          headers: getCommonHeader(),
        });
        return response.data;
      } catch (err: any) {
        if (err.response?.status === 404) {
          throw new Error(
            `design-sections API not available on this server. ` +
            `Please update frontend-mcp-server to the latest version.`
          );
        }
        throw err;
      }
    },

    async getDesignSvgs(fileId: string, layerId: string): Promise<any> {
      try {
        const response = await axios.get(`${getBaseUrl()}/mcp/design-svgs`, {
          timeout: 120000,
          params: { fileId, layerId },
          headers: getCommonHeader(),
        });
        return response.data;
      } catch (err: any) {
        if (err.response?.status === 404) {
          throw new Error(
            `design-svgs API not available on this server. Please update frontend-mcp-server to the latest version.`
          );
        }
        throw err;
      }
    },

    async getDesignTexts(fileId: string, layerId: string): Promise<any> {
      try {
        const response = await axios.get(`${getBaseUrl()}/mcp/design-texts`, {
          timeout: 120000,
          params: { fileId, layerId },
          headers: getCommonHeader(),
        });
        return response.data;
      } catch (err: any) {
        if (err.response?.status === 404) {
          throw new Error(
            `design-texts API not available on this server. Please update frontend-mcp-server to the latest version.`
          );
        }
        throw err;
      }
    },

    async getD2c(contentId: string,documentId: string): Promise<DslResponse> {
      const params: Record<string, any> = { contentId: contentId, documentId: documentId };
      const response = await axios.get(`${getBaseUrl()}/mcp/d2c/events`, {
        timeout: 30000,
        params,
        headers: getCommonHeader(),
      });

      return response.data;
    },

    async postC2d(
      data: string | Record<string, any>,
      fileId?: string,
      layerId?: string
    ): Promise<any> {
      const response = await axios.post(
        `${getBaseUrl()}/mcp/c2d`,
        { data, fileId, layerId },
        {
          timeout: 30000,
          headers: getCommonHeader(),
        }
      );
      return response.data;
    },

    /**
     * SVG 占位符后处理 — 把代码里的 @@SVG:{svgKey}@@ 占位符替换为真实高精度 SVG。
     *
     * 解决根因：LLM 生成代码时会自主改写 path data 的精度（17.522848 → 17.523），
     * 纯 prompt 约束压不住。本方法让 path data 从不经过 LLM——LLM 只放短占位符，
     * 由服务端用 svgCache 里的真实 SVG 做确定性字符串替换（与目标语言无关）。
     * 同时替换长文本占位符（T{si}|{nodeId}），确保所有占位符都由服务端确定性注入。
     *
     * 必须在 getDesignSections 拉取所有 section 之后调用（svgCache/textCache 由 section 工作流填充）。
     */
    async applyDesign(
      code: string,
      fileId: string,
      layerId: string,
      sourceLayerId?: string
    ): Promise<any> {
      try {
        const response = await axios.post(
          `${getBaseUrl()}/mcp/apply-design`,
          { code, fileId, layerId, ...(sourceLayerId ? { sourceLayerId } : {}) },
          {
            timeout: 60000,
            headers: getCommonHeader(),
          }
        );
        return response.data;
      } catch (err: any) {
        if (err.response?.status === 404) {
          throw new Error(
            `apply-design API not available on this server. Please update frontend-mcp-server to the latest version to enable placeholder post-processing.`
          );
        }
        throw err;
      }
    },

    async getComponentStyleJson(fileId: string, layerId: string, sourceLayerId?: string) {
      const response = await axios.get(`${getBaseUrl()}/mcp/style`, {
        timeout: 30000,
        params: { fileId, layerId, ...(sourceLayerId ? { sourceLayerId } : {}) },
        headers: getCommonHeader(),
      });
      return response.data;
    },

    async request<T = any>(config: AxiosRequestConfig): Promise<T> {
      const response = await axios.request({
        ...config,
        headers: { ...getCommonHeader(), ...config.headers },
      });
      return response.data;
    },
    /**
     * Extract fileId and layerId from a MasterGo URL
     */
    async extractIdsFromUrl(
      url: string
    ): Promise<{ fileId: string; layerId: string; sourceLayerId?: string }> {
      let targetUrl = url;

      // Handle short links
      if (url.includes("/goto/")) {
        // The shortLink is user/LLM-controlled and only `url.includes("/goto/")`
        // is checked — it may NOT be a MasterGo host (e.g. a prompt-injected
        // `https://evil.com/goto/x`). Send credentials (X-MG-UserAccessToken +
        // custom gateway headers) ONLY when the short link's host matches the
        // configured API host. Same-host links (the normal private-deploy case,
        // where the short-link domain == the API domain) still get headers so
        // they pass the internal gateway (issue #64); anything else gets a bare
        // request and the missing credentials surface as a clear failure instead
        // of a silent leak.
        const sendCredentials = isSameHost(url, getBaseUrl());
        const response = await axios.get(url, {
          maxRedirects: 0,
          validateStatus: (status) => status >= 300 && status < 400,
          ...(sendCredentials ? { headers: getCommonHeader() } : {}),
        });

        const redirectUrl = response.headers.location;
        if (!redirectUrl) {
          throw new Error("No redirect URL found for short link");
        }
        targetUrl = new URL(redirectUrl, url).href;
      }

      // Parse the URL
      const urlObj = new URL(targetUrl);
      const pathSegments = urlObj.pathname.split("/");
      const searchParams = new URLSearchParams(urlObj.search);

      // Extract fileId and layerId
      const fileId = pathSegments.find((segment) => /^\d+$/.test(segment));
      const layerId = searchParams.get("layer_id");

      if (!fileId) throw new Error("Could not extract fileId from URL");
      if (!layerId) throw new Error("Could not extract layerId from URL");

      const sourceLayerId = searchParams.get("source_layer_id") || undefined;

      return { fileId, layerId, sourceLayerId };
    },
  };
};

export const httpUtilInstance = createHttpUtil();
