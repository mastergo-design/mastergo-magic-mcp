import { z } from "zod";
import fs from "fs";
import { BaseTool } from "./base-tool";
import { HttpUtil } from "../http-util";
import componentWorkflow from "../markdown/component-workflow.md";
import componentUiDesign from "../markdown/component-ui-design.md";
import componentJson from "../json/button.json";

const COMPONENT_GENERATOR_TOOL_NAME = "mcp__getComponentGenerator";
const COMPONENT_GENERATOR_TOOL_DESCRIPTION = `
Use this tool when the user wants to build a Vue component or React component.
This tool provides a structured workflow for component development following best practices.
You must provide an absolute rootPath of workspace to save workflow files.

The component development workflow follows these stages:
1. Component Analysis - Understand requirements and specifications
2. Architecture Design - Plan the component structure
3. Component Development - Implement the component with proper state management
4. Testing and Validation - Ensure component quality
5. Documentation and Showcase - Create usage examples

\`\`\`mermaid
graph TD
    A[Start] --> B[Component Analysis]
    B --> C[Architecture Design]

    C --> D{Architecture Approved?}
    D -->|Yes| E[Component Development Phase]
    D -->|No| C

    E --> F[Basic Implementation]
    F --> G[Unit Testing]
    G --> H{Tests Passed?}
    H -->|No| F
    H -->|Yes| I[Documentation and Preview]

    I --> J{Final Review}
    J -->|Approved| K[Component Completed]
    J -->|Needs Improvement| E
\`\`\`
`;

export class GetComponentWorkflowTool extends BaseTool {
  name = COMPONENT_GENERATOR_TOOL_NAME;
  description = COMPONENT_GENERATOR_TOOL_DESCRIPTION;
  private httpUtil: HttpUtil;

  constructor(httpUtil: HttpUtil) {
    super();
    this.httpUtil = httpUtil;
  }

  schema = z.object({
    rootPath: z
      .string()
      .describe(
        "The root path of the project, if the user does not provide, you can use the current directory as the root path"
      ),
  });

  async execute({ rootPath }: z.infer<typeof this.schema>) {
    // 如果文件夹不存在则创建
    const dir = `${rootPath}/architecture`;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const architectureDir = `${dir}/component-workflow.md`;
    const designPrincipleDir = `${dir}/component-ui-design.md`;
    const componentJsonDir = `${dir}/button.json`;

    //文件夹可能也不存在递归创建
    if (!fs.existsSync(architectureDir)) {
      fs.writeFileSync(architectureDir, componentWorkflow);
    }

    if (!fs.existsSync(designPrincipleDir)) {
      fs.writeFileSync(designPrincipleDir, componentUiDesign);
    }

    if (!fs.existsSync(componentJsonDir)) {
      fs.writeFileSync(componentJsonDir, JSON.stringify(componentJson));
    }

    try {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              files: {
                workflow: architectureDir,
                uiDesign: designPrincipleDir,
                componentSpec: componentJsonDir,
              },
              message: "Component development files successfully created",
              rules: [
                `Follow the component workflow process defined in ${architectureDir} for structured development.`,
                `Adhere to UI design principles and patterns specified in ${designPrincipleDir}, especially for state management and component reuse.`,
                `Implement the component according to the specifications in ${componentJsonDir}, ensuring all properties and states are properly handled.`,
                `Maintain consistency with existing components and follow the CSS-first approach for state management where appropriate.`,
                `Ensure proper testing coverage for all component functionality and edge cases.`,
              ],
            }),
          },
        ],
      };
    } catch (error: any) {
      const errorMessage = error.response?.data ?? error?.message;
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(errorMessage),
          },
        ],
      };
    }
  }
}
