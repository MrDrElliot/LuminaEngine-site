---
title: Globals & Helpers
description: Ambient world access and the static engine APIs, Time, Trace, Sound, Fx, Debug, Gizmo, Game, and entity sugar.
---

Most engine APIs hang off `World` (e.g. `World.Physics`, `World.Audio`). For the
things you reach for constantly, there's a cleaner, s&box-style surface: **static
APIs and entity extensions that resolve the world for you.** They work anywhere a
gameplay callback is running: `OnUpdate`, `OnInput`, collision/perception
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
passed in. Outside a callback (e.g. a worker thread) `Game.World` throws, so check
`Game.InWorld` if you're unsure.

## Time

```csharp
float dt  = Time.Delta;   // seconds since last frame
double t  = Time.Now;     // seconds since the world started
```

No need to thread the `OnUpdate(float dt)` argument through your helpers,
`Time.Delta` reads the current frame's delta anywhere.

## Components

`Entity` is a plain id, so components are reached through `World.Registry`, keyed
by entity:

```csharp
if (World.Registry.TryGet<SHealthComponent>(other) is { } health)
{
    health.ApplyDamage(10.0f, Entity);
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

`Trace` is a fluent physics query: build it, then `Run()` (closest hit) or
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
first counterpart to the [`World.Audio`](/manual/audio/playback/) facade.)

## Fx

The visual counterpart to `Sound`. Each call spawns an effect entity and
despawns it after `Lifetime` seconds (5 by default).

```csharp
Fx.Play(Explosion, hit.Point);                          // burst at a point
Fx.PlayAligned(Impact, hit.Point, hit.Normal);          // oriented along a surface
Fx.PlayAttached(MuzzleFlash, Entity, "Muzzle");         // parented, follows a socket
Fx.Stop(effect);                                        // stop emitting, let live particles finish
```

| Call | Effect |
| --- | --- |
| `Fx.Play(system, location, lifetime?)` | Bursts at a world point |
| `Fx.Play(system, transform, lifetime?)` | Bursts at a full transform, keeping an authored scale or rotation |
| `Fx.PlayAligned(system, location, normal, lifetime?)` | Oriented along a normal, the shape an impact wants |
| `Fx.PlayAttached(system, target, socket?, offset?, lifetime?)` | Parented to an entity, optionally on a named socket or bone |
| `Fx.Stop(effect)` | Stops emitting without cutting off live particles |

Every overload also accepts a `TSoftObjectPtr<CParticleSystem>`, so a
`[Property]` reference plays without resolving it first. An unset reference is a
no-op rather than an error.

:::note
`PlayAttached` takes the offset before the lifetime, unlike `Play`. Pass
`Lifetime:` by name when you skip the offset.
:::

## Game

```csharp
Game.OpenLevel("/Game/Content/Maps/Arena");   // deferred to the next frame start
Game.OpenLevel("192.168.1.5:7777");           // or connect to a server
Game.Quit();                                  // exits the process, ends the Play session in the editor
```

`Game.Instance` is the persistent game instance (`GetInstance<T>()` for your own
subclass), and `Game.World` / `Game.InWorld` are the ambient world described
above. Both `OpenLevel` and `Quit` defer to a safe frame point, so they are fine
to call from any callback.

## Debug

```csharp
Debug.Log($"picked up {item}");
Debug.LogWarning("no spawn point assigned");
Debug.LogError("target prefab failed to load");
```

Goes to the console, `Lumina.log`, and the editor's Output Log, tagged `[C#]`.
See [Logging](/manual/logging/).

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

`GameTask` gives real `await` on the game thread, the continuation resumes on
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
await cancels cleanly when the entity is destroyed, otherwise the continuation
would run after the script is gone.

:::caution
These are for the **game thread** only. A `GameTask` await resumes on the game
thread (don't `ConfigureAwait(false)` it), so the world is live after it. For
parallel CPU work use [`Task`](/manual/scripting/tasks/) (the job system), and
don't touch the world from a worker task body.
:::

## Creating entities

```csharp
Entity e = World.CreateEntity("Crate", position);                        // empty entity at a point
Entity p = World.SpawnPrefab("/Game/Content/Prefabs/Enemy", spawnPoint);
```

`World.CreateEntity` makes a bare entity you build up with
`World.Registry.Emplace<T>(e)`; `SpawnPrefab` instantiates a prefab. Both are
covered in [The World API](/manual/scripting/world/).
