import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';
import { requestTokenStore } from '../utils/request-context';

type ToolExtra = { _meta?: Record<string, unknown> };

function readUserTokenFromMeta(extra: ToolExtra | undefined): string | undefined {
    const raw = extra?._meta?.userToken;
    if (typeof raw !== 'string') {
        return undefined;
    }
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

export abstract class BaseTool {
    abstract name: string;
    abstract description: string;
    abstract schema: z.ZodObject<any>;

    register(server: McpServer) {
        server.tool(this.name, this.description, this.schema.shape, async (args, extra) => {
            const userToken = readUserTokenFromMeta(extra as ToolExtra);
            return requestTokenStore.run(userToken, () => this.execute(args as z.infer<typeof this.schema>));
        });
    }

    abstract execute(args: z.infer<typeof this.schema>): Promise<{
        content: Array<{ type: 'text'; text: string }>;
    }>;
}
