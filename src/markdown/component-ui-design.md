# UI INTERACTION DESIGN

## PROBLEM STATEMENT

组件库中的状态（如 hover、focus、active 等）管理有两种主要实现方式：通过 CSS 伪类或通过 JavaScript 事件监听。我们需要确定在组件设计中何时应该优先使用哪种方式，以及具体实现的最佳策略。

## REQUIREMENTS ANALYSIS

- 组件状态必须直观且符合用户预期
- 状态变化必须流畅自然，无明显延迟
- 组件必须同时支持通过 props 控制状态（用于特定场景）
- 组件库必须保持一致的状态管理模式
- 组件必须在不同浏览器中保持一致的行为
- 组件互动体验必须符合现代 Web 应用的标准

## OPTIONS ANALYSIS

### Option 1: 纯 CSS 伪类实现状态管理

**Description**: 完全依赖 CSS 伪类（如:hover, :focus, :active 等）来管理组件的视觉状态。

**Pros**:

- 浏览器原生实现，性能最优
- 无需 JavaScript 事件处理，减少代码复杂度
- 状态变化自动处理，无需手动控制
- 适用于大多数简单的交互场景

**Cons**:

- 无法处理复杂的状态逻辑（如条件状态转换）
- 难以通过 props 直接控制状态
- 无法捕获状态变化事件做额外处理
- 难以进行单元测试

**Complexity**: 低
**Implementation Time**: 短

### Option 2: 纯 JavaScript 事件管理状态

**Description**: 完全通过 JavaScript 事件（如 mouseenter, mouseleave 等）监听并设置状态值，通过绑定的状态值控制组件样式。

**Pros**:

- 完全可控的状态管理
- 可以实现复杂的条件状态逻辑
- 易于通过 props 覆盖状态
- 可以在状态变化时触发额外操作
- 便于单元测试状态变化

**Cons**:

- 性能开销较大，特别是在组件频繁渲染时
- 增加代码复杂度
- 可能存在延迟，导致视觉上的不连贯
- 需要手动维护所有状态转换逻辑

**Complexity**: 高
**Implementation Time**: 长

### Option 3: 混合策略—优先 CSS 伪类，JavaScript 辅助

**Description**: 优先使用 CSS 伪类管理常见状态，同时提供 JavaScript 事件监听作为补充，并支持通过 props 直接控制状态。

**Pros**:

- 结合了两种方法的优点
- 简单状态使用 CSS 伪类以获得最佳性能
- 复杂状态或需要额外控制时使用 JavaScript
- 支持通过 props 覆盖默认状态行为
- 可进行单元测试

**Cons**:

- 实现稍复杂，需要协调 CSS 和 JS 之间的状态一致性
- 需要额外的设计考虑来决定哪些状态使用 CSS，哪些使用 JS
- 可能在某些边缘情况下出现状态冲突

**Complexity**: 中
**Implementation Time**: 中

## DECISION

**Chosen Option**: Option 3: 混合策略—优先 CSS 伪类，JavaScript 辅助

**Rationale**:
混合策略在性能和灵活性之间达到了最佳平衡。通过优先使用 CSS 伪类来处理常见的状态变化（如 hover、focus 等），我们可以获得最佳的性能和自然的用户体验。同时，通过添加 JavaScript 事件处理，我们可以支持更复杂的状态逻辑、条件状态转换以及通过 props 控制状态，满足各种使用场景的需求。

## IMPLEMENTATION GUIDELINES

### 基本原则

1. **CSS 优先原则**：对于 hover、focus 等基本状态，优先使用 CSS 伪类实现
2. **状态扩展原则**：允许通过 props 覆盖或扩展默认状态行为
3. **一致性原则**：在整个组件库中保持一致的状态管理模式
4. **性能优先原则**：尽可能减少不必要的 JavaScript 状态管理

### 实现步骤

1. **基础 CSS 状态定义**:

```scss
.component {
  // 默认样式

  &:hover {
    // hover状态样式
  }

  &:focus {
    // focus状态样式
  }

  &:active {
    // active状态样式
  }

  &--disabled {
    // 禁用状态样式

    &:hover,
    &:focus,
    &:active {
      // 禁用状态下覆盖其他伪类
    }
  }
}
```

2. **JavaScript 状态管理补充**:

```typescript
// 内部状态管理
const internalState = ref(props.state);

// 当props中的state改变时，更新内部状态
watch(
  () => props.state,
  (newState) => {
    internalState.value = newState;
  }
);

// 计算当前状态（内部状态优先）
const currentState = computed(() => {
  return internalState.value;
});

// 鼠标交互处理（仅在需要额外控制时添加）
const handleMouseEnter = () => {
  // 仅在特定条件下需要JavaScript控制时实现
  if (props.state !== "disabled" && props.controlled) {
    internalState.value = "hover";
  }
};
```

3. **状态控制优先级**:

   - CSS 伪类 > Props 指定状态 > JavaScript 状态管理

4. **组件模板结构**:

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
    <!-- 组件内容 -->
  </div>
</template>
```

## VALIDATION

**状态管理验证清单**:

- [✓] 所有常见状态（hover, focus, active）都优先使用 CSS 伪类实现
- [✓] 组件支持通过 props 覆盖默认状态
- [✓] 所有必要的鼠标与键盘交互都有适当的状态反馈
- [✓] 禁用状态下正确阻止状态变化
- [✓] 组件状态在各种条件下一致表现

## EXAMPLES

### 按钮组件状态管理

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
  // 基础样式

  &:hover {
    // hover样式
  }

  &:focus {
    // focus样式
  }

  &:active {
    // active样式
  }

  &--disabled {
    cursor: not-allowed;
    opacity: 0.6;

    &:hover,
    &:focus,
    &:active {
      // 禁用态下覆盖所有伪类样式
    }
  }
}
```

### 菜单项组件状态管理（需要更多 JavaScript 控制）

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
    <!-- 组件内容 -->
  </div>
</template>
```

```typescript
// 状态管理
const internalState = ref(props.state || "default");

// 仅当需要特殊控制时监听事件
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

通过采用"优先 CSS 伪类，JavaScript 辅助"的混合策略，我们可以在组件库中实现最优的状态管理方案。这种方法充分利用了浏览器原生的 CSS 伪类性能优势，同时保留了通过 JavaScript 进行复杂状态管理的灵活性。

对于大多数简单组件，仅使用 CSS 伪类即可满足需求；对于需要复杂状态逻辑或特殊控制的组件，可添加 JavaScript 状态管理作为补充。这种方法保证了组件库的性能、灵活性和一致性。

## COMPONENT REUSE PRINCIPLES

### 基本原则

1. **组件复用优先**：如果新功能可以通过复用或组合现有组件实现，应优先采用复用而非重新开发
2. **一致性保障**：通过组件复用确保设计和交互体验的一致性
3. **维护效率**：减少重复代码，提高维护效率和可扩展性
4. **性能考量**：合理评估组件复用对性能的影响，确保复用不会引入不必要的性能开销

### 复用决策流程

1. **需求分析**：明确新功能的具体需求
2. **组件评估**：评估现有组件库中是否有可复用的组件
3. **复用方式决策**：
   - **直接使用**：功能完全匹配时直接使用现有组件
   - **组件组合**：通过组合多个现有组件实现新功能
   - **组件扩展**：在现有组件基础上添加新功能
   - **重新开发**：仅在无法通过以上方式实现时考虑新开发

### 实施指南

1. **文档完善**：确保所有组件有完善的文档，便于评估复用可能性
2. **组件解耦**：设计组件时注重低耦合、高内聚，增加复用可能性
3. **API 一致性**：保持相似功能组件的 API 设计一致，降低复用学习成本
4. **测试覆盖**：确保复用组件有完善的测试，验证在新场景下的可靠性

### 案例：Selector 组件复用 MenuList

**背景**：Selector 组件需要下拉菜单功能，而系统中已有 MenuList 组件提供类似功能。

**实现方式**：

1. 将 Selector 的下拉部分替换为 MenuList 组件
2. 适配 Selector 的数据结构为 MenuList 所需格式
3. 实现 Selector 特有的交互（如选中项高亮）

**代码示例**：

```vue
<template>
  <div class="mg-selector">
    <!-- Selector 触发区域 -->
    <div class="mg-selector__main">...</div>

    <!-- 使用 MenuList 作为下拉菜单 -->
    <MenuList
      v-if="isOpen"
      :items="transformedItems"
      @item-click="handleItemSelection"
    />
  </div>
</template>

<script setup>
// 转换数据结构以适配 MenuList
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

**收益**：

- 减少了约 100 行重复代码
- 确保了下拉菜单交互的一致性
- 当 MenuList 组件升级时，Selector 自动获益
- 降低了维护成本和测试工作量

🎨🎨🎨 EXITING CREATIVE PHASE - DECISION MADE
