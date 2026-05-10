import { z } from 'zod';
import { httpUtilInstance } from '../utils/api';
import { BaseTool } from './base-tool';

const DSL_TOOL_NAME = 'mcp__getDsl';
const DSL_TOOL_DESCRIPTION = `
"Use this tool to retrieve the DSL (Domain Specific Language) data from MasterGo design files and the rules you must follow when generating code.
This tool is useful when you need to analyze the structure of a design, understand component hierarchy, or extract design properties.
You can provide either:
1. fileId and layerId directly, or
2. a short link (like https://{domain}/goto/LhGgBAK)
This tool returns the raw DSL data in JSON format that you can then parse and analyze.
This tool also returns the rules you must follow when generating code.
The DSL data can also be used to transform and generate code for different frameworks."
`;

export class GetDslTool extends BaseTool {
    name = DSL_TOOL_NAME;
    description = DSL_TOOL_DESCRIPTION;

    constructor() {
        super();
    }

    schema = z.object({
        fileId: z
            .string()
            .optional()
            .describe(
                'MasterGo design file ID (format: file/<fileId> in MasterGo URL). Required if shortLink is not provided.'
            ),
        layerId: z
            .string()
            .optional()
            .describe(
                'Layer ID of the specific component or element to retrieve (format: ?layer_id=<layerId> / file=<fileId> in MasterGo URL). Required if shortLink is not provided.'
            ),
        sourceLayerId: z
            .string()
            .optional()
            .describe(
                'Source layer ID from URL parameter source_layer_id. When provided, use this instead of layerId for all queries.'
            ),
        shortLink: z.string().optional().describe('Short link (like https://{domain}/goto/LhGgBAK).')
    });

    async execute({ fileId, layerId, sourceLayerId, shortLink }: z.infer<typeof this.schema>) {
        try {
            if (!shortLink && !(fileId && layerId)) {
                throw new Error('Either provide both fileId and layerId, or provide a MasterGo URL');
            }

            let finalFileId = this.normalizeFileId(fileId);
            let finalLayerId = layerId;
            let finalSourceLayerId = sourceLayerId;

            // If URL is provided, extract fileId and layerId from it
            if (shortLink) {
                const ids = await httpUtilInstance.extractIdsFromUrl(shortLink);
                finalFileId = this.normalizeFileId(ids.fileId);
                finalLayerId = ids.layerId;
                finalSourceLayerId = ids.sourceLayerId ?? sourceLayerId;
            }

            if (!(finalFileId && finalLayerId)) {
                throw new Error('Could not determine fileId or layerId');
            }

            const dsl = await httpUtilInstance.getDsl(finalFileId, finalLayerId, finalSourceLayerId);
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify(dsl)
                    }
                ]
            };
        } catch (error: any) {
            const errorMessage = error.response?.data ?? error?.message;
            return {
                isError: true,
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify(errorMessage)
                    }
                ]
            };
        }
    }

    private normalizeFileId(fileId?: string) {
        if (!fileId) return fileId;
        return fileId.replace(/^file\//, '');
    }
}
