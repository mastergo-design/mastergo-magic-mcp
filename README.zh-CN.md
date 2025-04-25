# MasterGo Magic MCP

MasterGo Magic MCP 是一个独立的 MCP（Model Context Protocol）服务，旨在连接 MasterGo 设计工具与 AI 模型。它使 AI 模型能够直接从 MasterGo 设计文件中获取 DSL 数据。

## 主要特性

- 从 MasterGo 设计文件中获取 DSL 数据
- 可直接通过 npx 运行
- 仅需 Node.js 环境，无需其他外部依赖

### 教程

- https://mastergo.com/file/155675508499265?page_id=158:0002

## 使用方法

### 获取 MG_MCP_TOKEN

1. 访问 https://mastergo.com
2. 进入个人设置
3. 点击安全设置选项卡
4. 找到个人访问令牌
5. 点击生成令牌

### 命令行选项

```
npx @mastergo/magic-mcp --token=YOUR_TOKEN [--url=API_URL] [--rule=RULE_NAME] [--debug]
```

#### 参数:

- `--token=YOUR_TOKEN` (必需): MasterGo API 认证令牌
- `--url=API_URL` (可选): API 基础 URL，默认为 http://localhost:3000
- `--rule=RULE_NAME` (可选): 添加要应用的设计规则，可多次使用
- `--debug` (可选): 启用调试模式，提供详细错误信息

你也可以使用空格分隔的参数格式:

```
npx @mastergo/magic-mcp --token YOUR_TOKEN --url API_URL --rule RULE_NAME --debug
```

### Cursor 使用方法

Cursor Mcp 使用指南参考：https://docs.cursor.com/context/model-context-protocol#using-mcp-tools-in-agent

```json
{
  "mcpServers": {
    "mastergo-magic-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "@mastergo/magic-mcp",
        "--token=<MG_MCP_TOKEN>",
        "--url=https://mastergo.com"
      ],
      "env": {}
    }
  }
}
```

### cline 使用方法

```json
{
  "mcpServers": {
    "@master/mastergo-magic-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "@mastergo/magic-mcp",
        "--token=<MG_MCP_TOKEN>",
        "--url=https://mastergo.com"
      ],
      "env": {}
    }
  }
}
```

## 项目结构

### src 目录

`src` 目录包含 MasterGo Magic MCP 服务的核心实现：

- `index.ts`：应用程序入口点，初始化 MCP 服务器并注册所有工具
- `http-util.ts`：处理与 MasterGo API 通信的 HTTP 请求工具
- `types.d.ts`：项目的 TypeScript 类型定义

#### src/tools

包含 MCP 工具的实现：

- `base-tool.ts`：所有 MCP 工具的基类
- `get-dsl.ts`：从 MasterGo 设计文件中获取 DSL（领域特定语言）数据的工具
- `get-component-link.ts`：从链接中获取组件文档的工具
- `get-meta.ts`：获取元数据信息的工具

#### src/markdown

包含附加文档的 markdown 文件：

- `meta.md`：关于元数据结构和用法的文档

## 本地运行

1. 运行`yarn`，`yarn build`。安装依赖并构建代码
2. 查看`bin/cli.js`的绝对路径
3. 在MCP配置中添加本地MCP配置，其中token为您换区的token
```json
"mastergo-mcp-local": {
  "command": "node",
  "args": [
    "bin/cli.js绝对路径地址",
    "--token=mg_xxxxxx",
    "--url=https://mastergo.com",
    "--debug"
  ],
  "env": {}
},
```
4. 重启编辑器，确认本地mcp已开启

运行成功后，就可以基于本地运行的结果进行调试。您可以基于自己的修改构建自己的MCP服务。

欢迎您为我们提供代码贡献，并期待大家一起共建MasterGo的MCP服务。

## 许可证

ISC
