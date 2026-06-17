---
title: Viewport
description: Navigating and editing the 3D scene.
---

The viewport is your window into the world. Move the camera, select entities,
and transform them with the gizmo.

## Camera

| Action | Control |
| --- | --- |
| Fly the camera | Hold **right mouse**, then **WASD** |
| Adjust fly speed | **Mouse wheel** while flying |
| Frame the selection | **F** |
| Frame the whole scene | **Home** |
| Save / recall a camera bookmark | **Ctrl+1..9** / **1..9** |

## Selecting

- Click an entity in the viewport or the [Scene Outliner](/manual/editor/panels/).
- **Ctrl-click** adds to the selection, **Shift-click** range-selects.
- **Marquee-drag** across empty space for a box selection.
- **Esc** clears the selection.

## The gizmo

These apply with the viewport focused and the camera not flying.

| Key | Mode |
| --- | --- |
| **W** | Translate (move) |
| **E** | Rotate |
| **R** | Scale |

- **Spacebar** cycles the modes, **X** toggles between **world** and **local** space.
- Hold **Ctrl** while dragging a move to **vertex-snap** to the nearest mesh vertex.
- Grid, rotation, and scale **snapping** are set in the snap popup on the viewport toolbar.
- **End** drops the selection straight down onto the floor below it.

## Running the world

- **Play** duplicates the world and runs it like the game (physics, input, scripts). **Stop** returns to the editor world.
- **Simulate** runs physics and scripts in place, without switching worlds.
- **Game View** (**G**) hides the grid, billboards, bounds, and gizmos, so you see exactly what a runtime camera would.

## Screenshots

**F9** saves a tonemapped PNG and **Shift+F9** saves a linear HDR, both into the
engine's `Saved/Screenshots` folder. **F11** triggers a RenderDoc capture when
RenderDoc is attached.
