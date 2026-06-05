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
**Cube** primitives: flatten one into a floor (set its Scale to about
`20, 0.2, 20` in the Details panel), and scatter a couple more as boxes.

**Add lighting.** A fresh scene has no light, so it would render dark. Create an
entity, name it `Lighting`, and in the **Details** panel add three components:

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

A camera defines the view. Here is the component you just added:

```cpp
struct SCameraComponent
{
    float FOV           = 90.0f;  // vertical field of view, degrees
    bool  bAutoActivate = false;  // become the active view when spawned
    SPostProcessSettings PostProcess;   // per-camera grading + tone mapping

    // callable from Lua:
    void     SetFOV(float NewFOV);
    float    GetFOV() const;
    FVector3 GetForwardVector() const;
    FVector3 GetRightVector() const;
};
```

A scene can have many cameras; exactly one is **active** at a time. We will make
this one active from the script. (Ticking `bAutoActivate` does the same without
code.)

## 3. Write the player script

Create a `Player.luau` script in your project's `Game/Scripts` folder and open it
in the script editor. Replace the contents with this:

```lua
local Script: EntityScript = EntityScript.new()

--@export(ClampMin = 0, Units = "m/s", Category = "Player")
Script.MoveSpeed = 6.0

--@export(ClampMin = 0, Category = "Player")
Script.LookSensitivity = 0.15

function Script:OnReady()
    self.Yaw   = 0.0
    self.Pitch = 0.0

    self:EnableInput()              -- let this entity read keyboard and mouse
    Camera.SetActive(self.Entity)   -- look through this entity's camera
    Input.SetMouseMode("Captured")  -- hide and lock the cursor for mouse-look
end

function Script:OnUpdate(DeltaTime: number)
    -- Look: the mouse turns us left and right (yaw) and up and down (pitch).
    self.Yaw   = self.Yaw + self.Input:GetMouseDeltaX() * self.LookSensitivity
    self.Pitch = math.clamp(self.Pitch + self.Input:GetMouseDeltaY() * self.LookSensitivity, -89, 89)
    self.Transform:SetLocalRotationFromEuler(Vec3(self.Pitch, self.Yaw, 0))

    -- Move: WASD along the direction we are facing.
    local Move = Vec3(0, 0, 0)
    if self.Input:IsKeyDown("W") then Move = Move + self.Transform:GetForward() end
    if self.Input:IsKeyDown("S") then Move = Move - self.Transform:GetForward() end
    if self.Input:IsKeyDown("D") then Move = Move + self.Transform:GetRight() end
    if self.Input:IsKeyDown("A") then Move = Move - self.Transform:GetRight() end

    self.Transform:Translate(Move * (self.MoveSpeed * DeltaTime))
end

return Script
```

### How it works

- **`OnReady`** runs once, after the scene graph is set up (see [lifecycle order](/manual/scripting/)).
  - `self:EnableInput()` adds an Input component so this entity can read input; without it, `self.Input` is empty.
  - `Camera.SetActive(self.Entity)` makes our camera the view.
  - `Input.SetMouseMode("Captured")` locks the cursor so the mouse drives the look instead of moving a pointer.
- **`OnUpdate`** runs every frame. `DeltaTime` is the seconds since the last frame; multiplying movement by it keeps the speed the same on any machine.
  - We accumulate **Yaw** and **Pitch** from the mouse delta and write them back as the entity's rotation. The `Vec3(Pitch, Yaw, 0)` order is (pitch about X, yaw about Y, roll about Z), see [Worlds & Coordinates](/manual/worlds-and-coordinates/).
  - We build a **Move** vector from WASD using the entity's own `GetForward` and `GetRight`, then `Translate` along it. The engine is `+Z` forward and `+X` right, so "forward" is wherever you are looking.
- The two **`--@export`** values show up as editable fields on the Player in the editor, tune them without touching code.

## 4. Attach the script

Select the `Player` entity, add a **Script** component in the Details panel, and
set its **Script Path** to your `Player` script. (You can also drag the script
onto the entity in the Outliner.)

## 5. Play

Press **Play** on the viewport toolbar. The cursor locks, the mouse looks around,
and WASD moves you through the scene. Press **Stop** to return to the editor.

That is a complete gameplay loop: an entity, a camera, input, and a script moving
it every frame.

## Where to go next

- This is a **free-fly** camera, it moves wherever you look. For a character that
  walks on the ground, jumps, and collides with walls, use the
  [Character Controller](/manual/physics/characters/).
- To go deeper on the camera (third-person follow, spring-arm booms, blending),
  see [Cameras](/manual/cameras/).
- For the full scripting API, see [Lua Scripting](/manual/scripting/).
