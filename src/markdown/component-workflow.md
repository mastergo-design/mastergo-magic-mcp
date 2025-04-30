---
description:
globs:
alwaysApply: true
---

# MasterGo Component System Specification v1.0

## System Identifier: SYS-COMP-001

## Document Contents

- [SYS-ENV-001] Project Environment Setup Specification
- [SYS-UI-DESIGN-001] Component UI Interaction Design Specification
- [SYS-WORKFLOW-001] Component Development Workflow Specification

---

## [SYS-ENV-001] Project Environment Setup Specification

### 1. Project Initialization (Must Check and Execute If Needed)

**Goal**: Ensure the project has all necessary tools and configurations for component development

#### 1.1 Environment Check Process (AI Must Execute)

- Check if the project has already been initialized by looking for:
  - `package.json` file
  - TypeScript configuration (`tsconfig.json`)
  - Vite configuration (`vite.config.ts`)
  - VitePress configuration (`docs/.vitepress/` directory)
  - Vue and testing dependencies

#### 1.2 Project Initialization Process (Execute Only If Not Already Initialized)

**Manual Setup Steps**:

1. Initialize package.json:

   ```bash
   npm init -y
   ```

2. Install core dependencies:

   ```bash
   npm install vue@latest typescript vite@latest vitepress@latest vitest@latest @vitejs/plugin-vue@latest
   ```

3. Install development dependencies:

   ```bash
   npm install -D @vue/test-utils jsdom @types/node
   ```

4. Create configuration files:
   - `tsconfig.json` for TypeScript configuration
   - `vite.config.ts` for Vite configuration
   - `docs/.vitepress/config.ts` for VitePress configuration
   - `vitest.config.ts` for testing configuration

#### 1.3 Project Structure Setup

```
project-root/
├── docs/
│   ├── .vitepress/
│   │   ├── config.ts
│   │   ├── theme/
│   │   │   └── index.ts
│   ├── index.md
│   ├── components/
│   │   └── index.md
├── src/
│   ├── components/
│   ├── styles/
│   └── index.ts
├── __tests__/
│   └── components/
├── package.json
├── tsconfig.json
├── vite.config.ts
└── vitest.config.ts
```

#### 1.4 Required Scripts

```json
{
  "scripts": {
    "dev": "vitepress dev docs",
    "build": "vitepress build docs",
    "preview": "vitepress preview docs",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui",
    "build:lib": "vite build"
  }
}
```

#### 1.5 VitePress Component Demo Setup

Setup must include:

- Component demo container
- Code highlighting
- Interactive examples

---

## [SYS-UI-DESIGN-001] Component UI Interaction Design Specification

### 1. Specification Purpose

Define standard implementation methods for state management in component libraries to ensure consistency and high performance in interaction experiences.

### 2. Core Decisions

**State Management Strategy: Hybrid Strategy—CSS Pseudo-classes First, JavaScript as Supplement**

### 3. Mandatory Execution Principles

3.1 **CSS Priority Principle**: For basic states such as `hover`, `focus`, etc., you **must** prioritize implementation using CSS pseudo-classes.  
3.2 **State Extension Principle**: You **must** allow overriding or extending default state behavior through props.  
3.3 **Consistency Principle**: You **must** maintain consistent state management patterns throughout the component library.  
3.4 **Performance Priority Principle**: You **must** minimize unnecessary JavaScript state management.

### 4. Implementation Specifications

#### 4.1 CSS State Definition (Must Reference)

```scss
.component {
  // Default styles

  &:hover {
    /* Hover state styles */
  }
  &:focus {
    /* Focus state styles */
  }
  &:active {
    /* Active state styles */
  }

  &--disabled {
    // Disabled state styles
    &:hover,
    &:focus,
    &:active {
      // Override other pseudo-classes in disabled state
    }
  }
}
```

#### 4.3 State Control Priority (Must Follow)

CSS Pseudo-classes > Props-specified States > JavaScript State Management

### 5. Component Reuse Principles (Must Adhere)

5.1 **Reuse Priority Principle**: If new functionality can be implemented through reuse or combination of existing components, you **must** prioritize reuse.  
5.2 **Consistency Guarantee**: Through component reuse, you **must** ensure consistency in design and interaction experience.  
5.3 **Maintenance Efficiency**: By reducing redundant code through reuse, you **must** consider maintenance efficiency and scalability.  
5.4 **Performance Considerations**: You **must** properly evaluate the performance impact of component reuse.

### 6. Reuse Decision Process (AI Must Follow)

6.1 **Requirements Analysis**: You **must** clearly define the specific requirements of the new functionality.  
6.2 **Component Evaluation**: You **must** evaluate whether there are reusable components in the existing component library.  
6.3 **Reuse Method Decision**: You **must** decide on the reuse method according to the following priorities:

- **Direct Use**: When functionality completely matches
- **Component Composition**: Implementation through combining multiple existing components
- **Component Extension**: Adding new functionality based on existing components
- **Redevelopment**: Consider only when the above methods are not feasible

---

## [SYS-WORKFLOW-001] Component Development Workflow Specification

### 1. Workflow Overview

```
[Environment Check] → [Analysis] → [Test Generation] → [Development] → [Validation] → [Documentation & Preview] → [Feedback Loop]
```

### 2. Phase Zero: Environment Check (Must Execute)

**Input**: Project repository  
**Output**: Fully configured development environment

- AI must check if the project environment meets the requirements defined in `[SYS-ENV-001]`
- If the environment is not properly set up, AI must execute the setup process before proceeding

### 3. Phase One: Component Analysis and Architecture (Must Execute)

**Input**: Component JSON specification  
**Output**: Architecture document (`.mastergo/${componentName}-arch.md`)

#### 3.1 Slot Analysis and Inference (AI Must Execute)

- AI must analyze the component design and automatically infer the slots that the component may need
- Infer appropriate slots based on the component's functionality, structure, and purpose
- The inference process must consider the following factors:
  - Variable areas within the component
  - Content variation needs in different usage scenarios
  - Component extensibility requirements
  - Common slot patterns in similar components
- Inference results must be included in the architecture document and include at least:
  - Name and purpose of each slot
  - Default content suggestions for each slot
  - Optional/required status of each slot

#### 3.2 Checklist (AI Must Ensure All Are Completed)

- [ ] Property analysis completed
- [ ] States and variants identified
- [ ] Common styles extracted
- [ ] Component interfaces defined
- [ ] Slot inference and definition completed
- [ ] Architecture document approved (Must Execute: Wait for user confirmation to proceed to the next step, continue task after confirmation)

### 4. Phase Two: Test Generation (Must Execute)

**Input**: Approved architecture document  
**Output**: Component unit tests (`__tests__/components/${componentName}/`)

#### 4.1 Test Framework Selection (Must Execute in Order)

1. **Check Project Test Framework**: You **must** first check if a test framework already exists in the current project

   - Check dependencies in `package.json`
   - Look for test configuration files in the project (such as `jest.config.js`, `vitest.config.js`, etc.)
   - Check the existing test file structure in the project

2. **Test Framework Decision**:
   - If the project already has a test framework, you **must** use the existing framework
   - If the project has no test framework, you **must** default to using vitest and add necessary configurations

#### 4.2 Required Test Files

- `__tests__/components/${componentName}/${componentName}.test.ts` (If using an existing framework, follow its naming conventions)

#### 4.3 Test Case Development (Must Follow TDD Principles)

- Tests must be based on the architecture document, not the implementation
- Test cases must validate all component properties, states, and behaviors
- Edge cases and error conditions must be included
- The tests should serve as a specification for the implementation

#### 4.4 Slot Testing (Must Execute)

- Test cases must be written for all inferred and implemented slots
- Tests must include the following scenarios:
  - Default rendering when no slot content is provided
  - Rendering effect when custom content is provided
  - Correct handling of nested slots
  - Normal rendering of slot content in different states

#### 4.5 State Management Testing (Must Execute)

- State tests must verify:
  - All common states (hover, focus, active, disabled) work correctly
  - State transitions behave as expected
  - States can be overridden through props
  - States behave consistently across various scenarios

#### 4.6 Checkpoint (AI Must Ensure All Are Completed)

- [ ] Test framework is properly configured
- [ ] All component properties have test coverage
- [ ] All component states have test coverage
- [ ] All component slots have test coverage
- [ ] Tests are well-structured and follow project conventions

### 5. Phase Three: Component Development (Must Execute)

**Input**: Architecture document and test cases
**Output**: Functional component (`src/components/${componentName}/`)

#### 5.1 Required Files (Path and Naming Conventions Must Be Followed)

- `src/components/${componentName}/index.ts` (Export)
- `src/components/${componentName}/types.ts` (Interfaces and types)
- `src/components/${componentName}/${componentName}.vue` (Component)

#### 5.2 UI Interaction Design Guidelines (Must Strictly Follow)

**Key Rule**: During component development, you **must** strictly follow the UI interaction design guidelines defined in `[SYS-UI-DESIGN-001]`.

#### 5.3 Slot Implementation (Must Execute)

- Implement all necessary slots based on the slots inferred in the analysis phase
- Slot implementation must follow these principles:
  - Provide reasonable default content for each slot
  - Add necessary class names for style customization
  - Provide appropriate fallback handling

#### 5.4 Development Against Tests (Must Execute)

- Implementation must pass all tests defined in Phase Two
- Development should be iterative:
  1. Implement the minimum code needed to pass a test
  2. Run the tests to verify
  3. Refactor as needed while maintaining passing tests
  4. Move to the next test

#### 5.5 Implementation Checklist (AI Must Ensure All Pass)

- [ ] All common states primarily implemented using CSS pseudo-classes
- [ ] Component supports overriding default states through props
- [ ] All necessary mouse and keyboard interactions have appropriate state feedback
- [ ] State changes correctly blocked in disabled state
- [ ] Component states behave consistently under various conditions
- [ ] All slots render correctly in different states
- [ ] Component passes all unit tests

### 6. Phase Four: Validation (Must Execute)

**Input**: Implemented component  
**Output**: Validated component

#### 6.1 Run Tests (Must Execute)

- If using an existing framework, you **must** use the project's existing test commands
- If using vitest, you **must** configure and run: `vitest run` or `vitest --ui`

#### 6.2 Verification Checklist (AI Must Complete)

- [ ] All tests pass
- [ ] Component visually matches the design
- [ ] Component is accessible
- [ ] Component works across required browsers/devices
- [ ] Responsive behavior works as expected

### 7. Phase Five: Documentation and Preview (Must Execute)

**Input**: Validated component  
**Output**: VitePress documentation and interactive preview

#### 7.1 Required Files

- `docs/components/${componentName.toLowerCase()}.md`
- `docs/components/demos/${componentName.toLowerCase()}/`

#### 7.2 VitePress Component Documentation (Must Include)

- Documentation must be implemented as a VitePress page
- Must follow the structure and styling of existing documentation (if any)
- Must use frontmatter for proper indexing and metadata

```md
---
title: ComponentName
description: Brief description of the component
---

# ComponentName

[Component description and overview]
```

#### 7.3 Component Interactive Preview (Must Implement)

- Each component must have interactive previews
- Previews must be implemented using VitePress's component demo capabilities
- Code examples must be displayed alongside the rendered component
- Multiple examples should demonstrate different states, variants, and use cases

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

#### 7.4 Slot Documentation (Must Include)

The documentation must include the following:

- Complete list of all available slots
- Purpose and examples for each slot
- Description of slot default content
- Best practices for combining slots
- At least one interactive example demonstrating the usage of each slot

#### 7.5 Component Preview Testing

- All examples must be verified to work correctly
- Examples must accurately demonstrate the component's capabilities
- Ensure code snippets match the actual implementation

### 8. Development Checkpoints (AI Must Check at Each Phase)

8.1 **Environment Checkpoint**

- Development environment is properly configured
- All required tools and dependencies are installed
- Documentation preview system is working

  8.2 **Component Structure Checkpoint**

- All required files have been created
- Basic exports work normally
- TypeScript interfaces are defined
- Slot definitions are complete and reasonable

  8.3 **Test Coverage Checkpoint**

- Tests exist for all component features
- Edge cases are covered
- Tests are comprehensive for all slots and states

  8.4 **Implementation Checkpoint**

- Component renders correctly
- All properties work as expected
- State management complies with UI interaction design guidelines
- Styles are applied correctly
- All slot functionality works normally and has reasonable default content
- Component passes all unit tests

  8.5 **Documentation Checkpoint**

- All functionality is documented
- Interactive examples are available
- API reference is complete
- Slot usage documentation is complete with examples
- Documentation renders correctly in VitePress
- Component previews work properly
