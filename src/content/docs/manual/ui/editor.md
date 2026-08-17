---
title: The UI Editor
description: Editing, previewing, and visually composing RmlUi documents inside the Lumina editor.
---

`.rml` and `.rcss` files open in a dedicated editor with a live preview, so you
can build a document without running the game. Double-click either type in the
[Content Browser](/manual/editor/content-browser/).

## Creating files

Right-click a folder in the Content Browser:

| Action | Creates |
| --- | --- |
| **New UI Widget** | `NewWidget.rml`, a working document skeleton. |
| **New UI Stylesheet** | `NewStylesheet.rcss`, a commented starter sheet. |

Both are plain text files in your content folder, so they are also perfectly
editable in an external editor. They are not packages, but the editor does track
them so that references survive a rename. Move and rename them in the
[Content Browser](/manual/editor/content-browser/) rather than on disk, see
[Managing Assets](/manual/assets/managing/#working-outside-the-editor).

## The panels

The tool opens as a set of dockable panels. Rearrange them like any other editor
layout.

| Panel | What it does |
| --- | --- |
| **Editor** | The text editor, with RML and RCSS syntax highlighting, auto-indent, and auto-closing pairs. This is the source of truth: everything the visual tools do is written back here as markup. |
| **Live Preview** | The document, laid out and rendered exactly as it will be in game. |
| **Hierarchy** | A tree of every element in the document, id'd or not. Select, reorder, add children, and delete. |
| **Inspector** | Properties of the selected element: position, size, inner text, font size, and color. |
| **Palette** | Elements to add, and reusable `<template>` widgets to slot in. |

### Preview controls

| Input | Does |
| --- | --- |
| **Ctrl+Wheel** | Zoom, centered on the mouse. |
| **Middle-drag** | Pan. |
| **Double-click** | Reset the view. |

The toolbar has a **DPI** slider with an **Auto** checkbox. Leave Auto on: it
makes the preview's density ratio track the canvas height the same way the game
does, so `dp`-authored content is the size it will really be. Turn it off only to
inspect a specific density.

**Grid** toggles a canvas-space alignment grid, which also enables snapping when
you drag elements.

:::note[Stylesheet preview]
Opening a `.rcss` on its own previews it as a live style guide: the tool renders
a specimen document of headings, buttons, badges, panels, and bars through your
rules, so you can see the whole sheet at once.
:::

## Building a document visually

The designer is optional. Everything it does, it does by editing the markup in
the text panel, so you can mix hand-written RML and visual editing freely, and
undo works across both.

### Adding elements

The **Add element** section of the Palette inserts a new element as the last
child of the current selection, or into `<body>` if nothing is selected. You can
also right-click a Hierarchy row and choose **Add child**.

| Category | Elements |
| --- | --- |
| **Panels** | Canvas Panel, Horizontal Box, Vertical Box, Overlay, Wrap Box, Border, Size Box, Scroll Box, Panel |
| **Common** | Text, Button, Image, Progress Bar |
| **Input** | Text Field, Check Box, Slider |

These are not special element types. Each one inserts ordinary markup with inline
styles: a Horizontal Box is a `<div>` with `display: flex; flex-direction: row`.
Containers get a minimum size so they are visible and grabbable while empty.

Every inserted element is given a unique `id`, which is what makes it selectable
and addressable afterwards. Acting on a hand-written element that has no `id`
gives it one automatically.

### Moving and sizing

- **Click** an element in the preview or the Hierarchy to select it.
- **Ctrl+drag** in the preview to reposition it. With the grid shown, the drag
  snaps to it.
- The **Inspector** has X / Y drag fields for nudging, and Width / Height fields.
- **Reset position** strips the positioning properties so the element falls back
  to where its stylesheet puts it.

Repositioning writes `transform: translate(...)` into the element's inline style,
not `position: absolute` with `left` and `top`. That matters: a transform is a
relative nudge, so an element anchored to a corner keeps hugging that corner when
the viewport resizes. Pinning it to absolute coordinates would break that.

### Reordering and deleting

Right-click a Hierarchy row, or use the Inspector buttons:

| Action | Effect |
| --- | --- |
| **Move up** / **Move down** | Swap the element with its previous or next sibling. |
| **Delete element** | Remove the element and its children. Also bound to the **Delete** key while an element is selected. |

### Editing text and color

For an element whose content is plain text, the Inspector shows an inline text
field, a **Size** drag for `font-size`, and a **Color** picker. All three write
inline styles.

## Composing widgets

A `<template>` file is a reusable widget: a health bar, a window frame, a stat
panel. See [Templates and composition](/manual/ui/rml/#templates-and-composition)
for the markup.

The **Widgets** section of the Palette lists every `<template>`-rooted `.rml`
found beside the document you have open. To use one:

- **Drag** it onto a Hierarchy row or onto an element in the preview canvas, or
- **select** an element and **double-click** the widget.

The tool writes the same two things you would write by hand: a
`<link type="text/template">` in `<head>`, and a `<template src="..."/>` as the
target element's first child. **Clear widget** removes the injection.

Turn on slot outlines to see which elements are empty and which already have a
widget assigned. Nested slots are hit-tested innermost-first, so dropping onto a
widget inside a widget targets the inner one.

## Hot reload

Saving a `.rml` or `.rcss` restyles every loaded document in every context on the
next frame, including in a running game. Iterating on colors, spacing, and layout
does not need a restart.

:::caution[Styles reload, markup does not]
Hot reload re-applies **stylesheets**. It does not re-parse the markup of a
document that is already loaded, so adding an element or changing a data binding
in a live document has no effect until the document is loaded again. Stop and
restart play, or call `Close` and `LoadDocument` again from your script.
:::
