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

  /**
   * Get DSL data
   */
  public async getDsl(fileId: string, layerId: string): Promise<DslResponse> {
    try {
      const params: any = { fileId, layerId };

      const response = await this.httpClient.get("/mcp/dsl", { params });
      return response.data;
    } catch (error) {
      throw error;
    }
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
}
