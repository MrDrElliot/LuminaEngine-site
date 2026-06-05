---
title: Tools & Profilers
description: The utility windows under the Tools menu.
---

The **Tools** menu opens standalone utility windows. The everyday ones:

| Tool | What it does |
| --- | --- |
| **Asset Registry** | Every known asset, its load state, size, and dependencies. |
| **Input Actions** | Define named input actions and their key or pad bindings, see [Scripting › Input](/manual/scripting/input/). |
| **Scripts Info** | A live reference for the Lua API your scripts can call. |
| **Console Variables** | Browse and set engine CVars, and run console commands. |
| **Object Browser** | Inspect every live engine object in memory. |
| **Plugin Browser** | Enable or disable plugins for the project. |

## Profilers

For performance work:

- **CPU Profiler**, frame time and a hierarchical scope tree.
- **GPU Profiler**, GPU timings, pipeline stats, and a barrier inspector.
- **Memory**, CPU and GPU memory broken down by category.
- **Task System**, the fiber job scheduler, live.
- **Network**, per-world transport and replication stats.
- **Shadow Atlas**, shadow-map allocation.
- **Lua Debugger**, breakpoints and stepping for scripts.

For deep captures, **Tracy Profiler** (**Ctrl+P**) launches the external Tracy
app, and **RenderDoc Capture** (**F11**) grabs a GPU frame.

## Packaging

**File > Package Project** builds a distributable of your game.

## Settings

Editor, project, and engine settings are not in this menu, they live under
**File > Settings**. See the [Editor Overview](/manual/editor/) for what it
covers.
