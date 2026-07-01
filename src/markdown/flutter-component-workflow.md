---
description:
globs:
alwaysApply: true
---

# MasterGo Flutter Component System Specification v1.0

## Core Contents

- Project Environment Setup
- MasterGo DSL to Flutter Widget Mapping Rules
- Component Development Workflow

---

## Project Environment Setup

### Environment Check

Check if the Flutter project is properly initialized:

- `pubspec.yaml` exists and contains valid Flutter configuration
- `lib/` directory with `main.dart` entry point
- `flutter_screenutil` dependency for screen adaptation
- State management solution (e.g., `flutter_riverpod`)
- Routing solution (e.g., `go_router`)

### Environment Initialization

If the project is not initialized, run:

```bash
flutter create . --org com.example
flutter pub add flutter_screenutil
flutter pub add flutter_riverpod
flutter pub add go_router
```

### Recommended Project Structure

```
project-root/
├── lib/
│   ├── main.dart                    # App entry point with ScreenUtilInit
│   ├── router.dart                  # Route definitions
│   ├── features/                    # Feature modules
│   │   ├── <feature_name>/
│   │   │   ├── data/               # Data sources, repositories
│   │   │   ├── domain/             # Models, entities
│   │   │   └── presentation/       # Pages, widgets, controllers
│   │   │       ├── <page_name>.dart
│   │   │       ├── controllers/
│   │   │       └── widgets/        # Feature-specific reusable widgets
│   ├── utils/                       # Shared utilities
│   │   ├── ui/                      # Shared UI components
│   │   ├── extension/               # Dart extensions on Widget, String, etc.
│   │   └── ...
│   └── config/                      # App configuration
├── assets/
│   ├── image/                       # Image assets organized by feature
│   │   ├── common/
│   │   ├── home/
│   │   └── <feature_name>/
│   ├── video/
│   └── font_family/                 # Custom font files
├── pubspec.yaml
└── analysis_options.yaml
```

### ScreenUtil Initialization

The app must initialize `ScreenUtilInit` in `main.dart`:

```dart
ScreenUtilInit(
  designSize: const Size(375, 812),  // Match design draft dimensions
  minTextAdapt: true,
  splitScreenMode: true,
  builder: (context, child) {
    return MaterialApp.router(
      // ...
    );
  },
);
```

**CRITICAL**: The `designSize` should match the MasterGo design file's artboard dimensions. Check the DSL data's root frame width/height to determine this value.

#### DesignSize Auto-Detection

Before hardcoding `designSize`, check the root frame dimensions from the component JSON specification:

```
jsonData[0].width  → designSize width
jsonData[0].height → designSize height
```

For example, if the root frame is 390×844, set `designSize: const Size(390, 844)`. Do **not** assume 375×812 without verifying against the actual design file dimensions.

---

## MasterGo DSL to Flutter Widget Mapping Rules

### Layout Mapping

MasterGo DSL nodes map to Flutter widgets based on their `type` and layout properties:

| DSL Property | Flutter Widget | Notes |
|---|---|---|
| `type: "FRAME"` with vertical layout | `Column` | `mainAxisAlignment` maps from DSL alignment |
| `type: "FRAME"` with horizontal layout | `Row` | `crossAxisAlignment` maps from DSL alignment |
| `type: "FRAME"` with absolute children | `Stack` + `Positioned` | Use when children have absolute positions |
| `type: "FRAME"` with single child or styling | `Container` | When the frame has background, border, or padding |
| `type: "GROUP"` | `Stack` | Groups are overlay containers |
| `type: "RECTANGLE"` | `Container` with `BoxDecoration` | Decorative elements |
| `type: "ELLIPSE"` | `Container` with circular `BorderRadius` | Or `ClipOval` |

### Dimension Mapping

**All dimension values from the DSL must use `flutter_screenutil` adaption**:

```dart
// Width and height use .w
Container(
  width: 200.w,     // DSL width: 200
  height: 48.w,     // DSL height: 48
)

// Font sizes use .sp
Text(
  'Hello',
  style: TextStyle(fontSize: 14.sp),  // DSL fontSize: 14
)

// Padding and margin use .w
EdgeInsets.all(16.w)
EdgeInsetsDirectional.fromSTEB(16.w, 8.w, 16.w, 8.w)
```

### Color Mapping

Convert DSL color values to Flutter `Color` objects directly:

```dart
// DSL: { r: 255, g: 206, b: 153, a: 1.0 }
Color(0xFFFFCE99)

// DSL with opacity: { r: 0, g: 0, b: 0, a: 0.5 }
Color(0xFF000000).withOpacity(0.5)
// or more precisely:
Color(0x80000000)

// DSL gradient
LinearGradient(
  begin: Alignment.topCenter,
  end: Alignment.bottomCenter,
  colors: [
    Color(0xFF000000).withOpacity(0.7),
    Colors.transparent,
  ],
)
```

**Rule**: Use `Color(0xFFxxxxxx)` format directly. Do NOT create custom color utility classes. If the project already has a color constants file, follow its pattern; otherwise use inline `Color()`.

### Typography Mapping

Convert DSL text properties to Flutter `TextStyle`:

```dart
// DSL: { fontSize: 16, fontWeight: 600, fontFamily: "Urbanist", color: {...} }
Text(
  'Content',
  style: TextStyle(
    fontSize: 16.sp,
    fontWeight: FontWeight.w600,
    fontFamily: 'Urbanist',       // Only if custom font is declared in pubspec.yaml
    color: Color(0xFF000000),
    height: 1.2,                   // DSL lineHeight / fontSize
    decoration: TextDecoration.none,
  ),
)
```

**FontWeight mapping from DSL**:

| DSL fontWeight | Flutter FontWeight |
|---|---|
| 100 | `FontWeight.w100` |
| 200 | `FontWeight.w200` |
| 300 | `FontWeight.w300` |
| 400 (Regular) | `FontWeight.w400` |
| 500 (Medium) | `FontWeight.w500` |
| 600 (SemiBold) | `FontWeight.w600` |
| 700 (Bold) | `FontWeight.w700` |
| 800 (ExtraBold) | `FontWeight.w800` |
| 900 (Black) | `FontWeight.w900` |

### Text Overflow Handling

```dart
// Single line with ellipsis
Text(
  'Long text...',
  maxLines: 1,
  overflow: TextOverflow.ellipsis,
)

// Multi-line
Text(
  'Long text...',
  maxLines: 3,
  overflow: TextOverflow.ellipsis,
)
```

### Image & Asset Resource Handling

#### Image Asset Types and Priority

The DSL may reference images in different ways. Handle each type as follows:

**Priority order for image implementation:**

1. **Network URL in DSL fills** → Use `CachedNetworkImage` (most common for dynamic content)
2. **Local asset referenced by name** → Use `Image.asset` with 3x PNG
3. **SVG path data in DSL** → Write SVG file and use `SvgPicture.asset` (only for simple icons)
4. **No image data, but icon-like element** → Check Flutter `Icons` class first before creating custom asset

---

#### 3x PNG — The Standard for Static Assets

For all static image assets (backgrounds, illustrations, decorative images, product images):

```dart
// Always use 3x resolution PNG for crisp display on high-DPI screens
Image.asset(
  'assets/image/<feature>/image_name.png',
  width: 200.w,   // Use DSL width with .w suffix
  height: 200.w,  // Use DSL height with .w suffix
  fit: BoxFit.cover,  // or BoxFit.contain depending on design intent
)
```

Asset directory structure for 3x PNG:
```
assets/image/<feature>/
├── image_name.png        # 1x (base)
├── 2.0x/
│   └── image_name.png   # 2x
└── 3.0x/
    └── image_name.png   # 3x  ← designer should provide this
```

If only one resolution is provided, place it in the base directory and Flutter will scale it. **Do NOT upscale a 1x image and call it 3x.**

**MANDATORY**: Register the asset directory in `pubspec.yaml` before writing any widget code:
```yaml
flutter:
  assets:
    - assets/image/<feature>/
```

Image with rounded corners:
```dart
ClipRRect(
  borderRadius: BorderRadius.circular(12.w),
  child: Image.asset('assets/image/<feature>/image_name.png', width: 100.w, height: 100.w, fit: BoxFit.cover),
)
```

---

#### SVG — Only for Single-Color Icons That Need Dynamic Color

Use SVG only when:
- The element is a simple icon (single color, geometric shape)
- The color needs to change dynamically (e.g., themed icons, active/inactive states)

```dart
// Add flutter_svg to pubspec.yaml first:
// flutter_svg: ^2.0.0

SvgPicture.asset(
  'assets/image/<feature>/icon_name.svg',
  width: 24.w,
  height: 24.w,
  colorFilter: ColorFilter.mode(
    Color(0xFF000000),  // dynamic color goes here
    BlendMode.srcIn,
  ),
)
```

**SVG from DSL path data**: When the DSL contains raw SVG path strings, extract the actual `width` and `height` from the DSL node (NOT the default 16x16 viewBox), then write the correct SVG file:

```svg
<svg width="<actual_width>" height="<actual_height>"
     viewBox="0 0 <actual_width> <actual_height>"
     xmlns="http://www.w3.org/2000/svg">
  <path d="<path_data>" fill="currentColor"/>
</svg>
```

**Do NOT use a hardcoded `viewBox="0 0 16 16"` unless the DSL node width and height are both 16.**

---

#### CachedNetworkImage — For Dynamic/User-Generated Content

Use when the image URL comes from an API response (avatars, product photos, banners):

```dart
// Add cached_network_image to pubspec.yaml:
// cached_network_image: ^3.3.0

CachedNetworkImage(
  imageUrl: imageUrl,
  width: 200.w,
  height: 200.w,
  fit: BoxFit.cover,
  placeholder: (context, url) => Container(
    color: Color(0xFFF5F5F5),
  ),
  errorWidget: (context, url, error) => Container(
    color: Color(0xFFF5F5F5),
    child: Icon(Icons.image_not_supported, size: 24.w),
  ),
)
```

---

#### Flutter Icons — Use When Appropriate

If the DSL element is a simple UI icon (close, back, search, add, etc.) and matches a Material icon, use `Icons` directly instead of creating a custom asset:

```dart
Icon(
  Icons.close,
  size: 24.w,
  color: Color(0xFF000000),
)
```

Check `Icons` class first. Only create a custom SVG or PNG asset if no matching Material icon exists.

---

#### MANDATORY EXECUTION CHECKLIST before writing any image-related widget code:

- [ ] Identified image type: network URL / local PNG / SVG path / Material icon
- [ ] For local assets: file exists in `assets/image/<feature>/` directory
- [ ] `pubspec.yaml` updated with the asset directory
- [ ] Correct package added to `pubspec.yaml` (`flutter_svg` or `cached_network_image`) if needed
- [ ] Used `.w` suffix for width and height
- [ ] SVG viewBox matches actual DSL node dimensions (not hardcoded 16x16)
- [ ] `fit` property matches design intent (cover/contain/fill)

**AI must complete this checklist before generating image widget code. Do not skip to code generation.**

### Border & Decoration Mapping

```dart
// DSL: { borderRadius: 16, backgroundColor: {...}, border: {...} }
Container(
  decoration: BoxDecoration(
    color: Color(0xFF2B251F),
    borderRadius: BorderRadius.circular(16.w),
    border: Border.all(
      color: Color(0xFFE7E7E7),
      width: 1.w,
    ),
    // DSL shadow
    boxShadow: [
      BoxShadow(
        color: Color(0x1A000000),
        blurRadius: 10.w,
        offset: Offset(0, 2.w),
      ),
    ],
  ),
)
```

### Spacing Mapping

```dart
// Use SizedBox for spacing between children
Column(
  children: [
    WidgetA(),
    SizedBox(height: 16.w),  // vertical spacing
    WidgetB(),
  ],
)

Row(
  children: [
    WidgetA(),
    SizedBox(width: 8.w),   // horizontal spacing
    WidgetB(),
  ],
)

// Use EdgeInsets for padding
Container(
  padding: EdgeInsetsDirectional.fromSTEB(16.w, 12.w, 16.w, 12.w),
  child: ...,
)
```

**IMPORTANT**: Prefer `EdgeInsetsDirectional` over `EdgeInsets` for RTL language support.

### Alignment Mapping

| DSL Alignment | Flutter Alignment |
|---|---|
| top-left | `Alignment.topLeft` / `CrossAxisAlignment.start` + `MainAxisAlignment.start` |
| top-center | `Alignment.topCenter` |
| center | `Alignment.center` / `MainAxisAlignment.center` |
| center-left | `Alignment.centerLeft` |
| bottom-center | `Alignment.bottomCenter` |
| space-between | `MainAxisAlignment.spaceBetween` |
| space-around | `MainAxisAlignment.spaceAround` |

### Interaction Mapping

```dart
// Tap gesture — wrap any widget with GestureDetector
GestureDetector(
  behavior: HitTestBehavior.translucent,
  onTap: () { /* action */ },
  child: yourWidget,
)

// Or use InkWell for Material ripple effect
InkWell(
  onTap: () { /* action */ },
  borderRadius: BorderRadius.circular(12.w),
  child: yourWidget,
)

// Navigation
context.pushNamed('routeName');
context.pop();
Navigator.pop(context);
```

### Interactive States

Handle pressed, disabled, and loading states for interactive elements:

```dart
// Pressed state with opacity feedback
GestureDetector(
  onTapDown: (_) => setState(() => _isPressed = true),
  onTapUp: (_) => setState(() => _isPressed = false),
  onTapCancel: () => setState(() => _isPressed = false),
  onTap: () { /* action */ },
  child: AnimatedOpacity(
    opacity: _isPressed ? 0.6 : 1.0,
    duration: Duration(milliseconds: 100),
    child: yourWidget,
  ),
)

// Disabled state — visually dim and block interaction
Opacity(
  opacity: isDisabled ? 0.4 : 1.0,
  child: IgnorePointer(
    ignoring: isDisabled,
    child: yourWidget,
  ),
)

// Loading state — replace button content with spinner
Container(
  width: 200.w,
  height: 48.w,
  alignment: Alignment.center,
  decoration: BoxDecoration(
    color: Color(0xFFCCCCCC),
    borderRadius: BorderRadius.circular(24.w),
  ),
  child: isLoading
      ? SizedBox(
          width: 24.w,
          height: 24.w,
          child: CircularProgressIndicator(strokeWidth: 2.w, color: Colors.white),
        )
      : Text('Submit', style: TextStyle(fontSize: 16.sp)),
)
```

**Decision rule for interactive state implementation**:
- Use `AnimatedOpacity` or `AnimatedContainer` for simple visual transitions (pressed feedback, hover)
- Use `StatefulWidget` with a local `_isPressed` bool for tap feedback on custom widgets
- Only use Riverpod (`ConsumerStatefulWidget`) if the loading/disabled state is driven by async business logic (e.g., API call in progress)

### Scroll Mapping

```dart
// Vertical scroll
SingleChildScrollView(
  child: Column(children: [...]),
)

// List
ListView.builder(
  itemCount: items.length,
  itemBuilder: (context, index) => ItemWidget(items[index]),
)

// Horizontal scroll
ListView.builder(
  scrollDirection: Axis.horizontal,
  // ...
)
```



---

## Component Development Workflow

### Complete Process

```
[Environment Check] → [Component Analysis] → [User Confirmation] → [Component Development] → [Validation]
```

### 1. Component Analysis

**Input**: Component JSON specification from MasterGo
**Output**: Architecture document (`.mastergo/${componentName}-arch.md`)

#### Widget Type Decision Rule

| Situation | Widget Type |
|---|---|
| Pure display, no interaction | `StatelessWidget` |
| Local UI state only (pressed, expanded, tab index) | `StatefulWidget` |
| Reads or writes to Riverpod providers | `ConsumerWidget` or `ConsumerStatefulWidget` |
| Local UI state + Riverpod | `ConsumerStatefulWidget` |

#### Checklist

- [ ] Identify the type of Flutter widget needed using the Widget Type Decision Rule above
- [ ] Analyze the DSL tree structure and map to Flutter widget tree
- [ ] Extract all colors, dimensions, font styles
- [ ] Identify interactive elements (buttons, inputs, gestures) and their states (pressed, disabled, loading)
- [ ] Identify scrollable areas
- [ ] List required image assets and their paths (distinguish PNG vs SVG)
- [ ] Determine state management needs

#### Architecture Document Verification

**CRITICAL BREAK POINT**: After generating the architecture document, execution must pause.

1. Present the architecture document to the user for review
2. Ask the user to verify:
   - Widget tree structure
   - State management approach
   - Asset paths and resource handling
   - Screen adaptation dimensions
3. If user identifies issues:
   - Collect all feedback
   - Modify the architecture document
   - Present updated document for review
4. Repeat review cycle until user explicitly approves
5. Only proceed to Component Development after user confirmation

#### Image Resource Handling

**CRITICAL STEP**: After user confirmation:

1. **Resource Inventory**:

   ```markdown
   ## Image Resources

   | Description | Source (from DSL) | Target Path | Notes |
   |---|---|---|---|
   | Close icon | SVG path data | `assets/image/<feature>/icon_close.png` | Use Image.asset |
   | Background | Image fill URL | `assets/image/<feature>/bg.png` | Download and save |
   ```

2. **Save Images**:
   - Copy/download all image resources to `assets/image/<feature>/`
   - Use semantic filenames: `icon_close.png`, `bg_header.png`, etc.
   - Register all assets in `pubspec.yaml` under `flutter > assets`

3. **pubspec.yaml Asset Registration**:

   ```yaml
   flutter:
     assets:
       - assets/image/common/
       - assets/image/<feature_name>/
   ```

### 2. Component Development

**Input**: Approved architecture document and DSL JSON
**Output**: Functional Flutter widget

#### Required File Structure

For a feature page:
```
lib/features/<feature_name>/
├── presentation/
│   ├── <page_name>.dart         # Main page widget
│   └── widgets/
│       ├── <sub_widget_a>.dart  # Extracted sub-components
│       └── <sub_widget_b>.dart
```

For a shared component:
```
lib/utils/ui/
├── <component_name>.dart
```

#### Development Rules

1. **Widget Decomposition**: If any part of the widget tree is reused or deeply nested (>4 levels), extract it into a separate widget file under `widgets/`.

2. **State Management**:
   - Use `StatelessWidget` for pure UI with no state
   - Use `StatefulWidget` for local UI state (animations, form inputs)
   - Use `ConsumerStatefulWidget` (Riverpod) for state that connects to business logic

3. **Screen Adaptation**: Every hardcoded dimension MUST use `.w` (for width/height/padding/margin/radius) or `.sp` (for font size). Never use raw pixel values.

4. **RTL Support**: Use `EdgeInsetsDirectional` instead of `EdgeInsets` for start/end padding. Use `AlignmentDirectional` instead of `Alignment` when applicable.

5. **Safe Area**: Account for status bar and bottom bar:
   ```dart
   // Status bar height
   MediaQuery.of(context).padding.top
   // Or via ScreenUtil
   ScreenUtil().statusBarHeight

   // Bottom safe area
   ScreenUtil().bottomBarHeight
   ```

6. **Const Constructors**: Use `const` keyword wherever possible for better performance:
   ```dart
   const SizedBox(height: 16)
   const EdgeInsets.all(16)
   ```

### 3. Validation

#### Checklist

- [ ] Widget renders without overflow errors
- [ ] All dimensions are adapted via `.w` / `.sp`
- [ ] Colors match the design specification
- [ ] Text styles (font, size, weight, color) match the design
- [ ] Images display correctly
- [ ] SVG assets render correctly with expected color (colorFilter applied where needed)
- [ ] Interactive elements respond to taps
- [ ] Interactive states (pressed, disabled, loading) are visually distinct
- [ ] Layout adapts to different screen sizes
- [ ] No hardcoded pixel values remain
- [ ] No raw `EdgeInsets` used where `EdgeInsetsDirectional` is required (check all padding declarations)
- [ ] Widget tree is properly decomposed (no excessive nesting)
- [ ] Assets are registered in `pubspec.yaml`

### Checkpoints

- **Environment**: Flutter project initialized, dependencies installed, ScreenUtilInit configured
- **Structure**: Feature directory created, files organized per convention
- **Analysis**: DSL fully parsed, widget tree planned, resources inventoried
- **Implementation**: Renders correctly, dimensions adapted, colors accurate, assets loaded
- **Quality**: No hardcoded values, proper decomposition, RTL-ready, safe area handled
