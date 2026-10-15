import { z } from "zod";
import axios from "axios";
import { BaseTool } from "./base-tool";
import { getBaseUrl, getCommonHeader, isSameHost } from "../utils/api";
import { isAllowedHttpUrl } from "../utils/security";
import { toolName } from "../utils/tool-prefix";

const COMPONENT_LINK_TOOL_DESCRIPTION = `When the data returned by mcp__getDsl contains a non-empty componentDocumentLinks array, this tool is used to sequentially retrieve URLs from the componentDocumentLinks array and then obtain component documentation data. The returned document data is used for you to generate frontend code based on components.`;

export class GetComponentLinkTool extends BaseTool {
  get name() {
    return toolName("getComponentLink");
  }
  description = COMPONENT_LINK_TOOL_DESCRIPTION;

  constructor() {
    super();
  }

  schema = z.object({
    url: z
      .string()
      .describe(
        "Component documentation link URL, from the componentDocumentLinks property, please ensure the URL is valid"
      ),
  });

  async execute({ url }: z.infer<typeof this.schema>) {
    // CVE-2026-15750 修复：url 由 LLM 传入（设计稿内容可被注入），请求前必须做
    // SSRF 校验——仅放行 http(s) 公网地址；用户显式配置的部署 API 地址允许放行
    // （私有化部署下组件文档可能就挂在内网网关上）。
    const check = isAllowedHttpUrl(url, { allowHosts: [getBaseUrl()] });
    if (!check.ok) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: "Blocked unsafe URL",
              reason: check.reason,
            }),
          },
        ],
      };
    }

    // 防凭据外泄：仅当目标与配置的 API 地址同 host 时才携带 X-MG-UserAccessToken
    // 等鉴权头（与 extractIdsFromUrl 的 shortLink 处理同一策略，issue #64）。
    // 因此这里不走 httpUtilInstance.request（它会无条件合并带 token 的公共头），
    // 改用裸 axios 按需组头。
    const sendCredentials = isSameHost(url, getBaseUrl());

    try {
      const response = await axios.get(url, {
        timeout: 30000,
        maxRedirects: 3,
        ...(sendCredentials ? { headers: getCommonHeader() } : {}),
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `${response.data}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: "Failed to get component documentation",
              message: error instanceof Error ? error.message : String(error),
            }),
          },
        ],
      };
    }
  }
}
