---
title: Editor
description: The workspace you build games in.
---

The editor runs on the same runtime as your game, so what you see while editing
is what ships. When you launch it, the **project browser** opens first, see
[Your First Project](/getting-started/first-project/). Once a project loads, you
land in the **World Editor**.

## Layout

The editor is a docked workspace. Drag any panel by its tab to rearrange it or
tear it off into its own window. The default layout has these pieces.

- The **Viewport** in the center, your 3D view, see [Viewport](/manual/editor/viewport/).
- The **Scene Outliner**, **Details**, and other [panels](/manual/editor/panels/) around it.
- The **Content Browser** and **Output Log** as drawers along the bottom, toggled with **Ctrl+Space** and **Ctrl+J**.

## Menu bar

| Menu | Holds |
| --- | --- |
| **File** | **Settings** (below), New Project, Reload Project Module, Package Project. |
| **Tools** | Every utility window, including profilers, the asset registry, the plugin browser, and more, see [Tools & Profilers](/manual/editor/tools/). |
| **Help** | Links to Discord and the docs. |

## Settings

**File > Settings** is where you tune the **editor**, your **project**, and the
**engine**, all in one window. It is worth finding early, most options that are
not on a specific entity or asset live here.

The left side lists every settings group (editor preferences, project settings,
engine options); the right side shows that group's properties in the same
property grid used everywhere else. Changes save immediately, and you can
right-click any value and choose **Reset to Default** to restore it.

:::tip
To change how the editor behaves, where a project starts, or an engine-wide
option, open **File > Settings** first. Per-world rendering and physics are
separate, they live in the [World Settings](/manual/editor/panels/) panel.
:::

## Running the world

The viewport toolbar runs your game without leaving the editor.

- **Play** duplicates the world and runs it like the game, with input and scripts.
- **Simulate** runs physics and scripts in place.
- **Stop** returns to the editor world.

See [Viewport](/manual/editor/viewport/) for the full set of controls.

## This section

- **[Viewport](/manual/editor/viewport/)**, navigating and editing the 3D scene.
- **[Panels](/manual/editor/panels/)**, the outliner, details, and other docks.
- **[Content Browser](/manual/editor/content-browser/)**, your project's assets.
- **[Asset Editors](/manual/editor/asset-editors/)**, the editor for each asset type.
- **[Tools & Profilers](/manual/editor/tools/)**, the utility windows.
