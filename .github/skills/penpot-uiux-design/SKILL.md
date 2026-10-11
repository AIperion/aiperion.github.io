---
name: penpot-uiux-design
description: 'Create, edit, inspect and review UI/UX designs inside Penpot design files through the Penpot MCP server (tools: execute_code, high_level_overview, export_shape, penpot_api_info; import_image on a local server). Use ONLY when the work targets a Penpot file — e.g. "design this in Penpot", "create a Penpot mockup/board", "build a design system or tokens in Penpot", "review my Penpot design", "export CSS/assets from Penpot", "turn this Penpot design into code". For UI work that produces code directly without Penpot, use frontend-design / design-taste-frontend / ui-ux-pro-max instead.'
license: MIT (adapted from github/awesome-copilot skills/penpot-uiux-design)
---

# Penpot UI/UX Design Guide

Create professional, user-centered designs in Penpot using Penpot's official MCP server and proven UI/UX principles.

> Adapted from [github/awesome-copilot · penpot-uiux-design](https://github.com/github/awesome-copilot/tree/main/skills/penpot-uiux-design) (MIT). Setup updated for the MCP server's move into `penpot/penpot/mcp` (the standalone `penpot/penpot-mcp` repo was archived on 2026-02-03), the hosted remote server, and the Streamable HTTP `/mcp` endpoint (legacy `/sse` was removed).

## How this skill works with the other design skills

| Concern | Skill |
| ------- | ----- |
| Aesthetic direction, avoiding templated looks | `design-taste-frontend`, `frontend-design` |
| Concrete palettes, font pairings, UX rules, accessibility data | `ui-ux-pro-max` |
| Building and editing the **Penpot file** via MCP (this skill) | `penpot-uiux-design` |

Decide the direction and values with the other skills, then use this skill to make them in Penpot.

## Available MCP Tools

Tools are exposed by the `penpot` MCP server (clients may show them with a server prefix, e.g. `mcp__penpot__execute_code` in Claude Code).

| Tool | Purpose |
| ---- | ------- |
| `high_level_overview` | Returns Penpot's built-in usage primer for agents (API conventions, `penpotUtils`, pitfalls) — static text, does **not** inspect the file or prove the plugin is connected |
| `execute_code` | Run JavaScript in the Penpot plugin context to query/create/modify designs |
| `export_shape` | Export shapes as PNG/SVG for visual inspection (limited on the remote server — no export to local paths) |
| `import_image` | Import images from local paths — **local server only**; the hosted server does not expose this tool |
| `penpot_api_info` | Retrieve Penpot Plugin API documentation |

## MCP Server Setup

This workspace uses Penpot's **hosted remote MCP server** (registered as `penpot` in the workspace-root `.mcp.json`; `.github/mcp/penpot.sh` reads `PENPOT_MCP_KEY` from the environment or the gitignored `.env`). Full setup, the local-server alternative and troubleshooting: [setup-troubleshooting.md](references/setup-troubleshooting.md).

### Before doing anything: check the connection

1. Run `execute_code` with `return { file: penpot.currentFile?.name, page: penpot.currentPage?.name };`. If it returns the file and page names, you are connected — no setup needed.
   - Penpot tools missing entirely → the MCP server isn't running in the harness.
   - `No Penpot instance connected for user token` → the server works but no design file is connected (this is reported as tool text, not as an error flag).
2. If it fails, tell the user and ask them to check — do **not** walk them through a fresh install unless they confirm Penpot MCP is not set up:
   > "The Penpot MCP server isn't responding. Is a Penpot design file open with **File → MCP Server → Connect** active, and is `PENPOT_MCP_KEY` set in `.env` at the repository root?"

### Safety

The agent can create, rename, move, restyle and **delete** on the focused page.

- Start with read-only actions (overview, find, export) to confirm you are on the right file/page.
- Describe intended changes before large or destructive edits; prefer small, reversible steps.
- MCP always acts on the **currently focused page** in the one Penpot tab that owns MCP.

## Core Design Principles

### The Golden Rules

1. **Clarity over cleverness**: Every element must have a purpose
2. **Consistency builds trust**: Reuse patterns, colors, and components
3. **User goals first**: Design for tasks, not features
4. **Accessibility is not optional**: Design for everyone
5. **Test with real users**: Validate assumptions early

### Visual Hierarchy (Priority Order)

1. **Size**: Larger = more important
2. **Color/Contrast**: High contrast draws attention
3. **Position**: Top-left (LTR) gets seen first
4. **Whitespace**: Isolation emphasizes importance
5. **Typography weight**: Bold stands out

## Design Workflow

1. **Orient**: Read `high_level_overview` once per session for Penpot's API primer, then inspect the focused page with `penpotUtils.shapeStructure()` via `execute_code`
2. **Check for a design system**: Ask the user for existing tokens/specs, or discover them from the file (below)
3. **Inspect structure**: Call `execute_code` with `penpotUtils.shapeStructure()` to see the hierarchy
4. **Find elements**: Use `penpotUtils.findShapes()` to locate elements by type or name
5. **Create/modify**: Use `penpot.createBoard()`, `penpot.createRectangle()`, `penpot.createText()` etc.
6. **Apply layout**: Use `addFlexLayout()` for responsive containers
7. **Validate**: Call `export_shape` and visually check your work (requires a vision-capable model)

## Design System Handling

**Before creating designs, determine if the user has an existing design system:**

1. **Ask the user**: "Do you have a design system or brand guidelines to follow?"
2. **Discover from Penpot**: Check for existing components, colors, and patterns

```javascript
// Discover existing design patterns in current file
const allShapes = penpotUtils.findShapes(() => true, penpot.root);

// Find existing colors in use
const colors = new Set();
allShapes.forEach(s => {
  if (s.fills) s.fills.forEach(f => colors.add(f.fillColor));
});

// Find existing text styles (font sizes, weights)
const textStyles = allShapes
  .filter(s => s.type === 'text')
  .map(s => ({ fontSize: s.fontSize, fontWeight: s.fontWeight }));

// Find existing components
const components = penpot.library.local.components;

return { colors: [...colors], textStyles, componentCount: components.length };
```

**If user HAS a design system:**

- Use their specified colors, spacing, typography
- Match their existing component patterns
- Follow their naming conventions

**If user has NO design system:**

- Set the visual direction with `design-taste-frontend` / `frontend-design`, and pick concrete palette, type and spacing values with `ui-ux-pro-max` — do not fall back to generic defaults
- Create the chosen values as Penpot tokens/styles first, then build screens from them
- Offer to help establish consistent patterns
- Reference specs in [component-patterns.md](references/component-patterns.md)

## Key Penpot API Gotchas

- `width`/`height` are READ-ONLY → use `shape.resize(w, h)`
- `parentX`/`parentY` are READ-ONLY → use `penpotUtils.setParentXY(shape, x, y)`
- Use `insertChild(index, shape)` for z-ordering (not `appendChild`)
- Flex children array order is REVERSED for `dir="column"` or `dir="row"`
- After `text.resize()`, reset `growType` to `"auto-width"` or `"auto-height"`

## Positioning New Boards

**Always check existing boards before creating new ones** to avoid overlap:

```javascript
// Find all existing boards and calculate next position
const boards = penpotUtils.findShapes(s => s.type === 'board', penpot.root);
let nextX = 0;
const gap = 100; // Space between boards

if (boards.length > 0) {
  // Find rightmost board edge
  boards.forEach(b => {
    const rightEdge = b.x + b.width;
    if (rightEdge + gap > nextX) {
      nextX = rightEdge + gap;
    }
  });
}

// Create new board at calculated position
const newBoard = penpot.createBoard();
newBoard.x = nextX;
newBoard.y = 0;
newBoard.resize(375, 812);
```

**Board spacing guidelines:**

- Use 100px gap between related screens (same flow)
- Use 200px+ gap between different sections/flows
- Align boards vertically (same y) for visual organization
- Group related screens horizontally in user flow order

## Spacing and Type Baselines

Use these only as structural constraints, never as a palette or a look. Colours, typefaces and exact scale come from the user's design system or from `ui-ux-pro-max` / `design-taste-frontend`.

- **Spacing**: 8px base grid (4px for tight inline gaps); keep spacing values on the scale.
- **Body text**: 16px minimum for body copy, 12px absolute minimum for captions/labels.
- **Type scale**: use a consistent ratio (one scale per file), with clear steps between display, H1–H3, body and caption.
- **Colour roles**: define primary, secondary, neutral and status (success/warning/error) roles as tokens before building screens; status colours must not rely on hue alone.

## Common Layouts

### Mobile Screen (375×812)

```text
┌─────────────────────────────┐
│ Status Bar (44px)           │
├─────────────────────────────┤
│ Header/Nav (56px)           │
├─────────────────────────────┤
│                             │
│ Content Area                │
│ (Scrollable)                │
│ Padding: 16px horizontal    │
│                             │
├─────────────────────────────┤
│ Bottom Nav/CTA (84px)       │
└─────────────────────────────┘

```

### Desktop Dashboard (1440×900)

```text
┌──────┬──────────────────────────────────┐
│      │ Header (64px)                    │
│ Side │──────────────────────────────────│
│ bar  │ Page Title + Actions             │
│      │──────────────────────────────────│
│ 240  │ Content Grid                     │
│ px   │ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ │
│      │ │Card │ │Card │ │Card │ │Card │ │
│      │ └─────┘ └─────┘ └─────┘ └─────┘ │
│      │                                  │
└──────┴──────────────────────────────────┘

```

## Component Checklist

### Buttons

- [ ] Clear, action-oriented label (2-3 words)
- [ ] Minimum touch target: 44×44px
- [ ] Visual states: default, hover, active, disabled, loading
- [ ] Sufficient contrast (3:1 against background)
- [ ] Consistent border radius across app

### Forms

- [ ] Labels above inputs (not just placeholders)
- [ ] Required field indicators
- [ ] Error messages adjacent to fields
- [ ] Logical tab order
- [ ] Input types match content (email, tel, etc.)

### Navigation

- [ ] Current location clearly indicated
- [ ] Consistent position across screens
- [ ] Maximum 7±2 top-level items
- [ ] Touch-friendly on mobile (48px targets)

## Accessibility Quick Checks

1. **Color contrast**: Text 4.5:1, Large text 3:1
2. **Touch targets**: Minimum 44×44px
3. **Focus states**: Visible keyboard focus indicators
4. **Alt text**: Meaningful descriptions for images
5. **Hierarchy**: Proper heading levels (H1→H2→H3)
6. **Color independence**: Never rely solely on color

## Design Review Checklist

Before finalizing any design:

- [ ] Visual hierarchy is clear
- [ ] Consistent spacing and alignment
- [ ] Typography is readable (16px+ body text)
- [ ] Color contrast meets WCAG AA
- [ ] Interactive elements are obvious
- [ ] Mobile-friendly touch targets
- [ ] Loading/empty/error states considered
- [ ] Consistent with design system

## Validating Designs

Use these validation approaches with `execute_code`:

| Check | Method |
| ----- | ------ |
| Elements outside bounds | `penpotUtils.analyzeDescendants()` with `isContainedIn()` |
| Text too small (<12px) | `penpotUtils.findShapes()` filtering by `fontSize` |
| Missing contrast | Call `export_shape` and visually inspect |
| Hierarchy structure | `penpotUtils.shapeStructure()` to review nesting |

### Export CSS

Use `penpot.generateStyle(selection, { type: 'css', includeChildren: true })` via `execute_code` to extract CSS from designs.

## Tips for Great Designs

1. **Start with content**: Real content reveals layout needs
2. **Design mobile-first**: Constraints breed creativity
3. **Use a grid**: 8px base grid keeps things aligned
4. **Limit colors**: 1 primary + 1 secondary + neutrals
5. **Limit fonts**: 1-2 typefaces maximum
6. **Embrace whitespace**: Breathing room improves comprehension
7. **Be consistent**: Same action = same appearance everywhere
8. **Provide feedback**: Every action needs a response
