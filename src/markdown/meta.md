`results`返回的是一个xml文件，这个xml文件中包含两个信息。

- **meta**: 对站点的描述，环境，要求等上下文。
- **action**: 对应的入口页面的名称以及`targetLayerId`。该id为指向的页面id。

我需要你根据下面的步骤在当前目录下写一份task.md文件描述需要做的步骤，并严格按照这些步骤执行最终生成项目代码。

## 步骤
1. 获取`results`信息，并将信息写入task.md文件
2. 分析`meta`字段，将需求描述总结写入task.md文件
3. 分析`action`字段，将页面信息写入task.md文件中
4. 根据`action`字段中的`targetLayerId`，调用`mcp__getDsl`方法，获取数据
5. 分析页面数据，确认是否存在`interactive`字段，如果存在，则该字段为当前节点跳转页面的信息。根据`interactive`字段继续调用`mcp__getDsl`方法。
6. 重复5步骤，直到有的页面数据都已经解析，并写入task.md文件。
7. 根据task.md文件中的内容，依次解析task.md中的页面并生成代码。完成项目的构建。

## 例子
获取到results信息为：
```xml
<info>
  <meta title="Name" content="Food Delivery APP" />
  <meta title="Description" content="This is a food delivery app where users can log in, order food, and manage delivery orders, address information, etc." />
  <meta title="Requirements" content="Implement using React, bind to Ant Design component library" />
  <action title="Login Page" layerId="0:1" />
  <action title="Food Delivery Page" layerId="0:2" />
</info>
```
在task.md文件中写入：



```markdown
需求描述：这是一个外卖app，他包含了登录，订餐以及管理地址等功能。需要使用react构建，并使用ant design做组件库。

## 页面列表：
登录页（layerId: 0:1）
食物页（layerId: 0:2）

## 跳转信息

```

使用`mcp__getDsl`解析0:1页面。并解析数据
数据可能是：
```json
{
    nodes: [{
        id: "0:1",
        // ...others
        children: [{
            id: "1:12",
            interactive: [
                type: "navigation",
                targetLayerId: "0:3"
            ]
        }]
    }]
}
```

发现0:1的页面的node节点数据有存在`interactive`字段。id为0:3。写入0:3页面，并添加跳转信息
```markdown

## 页面列表：
登录页（layerId: 0:1）
食物页（layerId: 0:2）
登录页跳转页（layerId: 0:3）

## 跳转信息
0:1 => 0:3

```
继续解析0:3，如果数据存在`interactive`字段，则继续写入。
知道通过`mcp__getDsl`解析的数据中不存在`interactive`字段为止。
使用`mcp__getDsl`解析0:2页面。并解析数据，重复解析0:1页面的步骤。

完成后，再根据task.md中的页面列表，依次解析数据生成项目代码。