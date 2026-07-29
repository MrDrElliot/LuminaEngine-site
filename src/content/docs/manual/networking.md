---
title: Networking
description: Net modes, roles, entity replication, and hosting or joining a session.
---

Lumina ships a server-authoritative networking layer built on **ENet** (reliable
UDP). One peer owns the truth and clients receive replicated state.

The model is deliberately close to what you would expect from a shooter-style
engine: a world runs in a **net mode**, entities carry a **role** per peer, and
replication is opt in per entity and per property.

## Net modes

A world runs in exactly one mode, held on its world context:

| Mode | Meaning |
| --- | --- |
| `Standalone` | No networking. The default. |
| `Client` | Connects to a server; the server owns authority. |
| `ListenServer` | A server that also renders and plays locally. |
| `DedicatedServer` | A server with no window, no rendering, and no audio. |

A packaged dedicated server is launched with `-server`, which puts the whole
process into headless mode. In the editor, a dedicated server is chosen per world
by its net mode rather than by a process-wide flag, so you can run one alongside
the editor.

## Starting a session

The engine drives session setup through URLs, and the requests are queued and
applied at the start of the next frame rather than mid-tick:

| Call | Effect |
| --- | --- |
| `OpenLevel(URL)` | The general entry point: host, open standalone, or connect. |
| `HostLevel(Map, Port)` | Start a listen server on a map. Default port 7777. |
| `HostDedicatedLevel(Map, Port)` | Start a dedicated server. |
| `ConnectToServer(Host, Port)` | Join a server. The server's Welcome message decides which map loads. |

When a client connects, the server sends the map path it is running. If it
differs from the client's current map, the client travels to it. The live
connection is **carried across that travel** rather than being dropped and
reopened, so joining does not cost a reconnect.

Each world context carries `NetHost` and `NetPort`, defaulting to
`127.0.0.1:7777`, which is what makes the editor's play-in-editor networking
flow work with no explicit URL.

## Making an entity networked

Add a **Network** component. Its authored properties:

| Property | Meaning |
| --- | --- |
| `Replicates` | When false the entity has a stable network identity but no state is sent. |
| `Always Relevant` | Relevant to every connection, skipping interest management. An entity with no transform cannot be placed in the interest grid, so it **must** be marked always relevant to replicate at all. |
| `Net Load On Client` | When false the entity exists only on the server, and clients strip it at world load. Use for server-only logic entities. |
| `Replicates Movement` | Replicate the transform. The server only sends it on frames where the entity actually moved. |
| `Net Update Frequency` | Sends per second for movement, capping the send rate. Clients interpolate between updates. A value of 0 or less sends every tick. This property is itself replicated so an owning client throttles its own sends to match. |

The component also shows read-only runtime state for debugging, which is never
saved:

- **Net GUID**, the stable network identity resolved per peer.
- **Local Role** and **Remote Role**.
- **Owning Connection Id**, where 0 means server-owned or unowned.

## Roles

| Role | Meaning |
| --- | --- |
| `Authority` | This peer owns the truth. On the server, every replicated entity is Authority. |
| `SimulatedProxy` | Remote-owned. State arrives from the authority and is interpolated. |
| `AutonomousProxy` | A locally controlled proxy of an authority entity. |
| `None` | Not yet resolved. |

Gameplay code branches on the local role: run input and decision logic on
`Authority` or `AutonomousProxy`, and run presentation only on
`SimulatedProxy`.

## Movement replication

Transform replication is the most tuned path in the system.

- The server sends a transform only on frames where the entity moved, quantized,
  with an integer comparison driving change detection.
- Each simulated proxy keeps a ring of timestamped samples.
- The client renders a small delay behind the newest server time, interpolating
  between the two bracketing samples.
- The interpolation delay is **adaptive**: it is derived from the observed
  spacing between samples, so an entity sending at a low rate buffers enough to
  interpolate rather than falling back to extrapolation.
- Past the newest sample, position may extrapolate from the last velocity, capped.
  **Rotation is held rather than extrapolated**, because angular extrapolation
  overshoots and jitters visibly.

A proxy's physics body is switched to kinematic once it exists, so the local
simulation stops fighting the replicated transform.

## Replicated properties

Mark a property `Replicated` in its `PROPERTY` specifier and it participates in
replication. See [Reflection](/manual/reflection/) for the specifier list.

Values are serialized through a dedicated network archive with quantization
helpers for vectors and rotations, so a replicated transform costs far less than
its in-memory size.

## Play in editor

The editor can run networked sessions directly. Set the play mode to run a server
plus one or more clients, and each gets its own world context with the right net
mode. Because the editor and the game share a runtime, a networked PIE session
behaves the same as a packaged one, with the exception of the process-wide
headless flag, which the editor never sets.

The **Network** editor tool shows live connection state, per-entity roles, and
replication traffic.

## Interest management

The server does not send every entity to every client. Replicated entities are
placed in a spatial grid on the XZ ground plane and gathered per client around
that client's viewpoint. All of it is tuned in **World Settings**, under
Networking.

| Setting | Default | Meaning |
| --- | --- | --- |
| **AOI Enter Radius** | 120 m | An entity becomes relevant when it crosses inside this radius of the client's pawn. |
| **AOI Leave Radius** | 150 m | A relevant entity stays relevant until it crosses outside this larger radius. The hysteresis stops spawn and despawn thrash at the boundary. Keep it at or above the enter radius. |
| **Relevancy Grace Seconds** | 1.5 | After an entity leaves the area of interest, wait this long before despawning it on the client. Absorbs fast boundary crossings; the client's copy just goes stale meanwhile. |
| **Grid Cell Size** | 64 m | Cell size for the relevancy broadphase. Roughly the AOI radius is a good default, so a client gathers about four to nine cells. |
| **World Half Extent** | 8192 m | Half-extent of the replicated world on the XZ plane, centered at the origin. Entities outside clamp into the border cells. This sets the grid dimensions. |

### Distance LOD

Relevant entities are further sorted into tiers by distance, and each tier gets
its own send rate and position precision.

| Tier | Boundary | Send rate | Position quantum |
| --- | --- | --- | --- |
| **Near** | up to `Tier Near Distance` (30 m) | Full rate | 1 mm |
| **Mid** | up to `Tier Mid Distance` (80 m) | `Tier Mid Rate` (10 Hz) | 1 cm |
| **Far** | up to the AOI leave radius | `Tier Far Rate` (3 Hz) | Coarser still |
| **Cull** | beyond the leave radius | Not sent | |

Two more world settings shape the stream:

- **Transform Keyframe Interval** (0.5 s): the server periodically re-sends every
  replicated pose in full, so a dropped delta self-heals rather than leaving an
  entity permanently offset. A value of 0 or less disables keyframes.
- **Default Net Update Frequency** (30 Hz): the movement send rate newly
  replicated entities start with, before the per-entity override.

Client-side proxy smoothing is a **global player preference**, not a world
setting; it lives in `CNetworkSettings`.

## Encoding

Two mechanisms keep the wire small:

- **Net GUIDs.** Every replicated entity has a stable, peer-agnostic id. Ids for
  pre-placed entities are derived identically on every peer from the shared
  loaded world (deterministic deserialization) and occupy the low range; ids for
  runtime, server-spawned entities are server-allocated from a higher range and
  replicated in spawn records.
- **Export tables.** Object references, asset references, and names are sent as
  compact varint indices. The index-to-identity map is exported once over a
  reliable stream and replayed to late joiners, so a repeated reference costs a
  couple of bytes rather than a GUID or a string.

## What is not there yet

- **Client-side prediction** is not implemented. `AutonomousProxy` exists as a
  role and the transform path is built to accommodate prediction later, but today
  an autonomous proxy is not predicted. Plan around the input-to-visible-result
  latency this implies.

## Scripting

Roles, ownership, and sending gameplay messages across the wire from C# are
covered in [Networking](/manual/scripting/networking/) in the scripting section.
