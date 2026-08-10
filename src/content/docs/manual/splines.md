---
title: Splines
description: The Spline component, an editable curve you can shape in the viewport and sample from C++ or a GPU shader.
---

The **Spline** component turns an entity into an editable curve. You place
control points in the viewport, shape the curve with tangent handles, and then
sample it, either on the CPU or, if you switch the upload on, directly in a
compute or material shader.

The component only stores the curve. It does not draw anything at runtime and
does not place meshes for you, it is the data other systems read.

## Adding a spline

Select an entity and choose **Add Component, Spline, Spline**. A fresh component
has no points, so add some with the Spline edit mode below or by expanding
**Points** in the Details panel.

Control points live in the entity's local space, so moving or rotating the
entity carries the whole curve with it.

## Editing in the viewport

Pick **Spline** from the viewport mode dropdown (the vector curve icon). The mode
takes over viewport input while it is active, so clicking a control point can
never be mistaken for picking a different entity. Select an entity that has a
Spline component first, the toolbar tells you if you have not.

| Action | How |
| --- | --- |
| Select a point | Click it. |
| Move a point or handle | Drag the translate gizmo. |
| Insert a point on the curve | Ctrl and click anywhere along the curve. |
| Add a point at the end | The **+** button in the toolbar. |
| Delete the selected point | **Del**, or the **-** button. |
| Deselect | Click empty space. |

The selected point also shows its two tangent handles, a blue one for the
incoming tangent and a green one for the outgoing tangent. Dragging either
switches that point to **User** tangents, because otherwise the automatic
tangents would overwrite your drag on the next frame. **Reset Tangents** in the
toolbar puts every hand authored point back to **Auto**.

Points are numbered in the viewport so the order matches what you see in the
Details panel. Toggle the numbers with the **Indices** checkbox.

## Tangent modes

Each point chooses how its tangents are produced.

| Mode | What it does |
| --- | --- |
| **Auto** | Catmull-Rom, tangents come from the neighboring points. The curve stays smooth as you move things. |
| **Linear** | The segments either side become straight lines. |
| **User** | You author the tangents by hand, nothing recomputes them. |

Mixing modes along one spline is normal, an **Auto** run with a single **Linear**
point gives you a smooth curve with one sharp corner.

## Properties

| Property | What it does |
| --- | --- |
| **Points** | The control points, in order along the curve. |
| **Closed Loop** | Adds a closing segment from the last point back to the first. |
| **Default Up Vector** | Reference up. The per sample up is this vector made perpendicular to the tangent, then rolled. |
| **Send To GPU** | Uploads this spline so shaders can sample it. Off by default. |
| **Samples Per Segment** | Density of the uploaded arc length table. See below. |
| **Draw Debug** | Draw the curve in the viewport when the entity is selected. |

Each point additionally carries a **Scale** and a **Roll** (in degrees), both
interpolated along the curve and both carried through to the GPU. Nothing in the
engine consumes them on its own, they are there for whatever you build on top.

## Two ways to address the curve

This matters more than anything else on the page, because picking the wrong one
gives you a curve that moves at the wrong speed.

**Key space** runs from 0 to the segment count. The integer part picks the
segment and the fraction is the position inside it. It is the exact curve, but
it is *not* constant speed, equal key steps cover unequal distances, so a long
segment and a short one both take one unit of key.

**Distance** is world space arc length, from 0 to the total length. This is what
you want for placing objects at even spacing, moving something along the curve at
a fixed rate, or anything where "halfway" should mean halfway.

Key space is available everywhere. Distance is backed by a baked table, which is
built on demand on the CPU and uploaded when **Send To GPU** is on.

## Sampling on the CPU

`SSplineComponent` evaluates key space directly. All of these clamp to the ends.

```cpp
#include "World/Entity/Components/SplineComponent.h"

const SSplineComponent& Spline = Registry.get<SSplineComponent>(Entity);

const int32 NumSegments = Spline.GetNumSegments();
const float MidKey      = Spline.GetKeyRange() * 0.5f;

const FVector3 Position = Spline.EvaluatePosition(MidKey);
const FVector3 Tangent  = Spline.EvaluateTangent(MidKey);   // not normalized
const FVector3 Up       = Spline.EvaluateUpVector(MidKey);
const FVector3 Scale    = Spline.EvaluateScale(MidKey);
const float    Roll     = Spline.EvaluateRoll(MidKey);
```

These are local space, matching the stored points. Transform by the entity's
world matrix if you need world space.

For distance based sampling, build the arc length table yourself. Pass the
transform you want baked into the result, so passing the entity's world matrix
gives you world space samples and a world space length.

```cpp
TVector<FSplineSample> Samples;
const float TotalLength = BuildSplineSamples(Spline, Transform.GetWorldMatrix(), Samples);

// Place ten objects at even spacing along the curve.
for (int32 i = 0; i < 10; ++i)
{
    const float Distance = TotalLength * (i / 9.0f);
    const FSplineSample S = SampleSplineAtDistance(Samples, TotalLength, Distance);

    // S.Position, S.Tangent, S.Up, S.Scale, S.Roll, S.Key, S.DistanceAlong
}
```

`BuildSplineSamples` walks the curve densely, accumulates chord length, then
resamples that polyline at a uniform distance step. The table it returns is
uniform in distance, which is what makes the lookup a divide instead of a
search. It is not cached, so hold onto the result rather than rebuilding it per
frame.

If you change **Points**, **Closed Loop**, or a point's tangent mode from code,
call `UpdateTangents()` afterwards. It recomputes every point that is not set to
**User**.

## Sampling on the GPU

Switch on **Send To GPU**. Each frame, every enabled spline component with the
flag set is extracted, its control points and arc length table are baked into
world space and uploaded, and pointers to them land in the scene root. A spline
without the flag costs nothing.

Include the sampling library and read by index.

```hlsl
#include "Includes/Spline.slang"

[shader("compute")]
[numthreads(64, 1, 1)]
void ComputeMain(uint3 Tid : SV_DispatchThreadID)
{
    const uint SplineIndex = 0;
    if (!IsValidSpline(SplineIndex))
    {
        return;
    }

    // Constant speed. Spread this dispatch evenly along the curve.
    const float Alpha = float(Tid.x) / 63.0;
    FGPUSplineSample S = SampleSplineNormalized(SplineIndex, Alpha);

    float3 WorldPos = S.Position;
    float3 Forward  = S.Tangent;      // normalized
    float3 Up       = S.Up;

    // Or an orthonormal frame, right / up / forward.
    float3x3 Frame = SplineSampleFrame(S);
}
```

| Function | What it gives you |
| --- | --- |
| `NumSplines()` | How many splines were uploaded this frame. |
| `IsValidSpline(Index)` | Bounds check. Always do this, the count changes as components are enabled. |
| `SampleSplineAtDistance(Index, Distance)` | Constant speed sample at a world space distance. Clamps. |
| `SampleSplineNormalized(Index, Alpha)` | The same, with alpha in 0 to 1. |
| `GetSplineLength(Index)` | Total world space arc length. |
| `EvaluateSplineAtKey(Index, Key)` | Exact curve position in key space, read straight from the control points. |
| `EvaluateSplineTangentAtKey(Index, Key)` | Exact derivative, not normalized. |
| `SplineSampleFrame(Sample)` | Orthonormal right / up / forward frame for a sample. |
| `FindNearestDistanceOnSpline(Index, WorldPos, out DistSq)` | Closest point on the curve, as a distance along it. |

Everything the GPU sees is **world space**, the entity transform is baked in at
extract time. The header still carries `LocalToWorld` and `WorldToLocal` if you
need to go the other way.

`FindNearestDistanceOnSpline` scans the whole table, so it is O(sample count).
One query per thread against a moderate table is fine, a loop over a dense one is
not.

### Which index is my spline?

Splines are uploaded in whatever order the ECS iterates, so the index is not
stable across frames or across edits. For a single spline in the world, index 0
is fine. Otherwise match on `FGPUSpline::EntityID`, which carries the owning
entity so you can correlate a header back to the component that produced it.

### Sizing the table

**Samples Per Segment** sets the arc length table's density. The uploaded table
holds `(segments * samplesPerSegment) + 1` entries at 64 bytes each, so a
20 segment spline at the default 16 costs about 20 KB.

Raise it when a tightly curved spline reads as faceted, because the table
interpolates linearly between entries. Lower it for long, gentle curves. It only
affects distance based sampling, `EvaluateSplineAtKey` reads the control points
directly and is exact at any density. It also does not affect the editor
viewport, which draws at its own resolution.

## Common failure modes

| Symptom | Cause |
| --- | --- |
| Objects bunch up on tight curves | Sampled in key space instead of by distance. Use `SampleSplineAtDistance`. |
| A shader reads nothing | **Send To GPU** is off, or the entity is disabled, or the index is stale. Check `NumSplines()`. |
| Tangent drags snap back | The point is on **Auto** or **Linear**. Dragging a handle sets **User**, editing the values in the Details panel does not. |
| The curve is faceted in a shader but smooth in the viewport | **Samples Per Segment** is too low. The viewport draws at its own resolution. |
| Up vector flips along the curve | The curve runs parallel to **Default Up Vector**. Pick a reference up the spline does not align with. |
