---
title: Panels
description: The outliner, inspector, and other docks.
---

## Scene Outliner

The list of every entity in the world. Click to select, drag a row onto another
to reparent, and right-click to rename, delete, group, or create a prefab. The
**+** button creates entities. See [Entities & Components](/manual/ecs/).

## Details

The **inspector** for the selected entity, showing every component and its properties.
The panel is generated from the [reflection system](/manual/reflection/), so a
component's fields show up automatically with the right widget for each type,
color pickers, sliders with units, asset pickers, and entity pickers.

The **+** button in the Details header **adds a component**. Properties are
grouped into the categories each component declares.

## Systems

The systems that run in the active world. **Native Systems** are the engine's
built-in C++ systems; the checkbox enables or disables one for this world (turn
one off to replace it with your own). **C# systems** are discovered automatically
from their `[EntitySystem]` attribute and run in every world. There's no
per-world file to assign. See [World Systems](/manual/scripting/world-systems/). For
per-frame timing, use the profilers under [Tools](/manual/editor/tools/).

## World Settings

Per-world settings for rendering (anti-aliasing and more), physics, and
environment. These belong to the world, not to any one entity. See
[Worlds & Coordinates](/manual/worlds-and-coordinates/).

## Output Log

Engine and script logging, plus a command console for console variables and
commands. Toggle it with **Ctrl+J**.
