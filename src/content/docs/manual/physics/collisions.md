---
title: Collisions & Triggers
description: Controlling what collides with what, and detecting overlaps.
---

## Collision layers

Every body has a **Collision Profile** with a **Layer** and a **Mask**.

- **Layer** is the category this body belongs to.
- **Mask** is the categories this body collides against.

Two bodies collide if **either one's mask includes the other's layer**. The
built-in layers are **Static**, **Dynamic**, and **Channel 0** through
**Channel 13** for your own gameplay categories. For example, put bullets on a
channel and give them a mask of only the layers they should hit, so they pass
through everything else.

By default a body's Layer is **Dynamic** and its Mask is **Static + Dynamic**, so
ordinary bodies collide with the world and each other.

## Solid colliders vs triggers

By default a collider is **solid**. Bodies bounce off it, and you receive
**contact** events.

Turn on a collider's **Is Trigger** flag and it stops being solid. Bodies pass
through it, but you receive **overlap** events. Use triggers for pickups,
checkpoints, and damage volumes. The rigid body's **Is Sensor** flag does the
same thing at the whole-body level.

## Reacting in a script

Bind a handler to the rigid body's collision events. Cache the
`SRigidBodyComponent` with `[RequireComponent]` and bind in `OnReady`.
**Contacts** come from solid colliders, **overlaps** from triggers.

```csharp
[RequireComponent] private SRigidBodyComponent _Body = null!;

public override void OnReady()
{
    _Body.OnContactBegin.Bind(OnHit);
    _Body.OnOverlapBegin.Bind(OnEnterTrigger);
}

private void OnHit(SCollisionEvent Event)
{
    Debug.Log($"hit {Event.Other} at {Event.ImpactSpeed} m/s");
}

private void OnEnterTrigger(SCollisionEvent Event)
{
    Debug.Log($"entered trigger of {Event.Other}");
}
```

The full event set (`OnContactBegin`/`OnContactEnd`, `OnOverlapBegin`/
`OnOverlapEnd`) and every `SCollisionEvent` field are in
[Scripting › Physics](/manual/scripting/physics/).
