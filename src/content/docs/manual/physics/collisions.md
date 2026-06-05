---
title: Collisions & Triggers
description: Controlling what collides with what, and detecting overlaps.
---

## Collision layers

Every body has a **Collision Profile** with a **Layer** and a **Mask**:

- **Layer**, the category this body belongs to.
- **Mask**, the categories this body collides against.

Two bodies collide only if each one's mask includes the other's layer. The
built-in layers are **Static**, **Dynamic**, and **Channel 0** through
**Channel 13** for your own gameplay categories. For example, put bullets on a
channel whose mask only includes enemies, and they will pass through everything
else.

## Solid colliders vs triggers

By default a collider is **solid**: bodies bounce off it, and you receive
**contact** events.

Turn on a collider's **Is Trigger** flag and it stops being solid: bodies pass
through it, but you receive **overlap** events. Use triggers for pickups,
checkpoints, and damage volumes. The rigid body's **Is Sensor** flag does the
same thing at the whole-body level.

## Reacting in a script

Define callbacks on a script to respond. **Contacts** come from solid colliders,
**overlaps** from triggers:

```lua
function Script:OnContactBegin(Event: SCollisionEvent)
    print("hit", Event.Other, "at", Event.ImpactSpeed, "m/s")
end

function Script:OnOverlapBegin(Event: SCollisionEvent)
    print("entered trigger of", Event.Other)
end
```

The full callback set (`OnContactBegin/End`, `OnOverlapBegin/End`) and every
`SCollisionEvent` field are in [Scripting › Physics](/manual/scripting/physics/).
