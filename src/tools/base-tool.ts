import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export abstract class BaseTool {
  abstract name: string;
  abstract description: string;
  abstract schema: z.ZodObject<any>;

  register(server: McpServer) {
    server.tool(
      this.name,
      this.description,
      this.schema.shape,
      this.execute.bind(this)
    );
  }

  abstract execute(args: z.infer<typeof this.schema>): Promise<{
    content: Array<{ type: "text"; text: string }>;
  }>;
}
