---
title: Globals & Helpers
description: Ambient world access and the static engine APIs — Time, Trace, Sound, Gizmo, and entity sugar.
---

Most engine APIs hang off `World` (e.g. `World.Physics`, `World.Audio`). For the
things you reach for constantly, there's a cleaner, s&box-style surface: **static
APIs and entity extensions that resolve the world for you.** They work anywhere a
gameplay callback is running — `OnUpdate`, `OnInput`, collision/perception
callbacks, and inside `EntitySystem.OnUpdate`.

```csharp
public override void OnUpdate(float dt)
{
    // Instead of World.Physics.Raycast(...) and threading dt around:
    if (Trace.Ray(Eye, Eye + Forward * 100f).IgnoreSelf().Run() is RaycastHit hit)
    {
        Gizmo.Color = Color.Red;
        Gizmo.Line(Eye, hit.Point);
        Sound.PlayAt(Impact, hit.Point);
    }
}
```

## The ambient world

`Game.World` is the world the current callback belongs to. The runtime sets it
around every script and system callback, so the statics below never need a world
passed in. Outside a callback (e.g. a worker thread) `Game.World` throws — check
`Game.InWorld` if you're unsure.

## Time

```csharp
float dt  = Time.Delta;   // seconds since last frame
double t  = Time.Now;     // seconds since the world started
```

No need to thread the `OnUpdate(float dt)` argument through your helpers —
`Time.Delta` reads the current frame's delta anywhere.

## Components

`Entity` is a plain id — components are reached through `World.Registry`, keyed
by entity:

```csharp
if (World.Registry.TryGet<SHealthComponent>(other) is { } health)
{
    health.Current -= 10;
}
```

| Call | Effect |
| --- | --- |
| `World.Registry.Get<T>(entity)` / `TryGet<T>` / `Has<T>` | read a component |
| `World.Registry.Add<T>(entity)` / `GetOrAdd<T>` / `Remove<T>` | add or remove |
| `World.Registry.GetScript<T>(entity)` / `GetScripts<T>` | another entity's first script of type T, or all of them |
| `World.Registry.AddScript<T>(entity)` / `RemoveScript<T>` | attach or detach a script (an entity may hold several) |
| `World.Registry.All<T>()` | iterate every entity with a T |

## Trace

`Trace` is a fluent physics query — build it, then `Run()` (closest hit) or
`RunAll()` (every hit, near to far). It wraps the same engine queries as
`World.Physics` with a cleaner shape.

```csharp
RaycastHit? hit = Trace.Ray(from, to)
    .IgnoreSelf()
    .WithMask(ECollisionProfiles.Static | ECollisionProfiles.Dynamic)
    .Run();

// Thick ray (swept sphere):
RaycastHit[] all = Trace.Sphere(0.5f, from, to).Ignore(Entity).RunAll();
```

| Builder | Effect |
| --- | --- |
| `Trace.Ray(from, to)` / `Trace.Ray(origin, dir, dist)` | A line trace |
| `Trace.Sphere(radius, from, to)` | A swept sphere (thick ray) |
| `.Ignore(entity)` / `.IgnoreSelf()` | Skip a body (or the calling entity's) |
| `.WithMask(profiles)` | Only hit bodies on these collision layers (ray traces) |
| `.Run()` | Closest `RaycastHit?` (null on miss) |
| `.RunAll()` | Every `RaycastHit`, near to far |

## Sound

```csharp
Sound.Play(uiClick);                          // 2D
PlayingSound engine = Sound.PlayAt(loop, pos); // 3D, keep the handle
engine.Pitch = 1.0f + throttle;
engine.Position = Transform.GetWorldLocation();
engine.Stop(fadeOut: true);
```

`Sound.Play` / `Sound.PlayAt` return a `PlayingSound` whose `Volume`, `Pitch`,
`Position`, and `Looping` are settable, plus `Stop()`. (This is the static, code-
first counterpart to the [`World.Audio`](/manual/scripting/audio/) facade.)

## Gizmo

Immediate-mode debug drawing (Dev/Debug builds only). Set the state once, then
draw:

```csharp
Gizmo.Color = Color.Green;
Gizmo.Duration = 2.0f;          // 0 = one frame
Gizmo.Sphere(target, 0.25f);
Gizmo.Line(Eye, target, Color.Red);   // per-call color override
Gizmo.Text("aware");
```

Colors use the `Color` type (named colors like `Color.Red`, `Color.White`,
plus `Color.WithAlpha(a)`); it converts implicitly to the engine's `FVector4`,
so it works in any color parameter. Handy direction constants live on
`FVector3`: `Forward`, `Up`, `Right`.

## Async with GameTask

`GameTask` gives real `await` on the game thread — the continuation resumes on
the game thread with the world still available, so you can touch the world right
after awaiting.

```csharp
public override async void OnReady()
{
    await GameTask.DelaySeconds(1.5f, DestroyToken);
    Sound.Play(spawnSound);

    await GameTask.NextFrame(DestroyToken);

    CMesh mesh = await GameTask.LoadAsync<CMesh>("/Game/Content/Meshes/Boss", DestroyToken);
}
```

| Call | Resumes |
| --- | --- |
| `GameTask.DelaySeconds(s)` | after `s` seconds of world time |
| `GameTask.NextFrame()` | on the next tick |
| `GameTask.LoadAsync<T>(path)` | when the asset finishes loading (returns it) |

Pass `DestroyToken` (a `CancellationToken` on every `EntityScript`) so a pending
await cancels cleanly when the entity is destroyed — otherwise the continuation
would run after the script is gone.

:::caution
These are for the **game thread** only. A `GameTask` await resumes on the game
thread (don't `ConfigureAwait(false)` it), so the world is live after it. For
parallel CPU work use [`Task`](/manual/scripting/tasks/) (the job system) — and
don't touch the world from a worker task body.
:::

## Creating entities

```csharp
Entity e = World.ConstructEntity("Crate", transform);   // empty entity at a transform
Entity p = World.Spawn("/Game/Content/Prefabs/Enemy", spawnPoint);
```

`World.Spawn` is the short alias of `SpawnPrefab`; `World.ConstructEntity` makes a
bare entity (at the given transform) you build up with `World.Registry.Add<T>(e)`.
