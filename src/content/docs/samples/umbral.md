---
title: Umbral
description: A horde survival game that pushes six figures of enemies through the job system with no entity per agent.
---

`Engine/Applications/Umbral/`, about 5,400 lines.

A dark, glowing horde survival game in the shape of Vampire Survivors. You move,
weapons fire on their own, enemies stream in, you pick an upgrade every level. It
exists to find out how far the job system and the container layer go when the
entity count stops being reasonable.

## What it demonstrates

**Not everything should be an entity.** The world runs on `ECS::FRegistry` for the
things there are few of, the player, pickups, effects, and floating text. The horde
does not. Up to 900,000 agents live in a structure of arrays with no entity, no
component, and no registry involvement at all:

```cpp
// Structure of arrays rather than one entity per agent, which is what makes six figures affordable.
class FSwarm
{
    TVector<float>  PositionX;
    TVector<float>  PositionY;
    TVector<float>  Health;
    TVector<uint8>  Kind;
    TVector<uint8>  Dead;
};
```

This is the point of the sample. A sparse set is an excellent general answer and a
poor answer at this count. Knowing when to leave it is the skill, and the two live
side by side here so the boundary is visible.

**Parallel work that is actually parallel.** Every per-agent phase runs through
`Task::ParallelFor`. The spatial grid is rebuilt each frame with a parallel counting
sort, with per-chunk count arrays so no two workers write the same bucket:

```cpp
Task::ParallelFor(uint32(kGridChunks), [this, PerChunk](const Task::FParallelRange& Range)
{
    for (uint32 Chunk = Range.Start; Chunk < Range.End; ++Chunk)
    {
        int32* Counts = ChunkCounts.data() + size_t(Chunk) * size_t(kGridCells);
        // ...
    }
}, 1);
```

Removal is amortized rather than immediate. Dead agents are tombstoned and the array
is only compacted once they are a large enough fraction, so a heavy frame does not
also pay for a compaction:

```cpp
if (DeadCount == 0 || DeadCount * 12 < Count)
{
    return;
}
```

Every reader skips tombstones, which is the cost of that trade.

**Bindless instancing through device address.** Agents are packed into 16-byte
instances and uploaded once per frame. The vertex shader reads them straight from a
pointer in the push constant, so there is no descriptor set to build and no per-draw
binding:

```cpp
struct FAgentInstance
{
    FVector2 Position;
    float    Radius;
    uint32   Packed;
};

static_assert(sizeof(FAgentInstance) == 16, "The agent shader assumes a packed 16 byte instance.");
```

**A deferred light buffer in two dimensions.** Lights are accumulated into a
half-resolution buffer, then sampled by the agent and quad shaders through screen
UVs. Hundreds of glowing projectiles cost one light pass rather than a per-instance
loop, which is what lets the game stay dark and still readable.

**Seven weapons on a shared damage volume.** Blades, Soulbolt, Nova, Pyre, Maw,
Chain and Gloom all resolve against one `FDamageVolume` with radius, damage, knock,
pull and slow, so adding a weapon is data rather than a new code path against the
swarm.

## Running it

```bash
LuminaBuild.bat Build Umbral -TargetType=Editor -Configuration=Development
```

Then run `Binaries/Windows64/Umbral-Editor-Development.exe`.

| Input | Does |
| --- | --- |
| WASD or the arrow keys | Move |
| 1 / 2 / 3, or click a card | Choose an upgrade |
| Space or Enter | Confirm |
| P | Pause |
| F3 | Toggle the stats overlay |
| Escape | Quit |

## Worth reading

- `Source/Game/Swarm.cpp` for the counting sort, the density-gradient crowd
  repulsion, and the compaction rule.
- `Source/Game/Game.cpp` for the spawn ramp, which scales toward the agent cap on a
  curve rather than linearly.
- `Source/Render/Shaders.h` for the agent shader's rim lighting, which takes the
  player position as a uniform so the horde reads as a mass with a lit edge.
