---
title: Tools & Profilers
description: The utility windows under the Tools menu.
---

The **Tools** menu opens standalone utility windows. Here are the everyday ones.

| Tool | What it does |
| --- | --- |
| **Asset Registry** | Every known asset, its load state, size, and dependencies. |
| **Console Variables** | Browse and set engine CVars, and run console commands. |
| **Object Browser** | Inspect every live engine object in memory. |
| **Plugin Browser** | Enable or disable plugins for the project. |

## Profilers

For performance work.

- **CPU Profiler**, frame time and a hierarchical scope tree.
- **GPU Profiler**, GPU timings, pipeline stats, and a barrier inspector.
- **Gameplay Profiler**, per-script and per-system `OnUpdate` timings, see [Scripting › Reference](/manual/scripting/reference/#global-api).
- **Memory**, CPU and GPU memory broken down by category.
- **Task System**, the fiber job scheduler, live.
- **Network**, per-world transport and replication stats.
- **Shadow Atlas**, shadow-map allocation.

For deep captures, **Tracy Profiler** (**Ctrl+P**) launches the external Tracy
app, and **RenderDoc Capture** (**F11**) grabs a GPU frame.

To debug C# scripts, attach your IDE's managed debugger (Visual Studio or Rider)
to the running editor process and set breakpoints in your script `.cs` files.

## Packaging

**File > Package Project** builds a distributable of your game. See
[Cooking & Packaging](/manual/assets/packaging/).

## Settings

Editor, project, and engine settings are not in this menu, they live under
**File > Settings**. That is also where [input actions](/manual/scripting/input/#defining-actions)
are defined, under **Engine > Input**. See the [Editor Overview](/manual/editor/)
for what it covers.
