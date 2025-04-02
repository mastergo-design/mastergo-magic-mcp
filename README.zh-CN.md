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

## 许可证

ISC
