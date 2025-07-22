// Make a request through axios and set the request interceptor to add the token
import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";

// DSL response interface
export interface DslResponse {
  [key: string]: any;
}

// Code generation response interface
export interface CodeResponse {
  code: string;
  [key: string]: any;
}

/**
 * HttpUtil class - responsible for managing requests and storing tokens
 */
export class HttpUtil {
  private httpClient: AxiosInstance;

  constructor(baseUrl: string, token: string) {
    // Create axios instance
    this.httpClient = axios.create({
      baseURL: baseUrl,
      timeout: 30000, // Default 30 second timeout
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    // Request interceptor
    this.httpClient.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        // If a token exists, add it to the request header
        if (token) {
          config.headers["X-MG-UserAccessToken"] = `${token}`;
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.httpClient.interceptors.response.use(
      (response: AxiosResponse) => {
        return response;
      },
      (error) => {
        return Promise.reject(error);
      }
    );
  }

  private handleDslComponentDocumentLinks(dsl: DslResponse) {
    const documentLinks = new Set<string>();

    const getChildrenDocumentLinks = (node: any) => {
      if (node?.componentInfo?.componentSetDocumentLink?.[0]) {
        documentLinks.add(node.componentInfo.componentSetDocumentLink[0]);
      }

      if (node.children && Array.isArray(node.children)) {
        for (const child of node.children) {
          getChildrenDocumentLinks(child);
        }
      }
    };

    for (const node of dsl.nodes ?? []) {
      getChildrenDocumentLinks(node);
    }

    return Array.from(documentLinks);
  }

  public async getMeta(fileId: string, layerId: string): Promise<string> {
    const response = await this.httpClient.get("/mcp/meta", {
      params: { fileId, layerId },
    });
    return response.data;
  }

  /**
   * Get DSL data
   */
  public async getDsl(fileId: string, layerId: string): Promise<DslResponse> {
    try {
      const params: any = { fileId, layerId };

      const response = await this.httpClient.get("/mcp/dsl", { params });
      const result = {
        dsl: response.data,
        componentDocumentLinks: this.handleDslComponentDocumentLinks(
          response.data
        ),
        rules: [
          "token filed must be generated as a variable (colors, shadows, fonts, etc.) and the token field must be displayed in the comment",
          `
            componentDocumentLinks is a list of frontend component documentation links used in the DSL layer, designed to help you understand how to use the components.
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
              \`\`\`
          `,
          ...(JSON.parse(process.env.RULES ?? "[]") as string[]),
        ],
      };
      return result;
    } catch (error) {
      throw error;
    }
  }

  public async getComponentStyleJson(fileId: string, layerId: string) {
    const response = await this.httpClient.get(`/mcp/style`, {
      params: { fileId, layerId },
    });
    return response.data;
  }

  /**
   * General request method
   */
  public async request<T = any>(config: AxiosRequestConfig): Promise<T> {
    try {
      const response = await this.httpClient(config);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Extract fileId and layerId from a MasterGo URL
   * @param url MasterGo URL (can be short or full URL)
   * @returns Promise<{fileId: string, layerId: string}>
   */
  public async extractIdsFromUrl(
    url: string
  ): Promise<{ fileId: string; layerId: string }> {
    try {
      // Handle short links (e.g., https://mastergo.com/goto/LhTAgwAK)
      if (url.includes("/goto/")) {
        const response = await axios.get(url, {
          maxRedirects: 0,
          validateStatus: (status) => status >= 300 && status < 400,
        });

        // Get the redirect URL from headers
        const redirectUrl = response.headers.location;
        if (!redirectUrl) {
          throw new Error("No redirect URL found for short link");
        }

        url = redirectUrl;
      }

      // Parse the full URL
      const urlObj = new URL(url);
      const pathSegments = urlObj.pathname.split("/");
      const searchParams = new URLSearchParams(urlObj.search);

      // Extract fileId from path
      const fileId = pathSegments.find((segment) => /^\d+$/.test(segment));
      if (!fileId) {
        throw new Error("Could not extract fileId from URL");
      }

      // Extract layerId from query parameters
      const layerId = searchParams.get("layer_id");
      if (!layerId) {
        throw new Error("Could not extract layerId from URL");
      }

      return { fileId, layerId };
    } catch (error: any) {
      throw new Error(`Failed to extract IDs from URL: ${error.message}`);
    }
  }
}
