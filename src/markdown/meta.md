results返回的是一个xml文件，这个xml文件中包含两个信息。

- **meta**: 对站点的描述，环境，要求等上下文。
- **action**: 对应的入口页面的名称以及targetLayerId。该id为指向的页面id。

我需要你根据下面的步骤在当前目录下写一份task.md文件描述需要做的步骤，并严格按照这些步骤执行最终生成项目代码。

## 步骤
1. 获取results信息，并将信息写入task.md文件
2. 分析meta字段，将需求描述总结写入task.md文件
3. 根据action字段中的targetLayerId以及当前的fileId调用mcp__getDsl方法，返回页面数据。
4. 分析页面数据，并将带解析页面写入到task.md文件
5. 分析页面数据，确认是否存在interactive字段，如果存在，则该字段为当前节点跳转页面的信息。根据interactive字段继续调用mcp__getDsl方法，跳转到4。
6. 重复3-5步骤，知道所有的页面数据都已经解析，并写入task.md文件。
7. 根据task.md文件中的内容，依次解析task.md中的页面并生成代码。完成项目的构建。

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

使用mcp__getDsl解析0:1页面。返回结果后再task.md中写入：
待解析页面：登录页，页面id：0:1。
发现0:1的页面的node节点数据有存在interactive字段。id为0:3。
使用mcp__getDsl解析0:3页面。返回结果后再task.md中写入：
待解析页面：登录页关联页，页面id: 0:3。
更改0:1的文本为：
已解析页面：登录页，页面id：0:1，存在interactive id: [0:3]。
发现0:3的页面的node节点数据有存在interactive字段。id为0:4。
使用mcp__getDsl解析0:4页面。返回结果后再task.md中写入：
待解析页面：登录页关联页，页面id: 0:4。
更改0:3的文本为：
已解析页面：登录页，页面id：0:3，存在interactive id: [0:4]。
未发现0:4存在interactive字段。0:1解析结束。
更改0:4的文本为：
已解析页面：登录页关联页，页面id: 0:4，不存在interactive。。

使用mcp__getDsl解析0:2页面。返回结果后再task.md中写入：
待解析页面：食物页，页面id: 0:2。
发现0:2的页面的node节点数据有存在interactive字段。id为0:5。
使用mcp__getDsl解析0:5页面。返回结果后再task.md中写入：
待解析页面：食物页关联页，页面id: 0:5。
更改0:2的文本为：
已解析页面：食物页，页面id：0:2，存在interactive id: [0:5]。
未发现0:5存在interactive字段。0:5解析结束。
更改0:4的文本为：
已解析页面：食物页关联页，页面id: 0:5，不存在interactive。。

完成后，再根据task.md中的待解析页面列表，依次解析数据生成组件代码。