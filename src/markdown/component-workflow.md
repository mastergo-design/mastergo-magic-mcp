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

1.  **Confirm Image Paths**: Carefully check that all image resource paths referenced in the architecture document are correct.
2.  **Copy Images**:
    - Copy all used images (including SVG, PNG, JPG, etc.) to the `images` folder within the component directory. For example: `src/components/${componentName}/images/`.
    - If the `images` folder does not exist, create it.
3.  **SVG Image Import and Color Specification**:

    - For SVG type images, it is recommended to import them in the following way to dynamically control their color:
      ```typescript
      import CloseIcon from "./images/close-icon.svg?raw"; // ?raw ensures it's imported as a string
      ```
    - When using SVGs in component templates, their color can be specified via CSS or by directly modifying the `fill` or `stroke` attributes in the SVG string. For example, in a Vue component:

      ```html
      <template>
        <div v-html="CloseIcon" class="icon-class-to-color"></div>
        <!-- or manipulate the string directly if needed -->
      </template>

      <style scoped>
        .icon-class-to-color svg {
          fill: currentColor; /* Or a specific color */
        }
        /* Or target specific paths if the SVG structure is known */
        .icon-class-to-color svg path {
          fill: var(--icon-color, #000); /* Example using CSS custom property */
        }
      </style>
      ```

    - Ensure that the architecture document specifies which SVG icons require dynamic color control, their target colors, or the method of color control.

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
