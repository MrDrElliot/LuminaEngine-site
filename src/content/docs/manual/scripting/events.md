---
title: Events
description: The entity message bus for decoupled communication.
---

Entities talk to each other through a publish and subscribe bus, so one entity
can react to another without looking it up or holding a reference. Each entity's
bus is `self.Events`.

```lua
function Script:OnReady()
    self.Events:Subscribe("Damaged", function(payload)
        self.Health = self.Health - payload.Amount
    end)
end

-- From anywhere, including another entity's script:
self.Events:Dispatch("Damaged", { Amount = 10 })
```

| Call | Effect |
| --- | --- |
| `self.Events:Subscribe(name, handler)` | Run `handler(payload)` when `name` fires. Cleaned up when the entity is destroyed. |
| `self.Events:Dispatch(name, payload)` | Fire `name` now. |
| `self.Events:DispatchDeferred(name, payload)` | Fire `name` at the end of the frame. |

The event **name** is any string you choose, and the **payload** is any table.
There is no schema, so the sender and receiver just have to agree on the shape.

:::note
This bus is for your own gameplay messages. Engine-driven callbacks like physics
contacts are delivered as lifecycle functions instead, see
[Physics & Collisions](/manual/scripting/physics/).
:::
