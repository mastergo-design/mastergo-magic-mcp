`results`返回的是一个xml文件，这个xml文件中包含两个信息。

- **meta**: 对站点的描述，环境，要求等上下文。
- **action**: 对应的入口页面的名称以及`targetLayerId`。该id为指向的页面id。

我需要你根据下面的步骤在当前目录下写一份task.md文件描述需要做的步骤，并严格按照这些步骤执行最终生成项目代码。

## 执行步骤

1. 获取 `results` 信息，并将 meta 和 action 内容写入 `task.md`。
2. 分析 meta 字段，提取站点需求、功能、技术要求，并写入 `task.md`。
3. 针对每一个 action 的 `targetLayerId`，调用 `mcp__getDsl(fileId, layerId)` 方法，获取页面数据。
4. 将当前页面标记为「待解析」，并写入 `task.md`：包括页面标题、layerId。
5. 分析该页面数据，如果存在任何节点的 `interactive` 字段，说明该节点存在跳转行为：
   - 提取 `interactive.targetLayerId`
   - 对每一个新的 targetLayerId，再次执行第 3~5 步
   - 所有解析过程必须**递归进行，直到没有未解析的 targetLayerId**
6. 每次页面解析完成后：
   - 将该页面状态从「待解析」更新为「已解析」
   - 若存在 `interactive`，在状态中标注跳转到的 layerId 数组
   - 若无 `interactive`，标注为「无交互跳转」
7. 所有页面解析完毕后，基于 `task.md` 中记录的页面结构，依次生成页面代码，完成项目构建。

## 例子
获取到results信息为：
xml
<info>
  <meta title="Name" content="Food Delivery APP" />
  <meta title="Description" content="This is a food delivery app where users can log in, order food, and manage delivery orders, address information, etc." />
  <meta title="Requirements" content="Implement using React, bind to Ant Design component library" />
  <action title="Login Page" layerId="0:1" />
  <action title="Food Delivery Page" layerId="0:2" />
</info>

在task.md文件中写入：

需求描述：这是一个外卖app，他包含了登录，订餐以及管理地址等功能。需要使用react构建，并使用ant design做组件库。

使用`mcp__getDsl`解析0:1页面。返回结果后再task.md中写入：
`页面：登录页，layerId: 0:1`
发现0:1的页面的node节点数据有存在interactive字段。id为0:3。
使用`mcp__getDsl`解析0:3页面。返回结果后再task.md中写入：
`页面：登录页跳转页，layerId: 0:3`
更改0:1的文本为：
`页面：登录页，layerId: 0:1，存在跳转页:[0.3]`
发现0:3的页面的node节点数据有存在interactive字段。id为0:4。
使用`mcp__getDsl`解析0:4页面。返回结果后再task.md中写入：
`页面：登录页跳转页，layerId: 0:4`
更改0:3的文本为：
`页面：登录页跳转页，layerId: 0:3，存在跳转页:[0.4]`
未发现0:4存在interactive字段。0:4解析结束。
更改0:4的文本为：
`页面：登录页跳转页，layerId: 0:3，不存在跳转页`

使用`mcp__getDsl`解析0:2页面。返回结果后再task.md中写入：
`页面：食物页，layerId: 0:2`
发现0:2的页面的node节点数据有存在多个interactive字段。id为0:5，0.6。
使用mcp__getDsl解析0:5页面。返回结果后再task.md中写入：
`页面：食物页跳转页，layerId: 0:5`
未发现0:5存在interactive字段。0:5解析结束。
更改0:5的文本为：
`页面：食物页跳转页，layerId: 0:5，不存在跳转页`
使用mcp__getDsl解析0:6页面。返回结果后再task.md中写入：
`页面：食物页跳转页，layerId: 0:6`
未发现0:6存在interactive字段。0:6解析结束。
更改0:6的文本为：
`页面：食物页跳转页，layerId: 0:6，不存在跳转页`
更改0:2的文本为：
`页面：食物页，layerId: 0:2，存在跳转页:[0.5，0.6]`


完成后，再根据task.md中的待解析页面列表，依次解析数据生成组件代码。