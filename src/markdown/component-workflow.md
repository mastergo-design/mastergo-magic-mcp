---
description:
globs:
alwaysApply: true
---

# MasterGo Component System Specification v1.0

## System Identifier: SYS-COMP-001

## Document Contents

- [SYS-UI-DESIGN-001] Component UI Interaction Design Specification
- [SYS-WORKFLOW-001] Component Development Workflow Specification

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
[Analysis] → [Development] → [Validation] → [Documentation] → [Feedback Loop]
```

### 2. Phase One: Component Analysis and Architecture (Must Execute)

**Input**: Component JSON specification  
**Output**: Architecture document (`architecture/${componentName}-arch.md`)

#### 2.1 Checklist (AI Must Ensure All Are Completed)

- [ ] Property analysis completed
- [ ] States and variants identified
- [ ] Common styles extracted
- [ ] Component interfaces defined
- [ ] Architecture document approved (Must Execute: Wait for user confirmation to proceed to the next step, continue task after confirmation)

### 3. Phase Two: Component Development (Must Execute)

**Input**: Approved architecture document  
**Output**: Functional component (`src/components/${componentName}/`)

#### 3.1 Required Files (Path and Naming Conventions Must Be Followed)

- `src/components/${componentName}/index.ts` (Export)
- `src/components/${componentName}/types.ts` (Interfaces and types)
- `src/components/${componentName}/${componentName}.vue` (Component)

#### 3.2 UI Interaction Design Guidelines (Must Strictly Follow)

**Key Rule**: During component development, you **must** strictly follow the UI interaction design guidelines defined in `[SYS-UI-DESIGN-001]`.

#### 3.3 State Management Validation Checklist (AI Must Ensure All Pass)

- [ ] All common states primarily implemented using CSS pseudo-classes
- [ ] Component supports overriding default states through props
- [ ] All necessary mouse and keyboard interactions have appropriate state feedback
- [ ] State changes correctly blocked in disabled state
- [ ] Component states behave consistently under various conditions

### 4. Phase Three: Testing and Validation (Must Execute)

**Input**: Component implementation  
**Output**: Validated component and tests

#### 4.1 Test Framework Selection (Must Execute in Order)

1. **Check Project Test Framework**: You **must** first check if a test framework already exists in the current project

   - Check dependencies in `package.json`
   - Look for test configuration files in the project (such as `jest.config.js`, `vitest.config.js`, etc.)
   - Check the existing test file structure in the project

2. **Test Framework Decision**:
   - If the project already has a test framework, you **must** use the existing framework
   - If the project has no test framework, you **must** default to using vitest and add necessary configurations

#### 4.2 Required Files

- `__tests__/components/${componentName}/${componentName}.test.ts` (If using an existing framework, follow its naming conventions)

#### 4.3 Run Tests (Must Execute)

- If using an existing framework, you **must** use the project's existing test commands
- If using vitest, you **must** configure and run: `vitest run` or `vitest --ui`

### 5. Phase Four: Documentation and Showcase (Must Execute)

**Input**: Validated component  
**Output**: Documentation and live examples

#### 5.1 Required Files

- `docs/components/${componentName.toLowerCase()}.md`

### 6. Development Checkpoints (AI Must Check at Each Phase)

6.1 **Component Structure Checkpoint**

- All required files have been created
- Basic exports work normally
- TypeScript interfaces are defined

  6.2 **Implementation Checkpoint**

- Component renders correctly
- All properties work as expected
- State management complies with UI interaction design guidelines
- Styles are applied correctly

  6.3 **Testing Checkpoint**

- All tests pass
- Edge cases are covered
- No regression issues

  6.4 **Documentation Checkpoint**

- All functionality is documented
- Examples are available
- API reference is complete
