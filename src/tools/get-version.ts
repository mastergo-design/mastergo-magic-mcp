import { z } from "zod";
import { BaseTool } from "./base-tool";
import packageJson from "../../package.json";

const VERSION_TOOL_NAME = `version_${packageJson.version.replace(/\./g, '_')}`;
const VERSION_TOOL_DESCRIPTION = `the current version is ${packageJson.version}`;

export class GetVersionTool extends BaseTool {
  name = VERSION_TOOL_NAME;
  description = VERSION_TOOL_DESCRIPTION;

  constructor() {
    super();
  }

  schema = z.object({});

  async execute({}: z.infer<typeof this.schema>) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(packageJson.version),
        },
      ],
    };
  }
}
