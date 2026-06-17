---
title: First-Person Tutorial
description: Build a small playable first-person scene from scratch.
---

This tutorial builds a **first-person camera you can fly around a scene** with
the mouse and WASD. It pulls together entities, components, the camera, input,
and a script, which is the core of how a Lumina game fits together. It assumes
the editor is running with a project open, see
[Your First Project](/getting-started/first-project/).

## 1. Build a scene to move around in

Before adding a player, give yourself a lit world to look at.

**Add some geometry.** In the **Scene Outliner**, click **+** and add a few
**Cube** primitives. Flatten one into a floor (set its Scale to about
`20, 0.2, 20` in the Details panel), and scatter a couple more as boxes.

**Add lighting.** A fresh scene has no light, so it would render dark. Create an
entity, name it `Lighting`, and in the **Details** panel add three components.

- **Environment**, the sky and image-based lighting.
- **Directional Light**, the sun that lights the scene and casts shadows.
- **Sky Light**, soft ambient fill so shadows are not pitch black.

Now you have a lit world. See [Rendering](/manual/rendering/) for what each of
these controls.

We will not put a mesh on the player itself, in first person you look through its
eyes, so a body mesh would just fill the screen.

## 2. Create the player and give it a camera

1. In the Outliner, click **+** and create an **empty entity**. Rename it `Player`.
2. With `Player` selected, click **+** in the **Details** panel and add a **Camera** component.
3. In the Camera component, tick **Auto Activate** so it becomes the active view when you press Play.

A camera defines the view. Here is the component you just added.

```cpp
struct SCameraComponent
{
    float FOV           = 90.0f;  // vertical field of view, degrees
    bool  bAutoActivate = false;  // become the active view when spawned
    SPostProcessSettings PostProcess;   // per-camera grading + tone mapping

    // callable from script:
    void     SetFOV(float NewFOV);
    float    GetFOV() const;
    FVector3 GetForwardVector() const;
    FVector3 GetRightVector() const;
};
```

A scene can have many cameras; exactly one is **active** at a time. Ticking
**Auto Activate** makes this one active on play.

## 3. Write the player script

Create a `Player.cs` script in your project's `Game/Scripts` folder and open it.
Replace the contents with this.

```csharp
using System;
using LuminaSharp;
using Lumina;

namespace Game;

public sealed class Player : EntityScript
{
    [Property(Min = 0, Units = "m/s", Category = "Player")]
    public float MoveSpeed = 6.0f;

    [Property(Min = 0, Category = "Player")]
    public float LookSensitivity = 0.15f;

    private SInputComponent _Input = null!;
    private float _Yaw;
    private float _Pitch;

    public override void OnReady()
    {
        _Input = EnableInput();   // let this entity read keyboard and mouse
    }

    public override void OnUpdate(float DeltaTime)
    {
        // Look: the mouse turns us left/right (yaw) and up/down (pitch).
        _Yaw += (float)_Input.GetMouseDeltaX() * LookSensitivity;
        _Pitch = Math.Clamp(_Pitch + (float)_Input.GetMouseDeltaY() * LookSensitivity, -89.0f, 89.0f);
        Transform.SetLocalRotationFromEuler(new FVector3(_Pitch, _Yaw, 0.0f));

        // Move: WASD along the direction we are facing.
        float Forward = Axis("W", "S");
        float Strafe = Axis("D", "A");
        FVector3 Move = Transform.GetForward() * Forward + Transform.GetRight() * Strafe;
        Transform.Translate(Move * (MoveSpeed * DeltaTime));
    }

    private float Axis(string Positive, string Negative)
    {
        return (_Input.IsKeyDown(Positive) ? 1.0f : 0.0f) - (_Input.IsKeyDown(Negative) ? 1.0f : 0.0f);
    }
}
```

### How it works

- **`OnReady`** runs once, after the scene graph is set up (see [lifecycle order](/manual/scripting/lifecycle/)).
  - `EnableInput()` adds an Input component so this entity can read input, and returns it so we cache it as `_Input`. Without it, the poll queries read nothing.
- **`OnUpdate`** runs every frame. `DeltaTime` is the seconds since the last frame; multiplying movement by it keeps the speed the same on any machine.
  - We accumulate **Yaw** and **Pitch** from the mouse delta and write them back as the entity's rotation. The `new FVector3(Pitch, Yaw, 0)` order is (pitch about X, yaw about Y, roll about Z), see [Worlds & Coordinates](/manual/worlds-and-coordinates/).
  - We build a **Move** vector from WASD using the entity's own `GetForward` and `GetRight`, then `Translate` along it. The engine is `+Z` forward and `+X` right, so "forward" is wherever you are looking.
- The two **`[Property]`** values show up as editable fields on the Player in the editor, tune them without touching code.

## 4. Attach the script

Select the `Player` entity, add a **C# Script** component in the Details panel,
and set its **Script Class** to your script's type name, `Game.Player` for the
script above (the namespace plus the class name).

## 5. Play

Press **Play** on the viewport toolbar, then click the viewport to give it focus.
Moving the mouse looks around, and WASD moves you through the scene. Press
**Stop** to return to the editor.

That is a complete gameplay loop, an entity, a camera, input, and a script moving
it every frame.

## Where to go next

- This is a **free-fly** camera, it moves wherever you look. For a character that
  walks on the ground, jumps, and collides with walls, use the
  [Character Controller](/manual/physics/characters/).
- To go deeper on the camera (third-person follow, spring-arm booms, blending),
  see [Cameras](/manual/cameras/).
- For the full scripting API, see [C# Scripting](/manual/scripting/).
