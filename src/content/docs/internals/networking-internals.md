---
title: Networking Internals
description: The transport abstraction, the ENet backend, net GUIDs, the replication graph, and the wire protocol.
---

Networking is server authoritative and split into three layers:

- **`INetworkTransport`**, a backend-agnostic reliable-UDP transport. ENet is the
  only implementation.
- **`FNetWorldState`** and the replication graph, the per-world replication
  machinery: identity, interest, and the extract.
- **`SNetworkSystem`**, the per-world entity system that drives it.

For the authoring view see the [Networking](/manual/networking/) manual page.

## The transport

```cpp
class INetworkTransport
{
    virtual ENetworkBackend   GetBackend() const = 0;
    virtual bool              StartServer(const FListenParams&) = 0;
    virtual FConnectionHandle ConnectToServer(const FConnectParams&) = 0;
    virtual bool              IsServer() const = 0;
    virtual void              Disconnect(FConnectionHandle, uint32 Reason = 0, bool bForce = false) = 0;
    virtual bool              Send(FConnectionHandle, const void* Data, SIZE_T Size, uint8 Channel, ESendMode) = 0;
    virtual void              Broadcast(const void* Data, SIZE_T Size, uint8 Channel, ESendMode) = 0;
    virtual void              Service(TVector<FNetworkEvent>& OutEvents) = 0;
    virtual EConnectionState  GetConnectionState(FConnectionHandle) const = 0;
    virtual uint32            GetReliableBacklogBytes(FConnectionHandle) const { return 0; }
    virtual FNetworkStats     GetStats() const { return {}; }
    virtual void              GetConnectionStats(TVector<FConnectionStats>&) const {}
};
```

`FConnectionHandle` is an opaque, transport-agnostic id where 0 is invalid; the
backend maps it to its own peer type. Nothing above the transport sees an
`ENetPeer`.

`Service` is non-blocking, called once per frame by `Network::Update`, and
**appends** events to the caller's vector rather than replacing it.
`ConnectToServer` returns a handle for a still-connecting link; the connected or
disconnected outcome arrives as an event from a later `Service`.

`ESendMode` is `Reliable` (guaranteed, ordered), `Unreliable` (no guarantee,
unsequenced), or `UnreliableSequenced` (no guarantee, but late packets are
dropped).

`GetReliableBacklogBytes` reports reliable data sent but not yet acknowledged. It
is the **backpressure signal for property replication**: when the backlog grows,
the replicator has to stop queueing reliable updates rather than burying the
connection. Backends that cannot report it return 0, which the replicator treats
as no backpressure information.

The optional telemetry hooks default to empty so a new backend compiles without
implementing them.

## The wire protocol

Every packet on the data channel starts with an `ENetMessage` byte so the
receiver can route it:

| Message | Direction | Purpose |
| --- | --- | --- |
| `AssignPeerId` | server to client | Assigns the client its peer id. The server reserves the authority peer id and owns connection 0. |
| `Welcome` | server to client | Which level to load. |
| `ClientReady` | client to server | Map loaded, request the baseline. |
| `OwnershipUpdate` | server to clients | The ownership table. |
| `SpawnEntity` / `DespawnEntity` | server to clients | Spawn with components, and despawn. |
| `PropertyUpdate` | server to clients | Replicated components. Reliable. |
| `ClientTransform` | client to server | Transforms for entities the client owns. |
| `ObjectExport` / `AssetExport` / `NameExport` | server to clients | Net-index maps. |

### The join handshake

```
client connects
server -> AssignPeerId
server -> Welcome (map path)
client travels if its map differs, carrying the live transport across the swap
client -> ClientReady
server -> baseline: exports, spawns, ownership, initial property state
```

The travel step is the interesting one: `FEngine` moves the live
`INetworkTransport` out of the old world and the new world's net system adopts it
(`TakeCarriedConnection`), so a Welcome-driven travel does **not** disconnect and
reconnect. See [Application Lifecycle](/internals/application-lifecycle/).

### Export tables

Object, asset, and name references are sent as compact varint indices rather than
GUIDs or strings.

`FNetObjectMap` holds both directions in one struct: outgoing object-to-index and
index-to-GUID maps, an incoming index-to-object resolved cache, and a pending
export list for indices assigned but not yet sent. Index 0 is null and allocation
starts at 1. `FNetAssetMap` is the same export-once model keyed by GUID, falling
back to path.

The maps are exported once over a **reliable** stream and replayed to late
joiners, so a reference that appears in a thousand updates costs a few bytes each
time after the first.

## Net GUIDs

`FNetGUID` is a stable, peer-agnostic entity identity; 0 is invalid. The id space
is split:

- **Stable ids** occupy `[1, NetGUID_DynamicStart)`. They belong to pre-placed
  entities and are derived **identically on every peer** from the shared loaded
  world, relying on deterministic deserialization. No id assignment traffic is
  needed for level content.
- **Dynamic ids** start at `NetGUID_DynamicStart` and are server-allocated for
  runtime-spawned entities, replicated in spawn records.

`FNetGUIDTable` is the per-world map in both directions.

The determinism requirement is a real constraint: anything that changes entity
creation order during world load breaks stable id agreement between peers, which
manifests as clients associating updates with the wrong entities.

## The replication graph

`NetReplicationGraph` builds a per-tick snapshot and answers "what is relevant to
this client".

### Extract

`FNetExtract` is a flat **structure-of-arrays** snapshot of every
movement-replicating entity, built **once** on the server per tick and reused for
every client's relevancy gather. The array index is a dense record index.

It stores both poses deliberately:

- `Pos`, the **local** pose, which is what goes on the wire (relative for
  attached children).
- `WorldPos`, the **world** pose, used for the grid cell and relevancy distance,
  which is the correct one for attached entities.

Per-record flags:

| Flag | Meaning |
| --- | --- |
| `NETREC_AlwaysRelevant` | Skip interest filtering. |
| `NETREC_Dynamic` | A dynamic net GUID, so it needs per-client spawn and despawn. |
| `NETREC_Changed` | Pose changed since the last extract. The global "did it move at all" gate. |
| `NETREC_ScaleChanged` | Scale changed since last sent. |
| `NETREC_Movement` | Replicates a streamed transform. Without it the entity is spawn and relevancy only. |

The extract runs in parallel with per-thread append-local scratch
(`FNetExtractThread`) merged serially afterward, and the scratch is reused across
ticks so a steady-state server does not reallocate.

An entity with **no transform cannot be placed in the grid**, so it must be
marked always relevant or it will never replicate. The graph enforces this
explicitly.

### Interest and LOD

Relevancy is a uniform spatial grid on the XZ plane sized by the world's
half extent and cell size. For each client, the gather visits the cells around
the client's viewpoint and classifies each candidate by squared distance:

```cpp
ENetLODTier TierForDistanceSq(float DistSq, const SDefaultWorldSettings& Settings);
// > AOILeaveRadius        -> Cull
// <= TierNearDistance     -> Near
// <= TierMidDistance      -> Mid
// otherwise               -> Far
```

Entering and leaving use **different radii** (hysteresis), so an entity hovering
at the boundary does not thrash spawn and despawn. After leaving, a grace period
delays the despawn; the client's copy simply goes stale meanwhile.

Tier drives both send rate and precision. `TierPosQuantum` quantizes position per
tier (1 mm near, 1 cm mid, coarser far), so distant entities cost fewer bits as
well as fewer packets.

`RelevancyTick` is a generation stamp bumped once per tick, which is how the
gather marks what it saw without clearing per-client state.

All of the tuning lives on `SDefaultWorldSettings` under the Networking category.
See the [Networking](/manual/networking/) manual page for the values.

## The network system

`SNetworkSystem` is a per-world entity system running at
`FrameStart` with `EUpdatePriority::Highest`, so replication is applied before
any gameplay system reads state.

Its per-tick shape on a server:

1. Service the transport and process events and inbound messages.
2. Build the `FNetExtract` snapshot.
3. For each client: gather relevant records from the grid, diff against what that
   client already has, and emit spawns, despawns, and transform or property
   updates at the tier's rate.
4. Send, respecting the reliable backlog backpressure.

On a client it services the transport, applies inbound spawns and updates, and
sends `ClientTransform` for owned entities at the frequency the server
replicated to it.

`SNetMovementInterpSystem` handles the presentation half: each simulated proxy
keeps a ring of timestamped samples and is rendered a small delay behind the
newest server time. The delay is **adaptive**, derived from the observed spacing
between samples, so a low-rate far-tier proxy buffers enough to interpolate
rather than extrapolate. Past the newest sample, position may extrapolate from
the last velocity, capped; **rotation is held**, because angular extrapolation
overshoots and jitters visibly.

A proxy's physics body is switched to kinematic once it exists
(`bProxyPhysicsConfigured`), so the local simulation stops fighting replicated
transforms.

## Script replication

`EScriptRepCondition` narrows who receives a script-replicated field:

| Condition | Sent to |
| --- | --- |
| `Always` | Every client. |
| `OwnerOnly` | Only the entity's owning client. |
| `SkipOwner` | Every client except the owner. |
| `InitialOnly` | Once, in the spawn baseline. Never in dirty updates. |

`ERpcMode` covers the call directions: `Server` (client to authority), `Client`
(server to the owning client), and `Multicast` (server to all peers).

`ScriptRepState` tracks per-entity dirty state for script-declared replicated
fields.

## Roles

`ENetRole` is resolved per peer, per entity: `Authority` on the server,
`SimulatedProxy` for a remotely owned entity on a client, `AutonomousProxy` for a
locally controlled proxy, and `None` before resolution. `SNetworkComponent`
exposes local and remote role plus the owning connection id as read-only,
non-serialized debug fields.

**Client-side prediction is not implemented.** `AutonomousProxy` exists and the
transform path is built to accommodate it later, but an autonomous proxy is not
predicted today.

## Common failure modes

| Symptom | Cause |
| --- | --- |
| An entity never replicates | No transform and not marked always relevant, so it cannot be placed in the interest grid. |
| Clients associate updates with the wrong entity | Stable net GUID disagreement. Something made world load non-deterministic. |
| Entities pop in and out at a distance | Enter and leave radii too close together, or the grace period too short. |
| Distant entities jitter | Position quantization at the far tier. Raise the tier distance rather than the quantum. |
| A dropped packet leaves an entity permanently offset | Transform keyframes disabled. They exist so a lost delta self-heals. |
| The connection buries under reliable traffic | Backpressure ignored, or a backend that does not report `GetReliableBacklogBytes`. |
| Late joiners resolve references to null | The export table was not replayed to them. Exports are replay-on-join by design. |
| A client reconnects on level travel | The live transport was not carried across the world swap. |
