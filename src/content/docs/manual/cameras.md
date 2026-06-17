---
title: Cameras
description: Setting up and controlling the view, from first-person to third-person.
---

A **camera** defines the view that gets rendered. Add a **Camera** component to
an entity and the engine can render the world from that entity's transform.

```cpp
struct SCameraComponent
{
    float FOV           = 90.0f;  // vertical field of view, degrees
    bool  bAutoActivate = false;  // become the active view when spawned
    SPostProcessSettings PostProcess;                      // grading + tone map
    TVector<TObjectPtr<CMaterialInterface>> PostProcessMaterials;

    void     SetFOV(float NewFOV);
    float    GetFOV() const;
    FVector3 GetForwardVector() const;
    FVector3 GetRightVector() const;
    FVector3 GetPosition() const;
};
```

## The active camera

A world can hold many cameras, but exactly **one is active** and provides the
view. The usual ways to make a camera active:

- Tick **Auto Activate** on the component, so it becomes the view when it spawns.
- Use a **Camera Follow** or **Spring Arm** rig (below) to drive a gameplay camera.

From a script, `World.GetActiveCamera()` returns the active camera component, so
you can read or tune the live view:

```csharp
SCameraComponent Active = World.GetActiveCamera();
Active.SetFOV(70.0f);
```

When the engine switches cameras it can ease the view from the old one to the new
over a blend time, with an easing curve:

```cpp
enum class ECameraBlendFunction : uint8 { Linear, EaseIn, EaseOut, EaseInOut };
```

Use blends for cutscenes, security-camera switches, or a death cam.

## First-person

The simplest setup: one entity with a camera that you rotate directly. A
mouse-look script reads the mouse and writes yaw and pitch onto the camera
entity's transform. See the
[First-Person Tutorial](/getting-started/first-person-tutorial/) for the complete
walkthrough; the heart of it is:

```csharp
_Yaw += (float)_Input.GetMouseDeltaX() * Sensitivity;
_Pitch = Math.Clamp(_Pitch + (float)_Input.GetMouseDeltaY() * Sensitivity, -89.0f, 89.0f);
Transform.SetLocalRotationFromEuler(new FVector3(_Pitch, _Yaw, 0.0f));
```

## Third-person: follow camera

To trail a character, add a **Camera Follow** component to the camera entity and
point it at your player. The camera eases to an offset from the target and can
face it; it follows rather than taking your input.

```cpp
struct SCameraFollowComponent
{
    uint32   Target;                  // entity to follow
    FVector3 Offset = {0, 2, -5};     // where to sit, relative to the target
    bool     bWorldSpaceOffset = false;
    float    PositionLagSpeed = 10.0f;  // higher = snappier, 0 = instant
    bool     bLookAtTarget = true;
    FVector3 LookAtOffset = {0, 1, 0};  // aim a bit above the feet

    void SetTarget(entity);
    void ClearTarget();
};
```

```csharp
SCameraFollowComponent Follow = Registry.Get<SCameraFollowComponent>(Entity);
Follow.SetTarget(World.GetEntityByName("Player"));
```

## Third-person: spring-arm boom

For an over-the-shoulder or orbit camera that **avoids clipping into walls**, use
a **Spring Arm**. It keeps the camera a set distance behind a pivot and shortens
the boom with a sphere-cast when geometry gets in the way. You drive the look
direction by rotating the camera entity (a mouse-look script), and the arm keeps
the camera behind the pivot.

```cpp
struct SSpringArmComponent
{
    uint32   Target;                       // pivot to orbit (e.g. the player)
    FVector3 TargetOffset = {0, 1.5, 0};   // raise the focus to head height
    float    TargetArmLength = 4.0f;       // distance behind the pivot
    FVector3 SocketOffset = {0, 0, 0};     // e.g. over-the-shoulder X
    bool     bUseControlRotation = true;
    bool     bDoCollisionTest = true;      // shorten to avoid wall clipping
    float    ProbeSize = 0.2f;

    void SetTarget(entity);
};
```

A typical third-person rig is two entities: a **player** moved by your input, and
a separate **camera** entity with `SCameraComponent` + `SSpringArmComponent`
targeting the player. Your script yaws and pitches the camera entity; the arm
does the rest.

## Field of view

`FOV` is the vertical field of view in degrees (90 by default). Change it for
zoom or aim-down-sights:

```csharp
Registry.Get<SCameraComponent>(Entity).SetFOV(60.0f);
```

## Per-camera post-processing

Each camera carries its own `PostProcess` settings (tone mapping, exposure, color
grading) and a list of post-process materials. The active camera's grade is what
you see, see [Rendering](/manual/rendering/).
