The `results` returns an XML file, which contains two types of information:

- **meta**: Describes the site, environment, requirements, and other context.
- **action**: Corresponds to the entry page name and `targetLayerId`, which is the ID of the target page.

I need you to write a task.md file in the current directory according to the following steps, and strictly follow these steps to generate the final project code.

## Steps
1. Obtain the `results` information, extract the `meta` and `action` data, and create a new `task.md` file.
2. Analyze the `meta` field, summarize the requirement description, and write it into task.md.
3. Analyze the `action` field, and write the page information into task.md.
4. For each `targetLayerId` from the `action` field, use the section-by-section workflow to get page data:
   - **Step 4a**: Call `mcp__getDesignSections` WITHOUT `sectionIndex` to get the list of all sections.
   - **Step 4b**: For each section (index 0 to N-1), call `mcp__getDesignSections` WITH `sectionIndex=i` to get the full DSL.
   - **Note**: You MUST fetch ALL sections. Do NOT skip any section index.
5. Analyze the page data to check if there is an `interactive` field. If it exists, this field contains information about the current node's navigation to another page. You must continue to get the target page data using the section-by-section workflow (repeat step 4).
6. Repeat step 5 until all page data has been parsed and written into task.md.
7. According to the content in task.md, sequentially parse the pages listed in task.md and generate code. Complete the project construction.

## Example
**Note**: Be sure to follow the order described in the example. Ensure that all page information is obtained!


Suppose the obtained results are:
```xml
<info>
  <meta title="Name" content="Food Delivery APP" />
  <meta title="Description" content="This is a food delivery app where users can log in, order food, and manage delivery orders, address information, etc." />
  <meta title="Requirements" content="Implement using React, bind to Ant Design component library" />
  <action title="Login Page" layerId="0:1" />
  <action title="Food Delivery Page" layerId="0:2" />
</info>
```
Write the following into task.md:




```markdown
Requirement Description: This is a food delivery app, which includes login, food ordering, and address management features. It should be built using React and use Ant Design as the component library.

## Page List:
Login Page (layerId: 0:1)
Food Delivery Page (layerId: 0:2)

## Navigation Information


```

Use `mcp__getDesignSections` to get the section list for page 0:1 (without sectionIndex), then fetch each section's DSL by calling with sectionIndex=0, 1, ... until all sections are fetched.

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

if you find that the node data of page 0:1 contains the `interactive` field with id 0:3, write the 0:3 page and add the navigation information:
```markdown

## Page List:
Login Page (layerId: 0:1)
Food Delivery Page (layerId: 0:2)
Login Page Navigation Page (layerId: 0:3)

## Navigation Information
0:1 => 0:3

```
Continue to get page 0:3 data using the section-by-section workflow. If the data contains the `interactive` field, continue writing.
Repeat this process until the page data no longer contains the `interactive` field.
Then, process the 0:2 page and repeat the steps for the 0:1 page.

After completion, generate the project code sequentially according to the page list in task.md.
