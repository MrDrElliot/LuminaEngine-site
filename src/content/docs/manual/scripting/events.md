---
title: Events
description: The gameplay message bus and component signals for decoupled communication.
---

Entities communicate without holding references to each other in two ways: a
**message bus** for your own gameplay events, and **component signals** for
reacting to components being added, removed, or changed. Engine-driven physics
contacts arrive as lifecycle hooks instead — see
[Physics & Collisions](/manual/scripting/physics/).

## The message bus

`World.Messages` is a per-world, type-safe publish/subscribe bus. Listeners
declare the payload type they expect, and broadcasts are routed on hierarchical
[gameplay tag](https://en.wikipedia.org/wiki/Tag_(metadata)) channels like
`"Combat.Damage"`.

Define a payload (any struct or class), subscribe to a channel, and dispose the
subscription when you're done:

```csharp
public struct DamageMessage
{
    public Entity Source;
    public float Amount;
}

public sealed class Health : EntityScript
{
    private float _Hp = 100.0f;
    private IDisposable _Sub = null!;

    public override void OnReady()
    {
        _Sub = World.Messages.Subscribe<DamageMessage>("Combat.Damage", OnDamage);
    }

    private void OnDamage(DamageMessage Msg)
    {
        _Hp -= Msg.Amount;
    }

    public override void OnDetach()
    {
        _Sub.Dispose();      // stop listening before the entity goes away
    }
}
```

Broadcast from anywhere — another entity's script, a system, the world itself:

```csharp
World.Messages.Broadcast("Combat.Damage", new DamageMessage { Source = Entity, Amount = 10.0f });
```

| Call | Effect |
| --- | --- |
| `World.Messages.Subscribe<T>(channel, handler)` | Run `handler(T)` for matching broadcasts; returns an `IDisposable`. |
| `World.Messages.Broadcast<T>(channel, message)` | Send `message` on `channel` now. |

### Hierarchical channels

Channels are dotted tags, and matching is hierarchical: a listener on
`"Combat.Damage"` also hears a broadcast on `"Combat.Damage.Fire"`. This is the
default (`GameplayTagMatch.Partial`). Pass `GameplayTagMatch.Exact` as the third
argument to receive only that exact channel.

```csharp
World.Messages.Subscribe<DamageMessage>("Combat", OnAnyCombat);                       // hears Combat.*
World.Messages.Subscribe<DamageMessage>("Combat.Damage", OnDamage, GameplayTagMatch.Exact);
```

The bus is per-world, so PIE sessions and multiple worlds stay isolated.

## Component signals

`World.Registry` exposes the underlying ECS lifecycle signals — fire a callback
whenever a component is **added**, **removed**, or **patched** on any entity.
Each returns an `IDisposable`; dispose it before the world tears down.

```csharp
private IDisposable _OnSpawn = null!;

public override void OnReady()
{
    _OnSpawn = World.Registry.OnConstruct<SEnemyTag>(E =>
    {
        Debug.Log($"enemy {E} spawned");
    });
}
```

| Call | Fires when |
| --- | --- |
| `Registry.OnConstruct<T>(Action<Entity>)` | A `T` component is added to an entity |
| `Registry.OnDestroy<T>(Action<Entity>)` | A `T` is removed (or its entity destroyed) |
| `Registry.OnUpdate<T>(Action<Entity>)` | A `T` is patched (see below) |
| `Registry.Patch<T>(entity)` | Pulses `OnUpdate` for that entity's `T` |

You can build your own typed events out of these: declare a component as a
channel, `Emplace` it to raise `OnConstruct`, mutate it and `Patch` it to pulse
`OnUpdate`, and `Remove` it to raise `OnDestroy`.
