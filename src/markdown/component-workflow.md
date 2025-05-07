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

#### Module System

- Project uses ES Modules (ESM) format
- Package.json should include `"type": "module"`
- All imports/exports should use ESM syntax

##### TSConfig for ESM

Example `tsconfig.json` configuration for ESM:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Node",
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,
    "esModuleInterop": true
    // Other options...
  }
}
```

### Project Structure

```
project-root/
├── docs/                # Component documentation
│   ├── .vitepress/      # VitePress configuration
│   ├── components/      # Component docs and demos
├── src/
│   ├── components/      # Component source code
│   │   └── ${componentName}/  # Each component has its own directory
│   │       ├── images/  # Component-specific images
│   │       ├── index.ts
│   │       ├── types.ts
│   │       └── ${componentName}.vue
│   ├── styles/          # Style files
├── __tests__/           # Component tests
├── .mastergo/           # MasterGo configuration and resources
│   ├── images/          # Component images and icons
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

#### Resource Path Management

- All component icons and image resources must be stored in the `.mastergo/images` directory
- The architecture document must specify the exact path for each icon and image using the workspace root path: `${rootPath}/.mastergo/images/<filename>`
- The architecture document must include a complete list of all required image resources with descriptions of how each is used
- Ensure filenames are unique to avoid conflicts
- Supported image formats: PNG, JPG, SVG
- SVG icons should be preferred to ensure clarity and scalability

##### Image Resource Documentation Template

The architecture document should include an image resource section following this format:

```markdown
## Required Image Resources

| Filename        | Path                                         | Description       | Usage                        | Color (for SVGs)       |
| --------------- | -------------------------------------------- | ----------------- | ---------------------------- | ---------------------- |
| logo.svg        | ${rootPath}/.mastergo/images/logo.svg        | Company logo      | Used in header component     | #1a2b3c                |
| arrow-right.svg | ${rootPath}/.mastergo/images/arrow-right.svg | Right arrow icon  | Used in navigation buttons   | currentColor (primary) |
| placeholder.png | ${rootPath}/.mastergo/images/placeholder.png | Placeholder image | Used when content is loading | N/A                    |
```

For SVG resources, the color column must specify either:

- A specific hex/rgb color value if the SVG should always use that color
- "currentColor" with an indication of which theme color it should inherit (e.g., primary, secondary)

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
- [ ] Resource path verification for icons and images
- [ ] Complete list of required image resources with usage descriptions

#### Architecture Document Verification

**CRITICAL BREAK POINT**: After generating the architecture document, execution must pause.

1. Present the architecture document to the user for review
2. Ask user to verify all aspects of the document:
   - Component properties and types
   - State definitions
   - Slot specifications
   - Component structure
   - Resource paths for icons and images
3. If user identifies issues:
   - Collect all feedback
   - Make required modifications to the architecture document
   - Present updated document for review
4. Repeat review cycle until user explicitly approves the document
5. Only proceed to Test Generation phase after user confirmation

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
- `src/components/${componentName}/images/` - Directory for component-specific images

#### Resource Management

- Only images and icons specifically mentioned in the component architecture document should be copied from `.mastergo/images/` to the component's `images/` directory
- Do not copy all resources, only those required by the specific component
- The architecture document must explicitly list all required image resources
- Images must be imported using ESM import syntax
- For TypeScript type safety, use image imports with type declarations
- This ensures component portability, improves loading performance, and enables build-time optimizations

##### SVG Color and Import Requirements

- **Color Standards**:

  - All SVGs must use `currentColor` for fill and stroke attributes
  - The architecture document MUST specify the intended color for each SVG
  - Color should be applied via CSS or component props, not hardcoded in SVG

- **Icon Alignment**:

  - Icons must be centered within their container elements
  - Use CSS flexbox or grid for consistent centering across components
  - For button or interactive elements with icons, maintain proper alignment with text
  - Ensure icons maintain proper proportions and alignment in all responsive states

- **Import Method**:

  - SVGs must be imported as raw strings using the `?raw` query parameter:
    ```typescript
    import iconSvg from "./images/icon.svg?raw";
    ```
  - This enables direct insertion of SVG markup and dynamic property modification
  - Raw strings should be sanitized before insertion to prevent XSS vulnerabilities

- **Usage Example**:

  ```typescript
  // Importing SVG as raw string
  import closeSvg from './images/close.svg?raw';

  // In component
  const iconColor = 'var(--color-primary)';
  const sanitizedSvg = sanitizeSvg(closeSvg); // Implement sanitization

  // Using with v-html (ensure sanitization first)
  <div v-html="sanitizedSvg" :style="{ color: iconColor }"></div>
  ```

#### Development Method

- Test-driven development
- Must follow UI interaction design specifications
- Iterative implementation: Minimal code → Run tests → Refactor → Next test

### 4. Validation

- All tests pass
- Component visually matches design
- Component is accessible
- Responsive behavior is correct
- Image and icon imports use correct ESM syntax
- Resources are properly bundled during build process

### 5. Documentation & Preview

**Output**: VitePress documentation

#### Documentation Content

- Interactive component previews with fully functional HTML elements
- Component overview
- API reference
- Interactive examples
- Complete slot documentation
- Various states and use cases demonstrations

### Checkpoints

- **Environment**: Correct configuration, dependencies installed, documentation preview system working
- **Structure**: Files created, exports working, interfaces defined, slot definitions
- **Tests**: Coverage for all features, edge cases, slots and states
- **Implementation**: Renders correctly, properties work, state management complies with specifications, styles applied correctly, slot functionality works
- **Documentation**: Feature documentation complete, examples available, API reference complete, slot usage documentation complete
