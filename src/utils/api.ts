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
    "PATH nodes come in TWO forms. (1) INLINED: PATH nodes carry an `svg` field with the complete `<svg>...</svg>` string — copy it VERBATIM into the HTML, no transformation. (2) STRIPPED: large sections strip the svg to a cache; these PATH nodes carry a `svgKey` field AND a `path` array with empty data. Call mcp__getDesignSvgs to get the svgHtml. ALWAYS check `svg` first; if absent, use `svgKey` to fetch.",
    "CRITICAL — SVG VERBATIM fidelity (3 forbidden modifications): whether from the `svg` field or mcp__getDesignSvgs, the svgHtml is AUTHORITATIVE — copy it character-for-character. Three violations that corrupt icons: (1) NEVER round coordinate precision — 17.522848 must stay 17.522848, not 17.523 (rounding shifts shapes visibly); (2) NEVER drop M-subpaths — a compound path may contain 2-6 subpaths (e.g. a magnifier = outer circle + inner circle + handle + pointer + ticks), dropping ANY subpath breaks the icon (a magnifier with only the ring loses its handle); (3) NEVER 'simplify' or 'optimize' path commands or viewBox. The path d is formatted with one subpath per line (split at each M) to help you see them — preserve EVERY line. After copying, VERIFY: count the M commands in your output's path d — it MUST equal the source's M count, and the d string length MUST match. If you shortened it or reduced M count, you corrupted the icon — redo the copy. The only allowed change is the fill attribute for active/hover state.",
    "CRITICAL — NEVER hand-draw substitute icons. Use the EXACT svg from (a) PATH node's `svg` field, (b) `svgKey` via mcp__getDesignSvgs, or (c) the pre-extracted `dsl.icons[name]` map — all three carry the designer's true vector. Do NOT approximate an icon with `<rect>`/`<circle>`/`<polygon>` primitives even if they look similar (e.g. drawing bar-chart rects for a dashboard gauge). If missing, fetch it; never rebuild it.",
    "CRITICAL — Never hand-draw substitute icons. Use `svg` or `svgKey` from PATH nodes.",
    "TEXT nodes contain the actual text in node.text array. You MUST read each TEXT node's content and use it EXACTLY. Do NOT duplicate text from one node to another — each node has unique content.",
    "Do NOT skip or omit any child nodes. Render ALL nodes present in the DSL, including every tab item, every grid button, every text element.",
    "DO NOT call mcp__getDsl or mcp__extractSvg after completing this section workflow. The data from all sections + getDesignSvgs is COMPLETE.",
    "Background colors come from the node's fillStyleId — look it up in the DSL styles map. Do NOT invent background gradients or colors. If a node has no fill style, leave its background transparent.",
    "CRITICAL: The section's root node layoutStyle.width is the section width. Some child elements (like border lines) may have a larger width than the root — this is normal (they overflow). ALWAYS use the root node's width as the section container width. Do NOT widen the section based on child element widths.",
    "INSTANCE nodes are reusable components. They have children (TEXT, PATH, GROUP, etc.) just like FRAME nodes. You MUST render all children inside INSTANCE nodes — especially TEXT children which contain button labels, prices, and other critical content. Treat INSTANCE the same as FRAME: render its children with correct positioning from their layoutStyle.",
    "Do NOT fabricate table rows based on pagination values like '共 X 项'. Render only the actual data rows found in the section DSL. If the DSL has 1 data row, output exactly 1 row.",
    "Pagination component labels (e.g. '共 10 项', '20 行') are UI control labels — not data to replicate. Do NOT guess or fabricate data based on these numbers.",
    "CRITICAL — SVG icons, NOT text: table action columns (操作列) use SVG icon buttons (edit/delete), NOT plain text. Match each SVG key from getDesignSvgs to its section — keys like '通用_编辑' and '通用_删除' are the authoritative icons. Insert the exact svgHtml. NEVER render action buttons as `<p>编辑</p>` or `<p>删除</p>` plain text. Sidebar menu icons also use SVG — do NOT draw simplified placeholder shapes when the real SVG data is available from getDesignSvgs.",
    "CRITICAL — Persistent sidebars: render all sidebar levels as static visible columns positioned via splitContainers coordinates.",
    "CRITICAL — Composite SVG icons (logos / multi-subpath marks): when PATH nodes are stripped and you fetch via mcp__getDesignSvgs, use the returned `<svg>` VERBATIM. NEVER assemble your own `<svg>` from `<path>` + hand-computed `transform=\"translate(...) scale(...)\"`. The node's `relativeX`/`relativeY` are PAGE COORDINATES, not intra-SVG transform values — embedding them as `<path transform>` warps the glyph out of its viewBox.",
    "CRITICAL — Render count = `structureSiblingCount`. Each section entry carries `structureSiblingCount` = how many times this structure appears in the design. If a table/data section has `structureSiblingCount: 1`, that single row IS the complete table — do NOT add rows 'for visual density'. The count is a fact from the design, not a suggestion.",
    "CRITICAL — TEXT nodes may carry `_placeholder: true` when their name equals their content (the universal signature of component-library boilerplate — the slot name WAS the placeholder string, e.g. name=\"Hillstone Design\" and text=\"Hillstone Design\"). This works across ALL component libraries without brand-specific tokens. It is a HINT, not a deletion. If it does not map to a real column/label, omit it. Do NOT blanket-render every `_placeholder` as a visible header.",
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
