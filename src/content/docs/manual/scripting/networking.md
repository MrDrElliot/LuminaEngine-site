---
title: Networking
description: Authority, ownership, replicated state, and RPCs.
---

:::caution[Experimental]
The networking API is implemented but not yet broadly runtime-tested. Treat this
page as a preview of the intended workflow.
:::

Lumina uses a server-authoritative model. The **server** owns the simulation;
**clients** receive replicated state and send input to the entities they own.
`World.Net` tells a script which side it is on and who owns what.

## Roles and ownership

```lua
if World.Net:IsServer() then
    -- authoritative logic
end

-- Only the peer that controls this entity should run input and camera code:
if World.Net:IsLocallyOwned(self.Entity) then
    self:EnableInput()
end
```

| Method | Returns |
| --- | --- |
| `World.Net:IsServer()` / `IsClient()` / `IsStandalone()` | Which side this is |
| `World.Net:IsNetworked()` / `IsConnected()` | Connection state |
| `World.Net:HasAuthority(e)` | This peer is the authority for `e` |
| `World.Net:IsLocallyOwned(e)` | This peer controls `e` |
| `World.Net:GetOwner(e)` / `SetOwner(e, conn)` | Owning connection (`SetOwner` is server-only) |
| `World.Net:GetLocalRole(e)` / `GetRemoteRole(e)` | The `ENetRole` for `e` |
| `World.Net:GetUniqueId()` | This peer's id (0 on the server) |
| `World.Net:GetLocallyOwnedEntity()` | The entity this client controls, or null |
| `World.Net:GetConnectionCount()` / `GetConnectionAt(i)` | Iterate clients (server) |
| `World.Net:MarkDirty(e)` | Server-only: force a replicated resend |

## Hosting and joining

```lua
World.Net:Host("/Game/Maps/Arena", 7777)   -- listen server; the server picks the level
World.Net:Connect("127.0.0.1", 7777)        -- join a server
```

## Replicated properties

Mark a script field with `--@replicated` and the server's value is sent to
clients. Define an `OnRep_<Field>` function to react on the client:

```lua
--@replicated
Script.Health = 100

--@replicated(OwnerOnly)
Script.Ammo = 30

function Script:OnRep_Health(old: number)   -- runs on clients when Health changes
    print("health is now", self.Health)
end
```

The server changes the value, then calls `World.Net:MarkDirty(self.Entity)` to
have it collected and sent. Conditions refine who receives it: `OwnerOnly`,
`SkipOwner`, `InitialOnly`, or the default `Always`.

## Remote procedure calls

Mark a function with `--@rpc` and calling it dispatches over the network instead
of running locally:

```lua
--@rpc(multicast, reliable)
function Script:SetLabel(text: string)
    self.LabelText = text
end
```

The direction is `server` (client to server), `client` (server to a client), or
`multicast` (server to everyone). Reliability is `reliable` or `unreliable`.
