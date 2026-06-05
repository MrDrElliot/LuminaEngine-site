---
title: Reference
description: Types, math, global tables, and the standard library.
---

This page lists the types and global helpers available to every script. Luau's
own standard library (`math`, `string`, `table`, and so on) is also available,
see the [Luau library reference](https://luau.org/library).

## Vectors

Lumina uses Luau's built-in **`vector`** type for every position, direction, and
color, there is no separate vector class. Build one with `Vec3(x, y, z)`:

```lua
local p: vector = Vec3(0, 2, 0)
print(p.x, p.y, p.z)                          -- component access

local sum    = Vec3(1, 0, 0) + Vec3(0, 1, 0)  -- vectors add and subtract,
local scaled = sum * 2.0                        -- and scale by a number
```

Colors are also `vector`s, with the fourth component as alpha.

## Quaternions

Rotations are `Quat` values, with `.X`, `.Y`, `.Z`, `.W` fields. They support
`*` (compose), comparison, and methods including `:Normalize()`, `:Inverse()`,
`:Conjugate()`, `:Dot(other)`, `:Lerp(other, t)`, `:SLerp(other, t)`,
`:RotateVector(v)`, `:EulerAngles()`, and `:FromAngleAxis(angle, axis)`.

## Math

The `Math` table has engine math helpers beyond Luau's `math` library:

- Constants: `Math.Pi`, `Math.TwoPi`, `Math.HalfPi`, `Math.Epsilon`.
- Scalars: `Clamp`, `Lerp`, `SmoothStep`, `Sign`, `Radians`, `Degrees`, and the trig functions.
- Vectors: `Dot3`, `Cross`, `Length3`, `Normalize3`, `Distance3`, `Lerp3`, `Reflect3`.
- Rotations: `QuatSlerp`, `QuatFromEuler`, `QuatAngleAxis`, `FindLookAtRotation(target, from)`.

## Global tables

### Time

| Call | Returns |
| --- | --- |
| `Time.DeltaTime()` | Seconds since last frame |
| `Time.Now()` | Seconds since start |
| `Time.FrameNumber()` | Frame counter |
| `Time.FPS()` | Current frames per second |

### Engine

| Call | Returns |
| --- | --- |
| `Engine.GetCubeMesh()` | The built-in cube mesh (also `Sphere`, `Cylinder`, `Cone`, `Capsule`) |
| `Engine.GetProjectName()` / `GetProjectPath()` | Project info |
| `Engine.IsGame()` / `IsEditor()` | Which context this is |
| `Engine.Travel(map)` | Open a different map |

### Camera

| Call | Effect |
| --- | --- |
| `Camera.SetActive(entity [, blendTime [, ease]])` | Make an entity's camera active |
| `Camera.GetActive()` | The active camera entity |

Ease values: `Camera.Ease.Linear`, `EaseIn`, `EaseOut`, `EaseInOut`.

### Tasks

Pause-and-resume helpers. See [Tasks & Yielding](/manual/scripting/tasks/).

| Call | Does |
| --- | --- |
| `Wait(seconds)` / `Task.Wait(seconds)` | Pause the current thread, then resume. |
| `Task.Spawn(fn, ...)` | Run `fn` now on a new thread (forwarding args). |
| `Task.Delay(seconds, fn)` | Run `fn` on a new thread after a delay. |
| `Task.Defer(fn)` | Run `fn` on a new thread next frame. |

### Audio

| Call | Returns |
| --- | --- |
| `Audio.PlaySound2D(file)` | A non-positional sound, returns an `AudioHandle` |
| `Audio.PlaySoundAtLocation(file, location)` | A positional sound |
| `Audio.StopAllSounds()` | Stops everything |

An `AudioHandle` has `:Stop()`, `:FadeOut(seconds)`, `:SetVolume(v)`,
`:SetPitch(p)`, `:SetLooping(b)`, and `:IsValid()`.

### Other globals

- `print(...)` writes to the Output Log.
- `Console.Log(...)`, `Console.Warn(...)`, `Console.Error(...)` for leveled logging.
- `Asset.Hard(path)`, `Asset.Soft(path)`, `Asset.LoadAsync(path, callback)`, and `Asset.LoadAwait(path)` (pauses, returns the asset) for asset references.
- `RenderTarget.Paint(target, u, v, radius [, r, g, b, a])` paints into a render-target texture.

## Standard library modules

Like `EntityScript`, these are provided globally, no `require` needed:

- **`Color`**, color constructors and constants: `Color.RGB(r, g, b)`, `Color.RGBA`, `Color.FromBytes`, `Color.HSV`, `Color.Lerp`, and constants like `Color.White`, `Color.Red`.
- **`Random`**, `Random.Range(a, b)`, `Random.RangeInt(a, b)`, `Random.Chance(p)`, `Random.Pick(list)`, and more.
- **`Tween`**, easing functions for the tween scheduler.

## Per-entity helpers

These facets hang off `self` and are scoped to your entity.

### Timers

```lua
self.Timers:After(1.5, function() Explode() end)   -- once, after a delay
local h = self.Timers:Every(0.5, function() Tick() end)  -- repeating
self.Timers:Cancel(h)
```

### Debug drawing

`self.Draw` mirrors `World.Debug` but scoped to this entity (Development and
Debug builds): `self.Draw:Line(a, b, color)`, `:Sphere(center, radius, color)`,
`:Box`, `:Capsule`, `:Cone`, `:Arrow`.

### Tweens

```lua
self.Tween:To("Yaw", 90, 0.5)   -- tween a field on this script over 0.5s
```
