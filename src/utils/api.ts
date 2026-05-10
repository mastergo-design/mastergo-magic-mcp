import axios, { type AxiosRequestConfig } from 'axios';
import https from 'https';
import { parseNoRule, parseRules, parseToken, parseUrl } from './args';
import { requestTokenStore } from './request-context';

axios.defaults.httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

/** 避免 axios 错误对象序列化 / 日志打印时泄露访问令牌 */
function stripSensitiveHeadersFromAxiosError(error: unknown): void {
    const cfg = (error as { config?: { headers?: unknown } })?.config;
    const headers = cfg?.headers;
    if (headers == null) {
        return;
    }
    if (typeof (headers as { delete?: (key: string) => void }).delete === 'function') {
        (headers as { delete: (key: string) => void }).delete('X-MG-UserAccessToken');
        (headers as { delete: (key: string) => void }).delete('Authorization');
        return;
    }
    if (typeof headers === 'object') {
        Reflect.deleteProperty(headers as object, 'X-MG-UserAccessToken');
        Reflect.deleteProperty(headers as object, 'Authorization');
    }
}

axios.interceptors.response.use(
    (response) => response,
    (error) => {
        stripSensitiveHeadersFromAxiosError(error);
        return Promise.reject(error);
    }
);

// DSL response interface
export interface DslResponse {
    [key: string]: any;
}

// Code generation response interface
export interface CodeResponse {
    code: string;
    [key: string]: any;
}

const getCommonHeader = () => {
    const fromRequest = requestTokenStore.getStore();
    const token =
        fromRequest != null && fromRequest.trim().length > 0
            ? fromRequest.trim()
            : process.env.MG_MCP_TOKEN || process.env.MASTERGO_API_TOKEN || parseToken();
    return {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-MG-UserAccessToken': token
    };
};

const getBaseUrl = () => {
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

        return baseUrl;
    } catch {
        throw new Error(`无效的URL格式: ${url}。请提供正确的URL格式，例如: https://mastergo.com`);
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
        'token filed must be generated as a variable (colors, shadows, fonts, etc.) and the token field must be displayed in the comment',
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
        ...(JSON.parse(process.env.RULES ?? '[]') as string[]),
        ...parseRules()
    ];
};

/**
 * Create HTTP utility functions with configured baseUrl and token
 */
const createHttpUtil = () => {
    return {
        async getMeta(fileId: string, layerId: string, sourceLayerId?: string): Promise<string> {
            const response = await axios.get(`${getBaseUrl()}/mcp/meta`, {
                timeout: 30_000,
                params: { fileId, layerId, ...(sourceLayerId ? { sourceLayerId } : {}) },
                headers: getCommonHeader()
            });
            return response.data;
        },

        async getDsl(fileId: string, layerId: string, sourceLayerId?: string): Promise<DslResponse> {
            const response = await axios.get(`${getBaseUrl()}/mcp/dsl`, {
                timeout: 30_000,
                params: { fileId, layerId, ...(sourceLayerId ? { sourceLayerId } : {}) },
                headers: getCommonHeader()
            });

            return {
                dsl: response.data,
                componentDocumentLinks: extractComponentDocumentLinks(response.data),
                rules: parseNoRule() ? [] : buildDslRules()
            };
        },

        async getD2c(contentId: string, documentId: string): Promise<DslResponse> {
            const params: Record<string, any> = { contentId, documentId };
            const response = await axios.get(`${getBaseUrl()}/mcp/d2c/events`, {
                timeout: 30_000,
                params,
                headers: getCommonHeader()
            });

            return response.data;
        },

        async postC2d(data: string | Record<string, any>, fileId?: string, layerId?: string): Promise<any> {
            const response = await axios.post(
                `${getBaseUrl()}/mcp/c2d`,
                { data, fileId, layerId },
                {
                    timeout: 30_000,
                    headers: getCommonHeader()
                }
            );
            return response.data;
        },

        async getComponentStyleJson(fileId: string, layerId: string, sourceLayerId?: string) {
            const response = await axios.get(`${getBaseUrl()}/mcp/style`, {
                timeout: 30_000,
                params: { fileId, layerId, ...(sourceLayerId ? { sourceLayerId } : {}) },
                headers: getCommonHeader()
            });
            return response.data;
        },

        async request<T = any>(config: AxiosRequestConfig): Promise<T> {
            const response = await axios.request({
                ...config,
                headers: { ...getCommonHeader(), ...config.headers }
            });
            return response.data;
        },
        /**
         * Extract fileId and layerId from a MasterGo URL
         */
        async extractIdsFromUrl(url: string): Promise<{ fileId: string; layerId: string; sourceLayerId?: string }> {
            let targetUrl = url;

            // Handle short links
            if (url.includes('/goto/')) {
                const response = await axios.get(url, {
                    maxRedirects: 0,
                    validateStatus: (status) => status >= 300 && status < 400
                });

                const redirectUrl = response.headers.location;
                if (!redirectUrl) {
                    throw new Error('No redirect URL found for short link');
                }
                targetUrl = new URL(redirectUrl, url).href;
            }

            // Parse the URL
            const urlObj = new URL(targetUrl);
            const pathSegments = urlObj.pathname.split('/');
            const searchParams = new URLSearchParams(urlObj.search);

            // Extract fileId and layerId
            const fileId = pathSegments.find((segment) => /^\d+$/.test(segment));
            const layerId = searchParams.get('layer_id');

            if (!fileId) throw new Error('Could not extract fileId from URL');
            if (!layerId) throw new Error('Could not extract layerId from URL');

            const sourceLayerId = searchParams.get('source_layer_id') || undefined;

            return { fileId, layerId, sourceLayerId };
        }
    };
};

export const httpUtilInstance = createHttpUtil();
