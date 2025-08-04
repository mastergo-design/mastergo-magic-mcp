import axios, { AxiosRequestConfig } from "axios";
import { parseToken, parseUrl, parseRules, parseNoRule } from "./args";

// DSL response interface
export interface DslResponse {
  [key: string]: any;
}

// Code generation response interface
export interface CodeResponse {
  code: string;
  [key: string]: any;
}

const getCommonHeader = () => ({
  "Content-Type": "application/json",
  Accept: "application/json",
  "X-MG-UserAccessToken":
    process.env.MG_MCP_TOKEN || process.env.MASTERGO_API_TOKEN || parseToken(),
});

const getBaseUrl = () => process.env.API_BASE_URL || parseUrl();

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
    "token filed must be generated as a variable (colors, shadows, fonts, etc.) and the token field must be displayed in the comment",
    `componentDocumentLinks is a list of frontend component documentation links used in the DSL layer, designed to help you understand how to use the components.
When it exists and is not empty, you need to use mcp__getComponentLink in a for loop to get the URL content of all components in the list, understand how to use the components, and generate code using the components.
For example: 
  \`\`\`js  
    const componentDocumentLinks = [
      'https://example.com/ant/button.mdx',
      'https://example.com/ant/button.mdx'
    ]
    for (const url of componentDocumentLinks) {
      const componentLink = await mcp__getComponentLink(url);
      console.log(componentLink);
    }
  \`\`\``,
    ...(JSON.parse(process.env.RULES ?? "[]") as string[]),
    ...parseRules(),
  ];
};

/**
 * Create HTTP utility functions with configured baseUrl and token
 */
const createHttpUtil = () => {
  return {
    async getMeta(fileId: string, layerId: string): Promise<string> {
      const response = await axios.get(`${getBaseUrl()}/mcp/meta`, {
        timeout: 30000,
        params: { fileId, layerId },
        headers: getCommonHeader(),
      });
      return response.data;
    },

    async getDsl(fileId: string, layerId: string): Promise<DslResponse> {
      const response = await axios.get(`${getBaseUrl()}/mcp/dsl`, {
        timeout: 30000,
        params: { fileId, layerId },
        headers: getCommonHeader(),
      });

      return {
        dsl: response.data,
        componentDocumentLinks: extractComponentDocumentLinks(response.data),
        rules: parseNoRule() ? [] : buildDslRules(),
      };
    },

    async getComponentStyleJson(fileId: string, layerId: string) {
      const response = await axios.get(`${getBaseUrl()}/mcp/style`, {
        timeout: 30000,
        params: { fileId, layerId },
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
    ): Promise<{ fileId: string; layerId: string }> {
      let targetUrl = url;

      // Handle short links
      if (url.includes("/goto/")) {
        const response = await axios.get(url, {
          maxRedirects: 0,
          validateStatus: (status) => status >= 300 && status < 400,
        });

        const redirectUrl = response.headers.location;
        if (!redirectUrl) {
          throw new Error("No redirect URL found for short link");
        }
        targetUrl = redirectUrl;
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

      return { fileId, layerId };
    },
  };
};

export const httpUtilInstance = createHttpUtil();
