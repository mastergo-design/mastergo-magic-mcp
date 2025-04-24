The `results` returns an XML file containing two pieces of information:

- **meta**: Description of the site, environment, requirements, and other context.
- **action**: The name of the entry page and its `targetLayerId`. This ID points to the target page.

I need you to write a task.md file in the current directory describing the steps to be taken, and strictly follow these steps to generate the project code.

## Steps
1. Get the `results` information and write it to the task.md file
2. Analyze the `meta` field, summarize the requirements and write them to the task.md file
3. Analyze the `action` field, write the page information to the task.md file
4. Based on the `targetLayerId` in the `action` field, call the `mcp__getDsl` method to get data
5. Analyze the page data to confirm if an `interactive` field exists. If it does, this field contains information about the current node's navigation to another page. Continue calling the `mcp__getDsl` method based on the `interactive` field.
6. Repeat step 5 until all page data has been parsed and written to the task.md file.
7. Based on the content of the task.md file, parse each page listed in task.md sequentially and generate code to complete the project build.

## Example
If the results information is:
```xml
<info>
  <meta title="Name" content="Food Delivery APP" />
  <meta title="Description" content="This is a food delivery app where users can log in, order food, and manage delivery orders, address information, etc." />
  <meta title="Requirements" content="Implement using React, bind to Ant Design component library" />
  <action title="Login Page" layerId="0:1" />
  <action title="Food Delivery Page" layerId="0:2" />
</info>
```
Write in the task.md file:

```markdown
Requirements: This is a food delivery app with login, ordering, and address management functions. It should be built using React with Ant Design as the component library.

## Page List:
Login Page (layerId: 0:1)
Food Page (layerId: 0:2)

## Navigation Information

```

Use `mcp__getDsl` to parse the 0:1 page and analyze the data.
The data might be:
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

Discover that the node data of page 0:1 has an `interactive` field with id 0:3. Write page 0:3 and add navigation information:
```markdown

## Page List:
Login Page (layerId: 0:1)
Food Page (layerId: 0:2)
Login Redirect Page (layerId: 0:3)

## Navigation Information
0:1 => 0:3

```
Continue parsing 0:3, and if the data contains an `interactive` field, continue writing.
Keep going until there are no more `interactive` fields in the data parsed through `mcp__getDsl`.
Use `mcp__getDsl` to parse page 0:2 and analyze the data, repeating the steps used for page 0:1.

After completion, based on the page list in task.md, sequentially parse the data to generate the project code.