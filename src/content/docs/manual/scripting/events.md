---
title: Events
description: The gameplay message bus and component signals for decoupled communication.
---

Entities communicate without holding references to each other in two ways, a
**message bus** for your own gameplay events, and **component signals** for
reacting to components being added, removed, or changed. Engine-driven signals
like physics contacts and AI perception are exposed as component events you bind
a handler to; see [Physics & Collisions](/manual/scripting/physics/) and
[AI Perception](/manual/scripting/perception/).

## The message bus

`World.Messages` is a per-world, type-safe publish/subscribe bus. Listeners
declare the payload type they expect, and broadcasts are routed on hierarchical
[gameplay tag](https://en.wikipedia.org/wiki/Tag_(metadata)) channels like
`"Combat.Damage"`.

Define a payload (any struct or class), subscribe to a channel, and dispose the
subscription when you're done.

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

Broadcast from anywhere, whether another entity's script, a system, or the world itself.

```csharp
World.Messages.Broadcast("Combat.Damage", new DamageMessage { Source = Entity, Amount = 10.0f });
```

| Call | Effect |
| --- | --- |
| `World.Messages.Subscribe<T>(channel, handler)` | Run `handler(T)` for matching broadcasts; returns an `IDisposable`. |
| `World.Messages.SubscribeOnce<T>(channel, handler)` | Like `Subscribe`, but auto-unsubscribes after the first matching message. |
| `World.Messages.Broadcast<T>(channel, message)` | Send `message` on `channel` now, to every listener in the world. |

### Hierarchical channels

Channels are dotted tags, and matching is hierarchical. A listener on
`"Combat.Damage"` also hears a broadcast on `"Combat.Damage.Fire"`. This is the
default (`GameplayTagMatch.Partial`). Pass `GameplayTagMatch.Exact` as the third
argument to receive only that exact channel.

```csharp
World.Messages.Subscribe<DamageMessage>("Combat", OnAnyCombat);                       // hears Combat.*
World.Messages.Subscribe<DamageMessage>("Combat.Damage", OnDamage, GameplayTagMatch.Exact);
```

The bus is per-world, so PIE sessions and multiple worlds stay isolated.

### Directional messaging

`Broadcast` reaches every listener in the world. Sometimes you instead want a
message to travel only along an entity's place in the scene graph, for example a
turret notifying its mounting vehicle, or a vehicle telling all of its parts to
power down. `SendUp`, `SendDown`, and `SendTo` do exactly that.

`SendUp` delivers to the source entity and then each of its ancestors up to the
root. `SendDown` delivers to the source entity and then every descendant,
depth-first. `SendTo` delivers to a single target entity. By default a send
includes the source entity too, pass `includeSelf: false` to skip it.

Listeners opt into directional delivery with the entity-scoped `Subscribe`
overload, which takes the owning entity as its first argument. A directional
send reaches such a listener only when the walk arrives at its entity. Plain
`Subscribe` listeners (and `Broadcast`) are unaffected, the two delivery models
share the same channels but separate listener sets.

```csharp
public sealed class VehiclePart : EntityScript
{
    private IDisposable _Sub = null!;

    public override void OnReady()
    {
        // Listen only for sends that walk through THIS entity.
        _Sub = World.Messages.Subscribe<PowerMessage>(Entity, "Power", OnPower);
    }

    private void OnPower(PowerMessage Msg) { /* ... */ }

    public override void OnDetach() => _Sub.Dispose();
}

// On the vehicle root: shut down every part beneath it.
World.Messages.SendDown(Entity, "Power.Off", new PowerMessage());

// On a part: report damage up to whichever ancestor is listening.
World.Messages.SendUp(Entity, "Vehicle.Damage", new DamageMessage { Amount = 25.0f });
```

The same hierarchical channel rule applies, a `Power` listener hears a
`Power.Off` send. Pass `GameplayTagMatch.Exact` to the entity-scoped `Subscribe`
to opt out.

#### Stopping propagation

A directional send walks the whole chain by default. To let an entity *handle* a
message and stop it travelling further, subscribe with a handler that returns
`bool`: return `true` to mark the message handled and halt the route, or `false`
to let it keep going. This is how a shield absorbs damage before it reaches the
body, or a parent vetoes an event meant for its children.

```csharp
public sealed class Shield : EntityScript
{
    private float _Charge = 50.0f;
    private IDisposable _Sub = null!;

    public override void OnReady()
        => _Sub = World.Messages.Subscribe<DamageMessage>(Entity, "Combat.Damage", OnDamage);

    // Return true to absorb the hit so nothing above sees it; false to let it pass on up.
    private bool OnDamage(DamageMessage Msg)
    {
        if (_Charge <= 0.0f)
        {
            return false;
        }
        _Charge -= Msg.Amount;
        return true;
    }

    public override void OnDetach() => _Sub.Dispose();
}

// Damage bubbles up from a part until a shield (or anything else) handles it.
World.Messages.SendUp(Entity, "Combat.Damage", new DamageMessage { Amount = 25.0f });
```

Only directional sends honor the return value, `Broadcast` is fire-and-forget and
ignores it.

| Call | Effect |
| --- | --- |
| `World.Messages.Subscribe<T>(entity, channel, handler)` | Listen for directional sends that reach `entity`; returns an `IDisposable`. |
| `World.Messages.Subscribe<T>(entity, channel, Func<T, bool>)` | Same, but return `true` to handle the message and stop the route. |
| `World.Messages.SendUp<T>(source, channel, message, includeSelf = true)` | Deliver up the scene graph: `source`, then each ancestor. |
| `World.Messages.SendDown<T>(source, channel, message, includeSelf = true)` | Deliver down the scene graph: `source`, then every descendant. |
| `World.Messages.SendTo<T>(target, channel, message)` | Deliver to a single `target` entity. |
| `World.Messages.UnsubscribeAll(entity)` | Drop all of `entity`'s directional subscriptions at once. |

## Component signals

`World.Registry` exposes the underlying ECS lifecycle signals, firing a callback
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

You can build your own typed events out of these. Declare a component as a
channel, `Emplace` it to raise `OnConstruct`, mutate it and `Patch` it to pulse
`OnUpdate`, and `Remove` it to raise `OnDestroy`.
