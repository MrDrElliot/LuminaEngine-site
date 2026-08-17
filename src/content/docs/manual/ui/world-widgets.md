---
title: World Widgets
description: Rendering an RmlUi document onto a surface in the level with the Widget Component.
---

A **Widget Component** renders an `.rml` document onto a quad that lives in the
world: a screen on a control console, a floating name plate, a readout on a
machine. The document is laid out into an offscreen render target each frame and
the quad samples it.

This is the world-space counterpart to [`World.UI`](/manual/scripting/ui/), which
draws over the viewport instead. They share the markup language and nothing else:
separate contexts, separate lifetimes, different capabilities.

## Setting one up

Add a **Widget** component to an entity and point it at a document.

| Property | Does |
| --- | --- |
| **Document Path** | The `.rml` to display. Empty draws nothing. The reference survives renaming the file. |
| **Draw Width** / **Draw Height** | Resolution of the offscreen target, in pixels. This is the document's layout size. |
| **World Size** | Physical size of the quad, in world units. |
| **Billboard** | When on, the quad always faces the camera. When off, it uses the entity's rotation. |
| **Tint** | RGBA multiplied over the widget. |

The component loads and shows the document for you. There is no script call and
no `Show()`: setting the path is enough.

### Sizing it

Draw Width and Draw Height are the resolution; World Size is the physical size.
Keep their aspect ratios matched or the widget appears stretched. Raising the
draw resolution sharpens the text at the cost of a larger render target, so scale
it to how close the player gets.

Density-independent units inside the document resolve against the **draw height**
divided by 1080, so a document authored in `dp` for a 1080-tall target keeps its
proportions if you later change the resolution.

The document is forced to fill its target (`width: 100%; height: 100%`), so a
`body` sized in absolute units will not fill the quad. Size the body in
percentages.

## What world widgets cannot do

Two limits are worth knowing before you design around them.

**They are not interactive.** Viewport input is forwarded to the world's
screen-space context, not to widget contexts. A world widget cannot be clicked,
hovered, or focused. For a control panel the player operates, put a
[physics query](/manual/physics/queries/) behind it and drive the widget's
appearance from the result, or open a screen-space document instead.

**Data binding does not reach them.** `World.UI.AddModel` registers a model on
the world's screen context. A widget component has its own context, so
`data-model` inside a widget document has nothing to bind to. Author world
widgets as static markup, or generate the document text and write it to the file
the widget points at.

## Cost

Each widget is a document layout plus a render-target rasterization, and the
engine already limits both:

- **Off-screen widgets stop updating.** Frustum culling gates the layout, not
  just the draw.
- **Settled widgets go dormant.** When RmlUi reports no pending animation and the
  output has been identical for a few frames, the widget stops ticking and the
  quad keeps sampling the last target. Tune with the `UI.Widget.DormancyFrames`
  console variable, or set it to 0 to always tick.
- **Rasterizations are budgeted per frame.** `UI.Widget.MaxRendersPerFrame`
  caps how many widget targets are re-rasterized in one frame; the rest reuse
  last frame's target and catch up.

The practical consequence: a static sign is nearly free, and an animated one is
not. Avoid `transition` and `@keyframes` on a widget you place many of, because
an animating document never goes dormant.

## Hot reload

Unlike screen-space UI, a world widget watches its file's modification time and
**fully reloads the document** when it changes on disk, stylesheets included. Save
the `.rml` in the [UI editor](/manual/ui/editor/) and the widget in the level
updates, markup changes and all.
