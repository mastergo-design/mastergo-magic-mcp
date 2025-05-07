---
description:
globs:
alwaysApply: true
---

# MasterGo Component System Specification v1.0

## Core Contents

- Project Environment Setup
- Component Interaction Design
- Component Development Workflow

---

## Project Environment Setup

### Environment Check

Check if project is initialized:

- `package.json`
- TypeScript configuration
- Vite configuration
- VitePress configuration (`docs/.vitepress/`)
- Vue and testing dependencies

### Environment Initialization

Required steps:

```bash
npm init -y
npm install vue@latest typescript vite@latest vitepress@latest vitest@latest @vitejs/plugin-vue@latest
npm install -D @vue/test-utils jsdom @types/node
```

Required configuration files:

- `tsconfig.json`
- `vite.config.ts`
- `docs/.vitepress/config.ts`
- `vitest.config.ts`

### Project Structure

```
project-root/
├── docs/                # Component documentation
│   ├── .vitepress/      # VitePress configuration
│   ├── components/      # Component docs and demos
├── src/
│   ├── components/      # Component source code
│   ├── styles/          # Style files
├── __tests__/           # Component tests
```

### Required Scripts

```json
{
  "scripts": {
    "dev": "vitepress dev docs",
    "build": "vitepress build docs",
    "test": "vitest run",
    "test:ui": "vitest --ui"
  }
}
```

### Project Verification

**CRITICAL STEP**: After project initialization, scripts must be run to verify configuration:

1. Run the development server:

   ```bash
   npm run dev
   ```

2. Verify the test environment:

   ```bash
   npm run test
   ```

3. Ensure no errors appear in the console for each script
4. Resolve any errors before proceeding to component development
5. Project is considered properly initialized only when all scripts run without errors

---

## Component Interaction Design Specification

### Core Principles

- **CSS Priority**: Use CSS pseudo-classes for basic states
- **State Extension**: Allow overriding default states via props
- **Consistency**: Maintain consistent state management patterns
- **Performance Priority**: Minimize JavaScript state management

### State Priority

CSS Pseudo-classes > Props-specified States > JavaScript State Management

### Component Reuse Principles

Reuse decision priority:

1. Direct Use (when functionality completely matches)
2. Component Composition (implement by combining existing components)
3. Component Extension (add new functionality based on existing components)
4. Redevelopment (only when above methods are not feasible)

---

## Component Development Workflow

### Complete Process

```
[Environment Check] → [Project Verification] → [Component Analysis] → [User Confirmation] → [Test Generation] → [Component Development] → [Validation] → [Documentation & Preview]
```

### 1. Component Analysis

**Input**: Component JSON specification  
**Output**: Architecture document (`.mastergo/${componentName}-arch.md`)

#### Slot Analysis

AI must analyze component design and infer:

- Slots that may be needed
- Purpose of each slot
- Default content suggestions
- Optional/required status

#### Checklist

- [ ] Property analysis
- [ ] States and variants identification
- [ ] Common styles extraction
- [ ] Interface definition
- [ ] Slot definition

#### Architecture Document Verification

**CRITICAL BREAK POINT**: After generating the architecture document, execution must pause.

1. Present the architecture document to the user for review
2. Ask user to verify all aspects of the document:
   - Component properties and types
   - State definitions
   - Slot specifications
   - Component structure
   - Image assets and their paths
3. If user identifies issues:
   - Collect all feedback
   - Make required modifications to the architecture document
   - Present updated document for review
4. Repeat review cycle until user explicitly approves the document
5. Only proceed to Test Generation phase after user confirmation

#### Image Resource Handling

**CRITICAL STEP**: After user confirmation of the architecture document, and before proceeding to Test Generation:

1.  **Resource Inventory and Path Documentation**:

    - The architecture document must include an "Image Resources" section that clearly lists all necessary resources in a table format:

    ```markdown
    ## Image Resources

    ### Resource List and Paths

    | Icon Description | Original Path             | Target Path                                             | Icon Color Control                                   |
    | ---------------- | ------------------------- | ------------------------------------------------------- | ---------------------------------------------------- |
    | Close Icon       | `/original/path/icon.svg` | `src/components/${componentName}/images/icon-close.svg` | Dynamically controlled, defaults to match text color |
    | Other Icon       | ...                       | ...                                                     | ...                                                  |
    ```

2.  **Copy Images**:

    - Copy all necessary image resources listed in the architecture document to the component-specific directory.
    - Use semantic filenames such as `icon-close.svg`, `icon-success.svg`, `bg-header.png`, etc., ensuring the names clearly indicate the purpose of each image.
    - The target path must be `src/components/${componentName}/images/`. Create this directory if it doesn't exist.
    - Example:
      ```bash
      mkdir -p src/components/${componentName}/images
      cp /original/path/close-icon.svg src/components/${componentName}/images/icon-close.svg
      ```

3.  **SVG Image Import and Color Specification**:

    - The architecture document must clearly specify the import method and color control approach for SVG icons.
    - SVGs must be imported using the following method to ensure dynamic color control:

      ```typescript
      import CloseIcon from "./images/icon-close.svg?raw"; // ?raw ensures it's imported as a string
      ```

    - The architecture document must include code examples for SVG usage and color control:

      ````markdown
      ### Icon Import and Usage Method

      ```typescript
      // In ${componentName}.vue, import icons
      import CloseIcon from "./images/icon-close.svg?raw";
      import SuccessIcon from "./images/icon-success.svg?raw";
      ```
      ````

      Using SVGs in templates and controlling their color:

      ```html
      <template>
        <div class="icon-container" v-html="CloseIcon"></div>
      </template>

      <style scoped>
        .icon-container svg {
          fill: v-bind("dynamicColorVariable"); /* Dynamically bind color */
        }
        /* Or use CSS variables to control color */
        .icon-container svg {
          fill: var(--icon-color, currentColor);
        }
      </style>
      ```

    - For each SVG icon, the architecture document must clearly specify:
      1. Default color
      2. Whether the color is fixed or needs to be dynamically controlled
      3. Color variations in different states

### 2. Test Generation

**Input**: Approved architecture document  
**Output**: Component unit tests

#### Test Coverage

- All component properties
- All component states and behaviors
- Edge cases
- All inferred slots
- State management (hover, focus, active, disabled, etc.)

### 3. Component Development

**Input**: Architecture document and test cases  
**Output**: Functional component

#### Required Files

- `src/components/${componentName}/index.ts`
- `src/components/${componentName}/types.ts`
- `src/components/${componentName}/${componentName}.vue`

#### Development Method

- Test-driven development
- Must follow UI interaction design specifications
- Iterative implementation: Minimal code → Run tests → Refactor → Next test

### 4. Validation

- All tests pass
- Component visually matches design
- Component is accessible
- Responsive behavior is correct

### 5. Documentation & Preview

**Output**: VitePress documentation and interactive previews

#### Documentation Content

- Component overview
- API reference
- Interactive examples
- Complete slot documentation
- Various states and use cases demonstrations

#### Interactive Preview

````md
## Basic Usage

:::demo

```vue
<template>
  <ComponentName prop="value" />
</template>
```

:::
````

### Checkpoints

- **Environment**: Correct configuration, dependencies installed, documentation preview system working
- **Structure**: Files created, exports working, interfaces defined, slot definitions
- **Tests**: Coverage for all features, edge cases, slots and states
- **Implementation**: Renders correctly, properties work, state management complies with specifications, styles applied correctly, slot functionality works
- **Documentation**: Feature documentation complete, examples available, API reference complete, slot usage documentation complete
