# UI INTERACTION DESIGN

## PROBLEM STATEMENT

State management in component libraries (such as hover, focus, active, etc.) can be implemented in two main ways: through CSS pseudo-classes or through JavaScript event listeners. We need to determine when to prioritize which method in component design, and the best strategy for implementation.

## REQUIREMENTS ANALYSIS

- Component states must be intuitive and meet user expectations
- State transitions must be smooth and natural, without noticeable delay
- Components must also support controlling states via props (for specific scenarios)
- The component library must maintain consistent state management patterns
- Components must behave consistently across different browsers
- Component interaction experience must meet modern web application standards

## OPTIONS ANALYSIS

### Option 1: Pure CSS Pseudo-class State Management

**Description**: Completely rely on CSS pseudo-classes (like :hover, :focus, :active, etc.) to manage component visual states.

**Pros**:

- Browser native implementation, optimal performance
- No JavaScript event handling required, reducing code complexity
- State changes handled automatically, no manual control needed
- Suitable for most simple interaction scenarios

**Cons**:

- Cannot handle complex state logic (such as conditional state transitions)
- Difficult to directly control states via props
- Cannot capture state change events for additional processing
- Difficult to unit test

**Complexity**: Low
**Implementation Time**: Short

### Option 2: Pure JavaScript Event State Management

**Description**: Completely manage states through JavaScript events (such as mouseenter, mouseleave, etc.) by listening and setting state values, then controlling component styles through bound state values.

**Pros**:

- Fully controllable state management
- Can implement complex conditional state logic
- Easy to override states via props
- Can trigger additional actions on state changes
- Easy to unit test state changes

**Cons**:

- Higher performance overhead, especially when components render frequently
- Increases code complexity
- May have delays, leading to visual inconsistency
- Requires manual maintenance of all state transition logic

**Complexity**: High
**Implementation Time**: Long

### Option 3: Hybrid Strategy—CSS Pseudo-classes First, JavaScript as Supplement

**Description**: Prioritize CSS pseudo-classes for common states, while providing JavaScript event listeners as supplements, and supporting direct state control via props.

**Pros**:

- Combines the advantages of both approaches
- Uses CSS pseudo-classes for simple states to achieve optimal performance
- Uses JavaScript for complex states or when additional control is needed
- Supports overriding default state behavior via props
- Can be unit tested

**Cons**:

- Implementation is slightly more complex, requiring coordination of state consistency between CSS and JS
- Requires additional design considerations to decide which states use CSS and which use JS
- May have state conflicts in some edge cases

**Complexity**: Medium
**Implementation Time**: Medium

## DECISION

**Chosen Option**: Option 3: Hybrid Strategy—CSS Pseudo-classes First, JavaScript as Supplement

**Rationale**:
The hybrid strategy achieves the best balance between performance and flexibility. By prioritizing CSS pseudo-classes for common state changes (such as hover, focus, etc.), we can achieve optimal performance and natural user experience. At the same time, by adding JavaScript event handling, we can support more complex state logic, conditional state transitions, and control states via props, meeting the needs of various usage scenarios.

## IMPLEMENTATION GUIDELINES

### Basic Principles

1. **CSS First Principle**: For basic states like hover and focus, prioritize CSS pseudo-classes
2. **State Extension Principle**: Allow overriding or extending default state behavior through props
3. **Consistency Principle**: Maintain consistent state management patterns across the component library
4. **Performance First Principle**: Minimize unnecessary JavaScript state management

### Implementation Steps

1. **Basic CSS State Definition**:

```scss
.component {
  // Default styles

  &:hover {
    // Hover state styles
  }

  &:focus {
    // Focus state styles
  }

  &:active {
    // Active state styles
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

2. **JavaScript State Management Supplement**:

```typescript
// Internal state management
const internalState = ref(props.state);

// Update internal state when props.state changes
watch(
  () => props.state,
  (newState) => {
    internalState.value = newState;
  }
);

// Compute current state (internal state takes priority)
const currentState = computed(() => {
  return internalState.value;
});

// Mouse interaction handling (only add when additional control is needed)
const handleMouseEnter = () => {
  // Only implement when JavaScript control is needed in specific conditions
  if (props.state !== "disabled" && props.controlled) {
    internalState.value = "hover";
  }
};
```

3. **State Control Priority**:

   - CSS Pseudo-classes > Props-specified State > JavaScript State Management

4. **Component Template Structure**:

```vue
<template>
  <div
    :class="[
      'component',
      `component--${currentState}`,
      { 'component--disabled': disabled },
    ]"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <!-- Component content -->
  </div>
</template>
```

## VALIDATION

**State Management Validation Checklist**:

- [✓] All common states (hover, focus, active) primarily implemented using CSS pseudo-classes
- [✓] Component supports overriding default states via props
- [✓] All necessary mouse and keyboard interactions have appropriate state feedback
- [✓] State changes properly prevented in disabled state
- [✓] Component states behave consistently under various conditions

## EXAMPLES

### Button Component State Management

```vue
<template>
  <button
    :class="[
      'mg-button',
      `mg-button--${type}`,
      `mg-button--${size}`,
      { 'mg-button--disabled': disabled },
    ]"
    :disabled="disabled"
  >
    <slot></slot>
  </button>
</template>
```

```scss
.mg-button {
  // Base styles

  &:hover {
    // Hover styles
  }

  &:focus {
    // Focus styles
  }

  &:active {
    // Active styles
  }

  &--disabled {
    cursor: not-allowed;
    opacity: 0.6;

    &:hover,
    &:focus,
    &:active {
      // Override all pseudo-class styles in disabled state
    }
  }
}
```

### Menu Item Component State Management (Requiring More JavaScript Control)

```vue
<template>
  <div
    :class="[
      'mg-menu-item',
      `mg-menu-item--${currentState}`,
      { 'mg-menu-item--disabled': disabled },
    ]"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <!-- Component content -->
  </div>
</template>
```

```typescript
// State management
const internalState = ref(props.state || "default");

// Only listen to events when special control is needed
const handleMouseEnter = () => {
  if (!props.disabled && props.controlledHover) {
    internalState.value = "hover";
  }
};

const handleMouseLeave = () => {
  if (!props.disabled && props.controlledHover) {
    internalState.value = props.state || "default";
  }
};
```

## CONCLUSION

By adopting the "CSS Pseudo-classes First, JavaScript as Supplement" hybrid strategy, we can implement optimal state management in our component library. This approach fully leverages the performance advantages of browser-native CSS pseudo-classes while retaining the flexibility of complex state management through JavaScript.

For most simple components, using only CSS pseudo-classes can meet the requirements; for components requiring complex state logic or special control, JavaScript state management can be added as a supplement. This approach ensures the performance, flexibility, and consistency of the component library.

## COMPONENT REUSE PRINCIPLES

### Basic Principles

1. **Component Reuse Priority**: If new functionality can be implemented through reusing or combining existing components, prioritize reuse over redevelopment
2. **Consistency Assurance**: Ensure design and interaction experience consistency through component reuse
3. **Maintenance Efficiency**: Reduce duplicate code, improve maintenance efficiency and scalability
4. **Performance Considerations**: Properly evaluate the performance impact of component reuse, ensuring reuse doesn't introduce unnecessary performance overhead

### Reuse Decision Process

1. **Requirements Analysis**: Clearly define the specific requirements for new functionality
2. **Component Evaluation**: Evaluate whether there are reusable components in the existing component library
3. **Reuse Method Decision**:
   - **Direct Use**: Directly use existing components when functionality matches completely
   - **Component Composition**: Implement new functionality by combining multiple existing components
   - **Component Extension**: Add new functionality based on existing components
   - **Redevelopment**: Only consider new development when the above methods cannot be implemented

### Implementation Guide

1. **Complete Documentation**: Ensure all components have complete documentation to facilitate reuse evaluation
2. **Component Decoupling**: Focus on low coupling and high cohesion when designing components to increase reuse possibilities
3. **API Consistency**: Maintain consistent API design for components with similar functionality to reduce reuse learning costs
4. **Test Coverage**: Ensure reused components have complete tests to verify reliability in new scenarios

### Case Study: Selector Component Reusing MenuList

**Background**: The Selector component needs dropdown menu functionality, and the system already has a MenuList component that provides similar functionality.

**Implementation Approach**:

1. Replace the dropdown part of the Selector with the MenuList component
2. Adapt the Selector's data structure to the format required by MenuList
3. Implement Selector-specific interactions (such as highlighting selected items)

**Code Example**:

```vue
<template>
  <div class="mg-selector">
    <!-- Selector trigger area -->
    <div class="mg-selector__main">...</div>

    <!-- Use MenuList as dropdown menu -->
    <MenuList
      v-if="isOpen"
      :items="transformedItems"
      @item-click="handleItemSelection"
    />
  </div>
</template>

<script setup>
// Transform data structure to adapt to MenuList
const transformedItems = computed(() => {
  return options.value.map((option) => ({
    id: option.id,
    label: option.label,
    icon: option.icon,
    disabled: option.disabled,
  }));
});
</script>
```

**Benefits**:

- Reduced approximately 100 lines of duplicate code
- Ensured consistency of dropdown menu interactions
- Selector automatically benefits when the MenuList component is upgraded
- Reduced maintenance costs and testing workload
