---
title: Hot Reload
description: What survives when you save a script while the editor is running, and how to keep values across a rename.
---

Save a `.cs` file while the editor is running and the engine recompiles it in
place. Scripts already attached to entities keep running, with the values you
authored in the Details panel intact.

This page is what survives, what does not, and what to write when you rename
something.

## What survives

| You changed | Result |
| --- | --- |
| A method body | Takes effect immediately. Nothing is rebuilt. |
| Added a `[Property]` | Appears in the Details panel, at its declared default. Other values are untouched. |
| Removed a `[Property]` | Disappears. Its value is dropped. |
| Changed a `[Property]`'s type | Kept if the value converts (a widened number), otherwise reset to the default. |
| Reordered properties | No effect on values. Matching is by name, not position. |
| Renamed a `[Property]` | The value is kept **only** with `[Alias]`. See below. |
| Renamed the script class | Attached scripts move to the new class **only** with `[Alias]` on the class. See below. |
| Deleted a script | Its instances are dropped, and the class disappears from the picker. |

Values survive because a `[Property]` lives in native memory as a real reflected
property, and the reload carries it through the same name-keyed serializer that
saves your scenes. That is also why matching is by name: a value whose property
still exists replays, a removed one is dropped, and an added one lands on its
default instead of picking up whatever was in those bytes.

## What does not survive

Ordinary instance fields, the ones without `[Property]`, are **reset**. A reload
builds new script objects, so anything a script accumulated at runtime, a timer,
a cached target, a counter, starts over.

`OnAttach` and `OnReady` run again on the new instances, so anything those set up
is rebuilt for you.

Hot reload is for tuning and for iterating on logic. It is not a way to preserve
a running game's state.

## Renaming

Matching is by name, so a rename looks like one thing removed and another added.
`[Alias]` is what carries the value across.

```csharp
// Speed was renamed to Velocity, so the old name keeps the authored value.
[Property, Alias("Speed")] public float Velocity = 5.0f;
```

The same attribute works on the script **class**, which moves every attached
script onto the renamed class.

```csharp
[Alias("Game.OldPatrolScript")]
public sealed class Patrol : EntityScript { }
```

Use the full type name, matching what the old class was called including its
namespace.

`[Alias]` is repeatable, so a member or class renamed twice can list both prior
names. It also applies when **loading a scene** saved before the rename, not just
to a live reload, so leaving these in place is what keeps old content loading.

Without an alias the property or class is treated as new. Nothing is corrupted,
the value simply starts at its default.

## Resetting a field on purpose

Sometimes carrying a value across is the wrong thing, for example a field you
tune at edit time but want back at its default whenever you iterate.

```csharp
[Property, SkipHotReload] public float Debug = 0.0f;
```

`[SkipHotReload]` is also valid on the script class, which resets all of its
properties on every reload.

The reset runs after the reload has replayed your authored values, so a field
marked this way always ends up at its declared default no matter what it held.

## When a reload is not enough

A few changes still need the editor restarted.

- Changing the C# signature of a `[NativeCall]` binding, or anything else in
  `LuminaSharp` itself. Only your script assemblies are reloadable.
- Anything on the C++ side, which needs a rebuild.

Adding a new script file, or a whole new script plugin, does not: the reload
rediscovers script units before it compiles.

If a reload fails to compile, the editor keeps running the previous version and
reports the errors in the log. Fix and save again.
