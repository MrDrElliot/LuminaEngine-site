---
title: Networking
description: Network role and replication state from a script.
---

:::caution[Experimental]
Lumina's networking is server-authoritative and largely native-side today. The
C# surface is currently the **role queries** below; the script-facing replication
and RPC API is still being built out. Treat this page as the current state, not a
stable contract.
:::

Lumina uses a server-authoritative model. The **server** owns the simulation and
**clients** receive replicated state. `World.Net` tells a script which side it is
running on.

## Role and mode

```csharp
if (World.Net.IsServer)
{
    // authoritative-only logic
}

if (World.Net.IsClient)
{
    // client-only logic (prediction, presentation)
}
```

| Member | Returns |
| --- | --- |
| `World.Net.Mode` | The `ENetMode`, one of `Standalone`, `Client`, `ListenServer`, or `DedicatedServer` |
| `World.Net.IsServer` | `true` on a listen or dedicated server (the authority) |
| `World.Net.IsClient` | `true` on a connected client |
| `World.Net.IsStandalone` | `true` when the world isn't networked |
| `World.Net.IsNetworked` | `true` when running as a client or server |
| `World.Net.ConnectedClients` | Server-side count of connected clients (0 elsewhere) |

A common pattern is to gate authoritative logic behind `IsServer` and run
presentation everywhere.

```csharp
public override void OnUpdate(float DeltaTime)
{
    if (World.Net.IsServer)
    {
        StepSimulation(DeltaTime);
    }

    UpdateVisuals();   // runs on server and clients
}
```

## Replicating state

State replication is configured on the **native** side. A C++ component property
marked `PROPERTY(Replicated)` is collected on the server and applied on clients,
where the change drives the registry's `on_update` signal. From a script you can
observe those applied changes with
[`Registry.OnUpdate<T>`](/manual/scripting/events/#component-signals) on the
replicated component type. Authoring replicated state and RPCs directly in C# is
not yet exposed. See the engine's networking documentation for the native
workflow.
