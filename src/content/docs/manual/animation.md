---
title: Animation
description: Skeletal meshes, animation graphs, notifies, root motion, sockets, and ragdolls.
---

Animation in Lumina is skeletal. A **Skeletal Mesh** asset carries geometry plus
a skeleton; **Animation** assets carry clips authored against that skeleton; and
one of two components drives the pose.

| Component | Use for |
| --- | --- |
| **Simple Animation** | Playing a single clip with a speed, looping, and playback control. |
| **Animation Graph** | Blending, state machines, IK, and parameter-driven behavior. |

Both write into the **Skeletal Mesh** component's bone transforms, which the
renderer skins from.

## Skeletal Mesh component

Add a Skeletal Mesh component and assign a `Skeletal Mesh` asset. Materials come
from the mesh's slots and can be overridden per entity, exactly as with a static
mesh.

Two properties control animation cost, and both matter once you have a crowd.

**Visibility Based Anim Tick**

- `Tick When Rendered` (default), pose evaluation is skipped while the mesh has
  not been rendered recently. The pose freezes and resumes when it comes back on
  screen.
- `Always Tick Pose`, evaluate every frame regardless of visibility. Use this for
  gameplay-critical skeletons whose pose must stay correct off screen, for
  example something the player can shoot at from behind cover.

**Update Rate Optimization** (on by default) re-evaluates distant meshes every
two to four frames instead of every frame, staggered across entities so the cost
does not spike on one frame. Skipped time is accumulated and consumed as one
larger step, so **playback speed is unaffected**. Turn it off for hero characters
that must stay frame-exact at any distance.

## Simple Animation

The Simple Animation component plays one clip:

- The animation asset to play.
- Play rate, looping, and whether it is currently playing.
- Current time, which you can set to scrub.

It fires [notifies](#animation-notifies) as the playhead crosses them. Stopping
or seeking does **not** re-fire point notifies (only genuine playback advance
does), though the notify state End still fires on stop, so a montage-style
"weapon trail on" state cannot get stuck.

## Animation Graph

An **Animation Graph** is an asset you author in the Animation Graph editor. It
compiles to bytecode that a small virtual machine evaluates once per frame per
entity.

Assign the graph to the Animation Graph component and it drives the skeletal mesh
on the same entity.

### Nodes

| Node | Purpose |
| --- | --- |
| **Clip Player** | Plays an animation clip. |
| **Blend** | Blends two poses by an alpha. |
| **Additive** | Applies an additive pose on top of a base. |
| **Layered Blend Per Bone** | Blends per bone using a bone mask, for upper-body or additive layering. |
| **State Machine** and **State** | States with transition conditions. |
| **Two Bone IK** | Two-bone inverse kinematics, for feet and hands. |
| **Bone Transform** | Directly modifies a bone. |
| **Get Parameter** | Reads a graph parameter. |
| **Float Constant**, **Scalar Ops**, **Remap** | Value plumbing for driving alphas and conditions. |
| **Output** | The final pose. |

**Bone masks** are defined on the graph as named sets of bones with weights, and
referenced by the layered blend node.

### Parameters

A graph declares parameters that gameplay sets each frame (speed, direction,
whether the character is aiming). Rather than a list of loose named keys, a graph
points at a **parameter struct**: an ordinary reflected struct you declare in
code, whose fields are the parameters.

```cpp
REFLECT()
struct SLocomotionParams
{
    GENERATED_BODY()

    PROPERTY() float Speed = 0.0f;
    PROPERTY() bool  bGrounded = false;
    PROPERTY() TObjectPtr<CAnimation> CurrentAttack;
};
```

Pick that struct on the graph asset under **Parameter Struct**. The values you
set on it there are the authored defaults. Every entity running the graph gets
its own live instance on its Animation Graph Component, seeded from those
defaults, and gameplay writes fields on it directly.

The graph resolves each parameter name to a byte offset in that struct once, when
it links, so reading a parameter per frame is a plain memory read rather than a
name lookup.

:::note
A field the graph references but the struct doesn't declare falls back to the
value authored on the node, and a compile warning names it. Renaming a field
without updating the graph degrades to that default rather than failing silently.
:::

### Sync groups

Clips in a sync group advance together on a normalized time, so a walk and a run
stay foot-locked while you blend between them. **A sync group overrides the
per-clip play speed**, which is the intended behavior but surprising the first
time you see a clip ignore its own rate.

## Animation notifies

Notifies are events placed on the timeline of an animation clip.

- **Point notifies** fire once when the playhead crosses them.
- **Notify states** have a duration and fire Begin, Tick each frame while active,
  and End.

Both are delivered to gameplay each frame. With an animation graph, notifies from
active branches are **weighted by their branch's blend alpha**, so a notify in a
branch that is barely blended in does not fire at full strength.

Typical uses are footstep sounds, weapon trails, hit windows, and spawning
effects.

## Root motion

A clip can carry **root motion**: the movement baked into the animation rather
than applied by gameplay code.

Root motion is extracted during the parallel animation update and applied to the
entity transform in a serial pass afterward, because transform writes mutate the
entity registry and are not safe from parallel code. With an animation graph, the
root motion of the active branches is blended before it is applied.

Use root motion for attacks, dodges, and turn-in-place where the animation must
drive the movement exactly. Use code-driven movement for anything the player
steers continuously.

## Sockets and attachment

A skeletal mesh can define **sockets**: named points attached to a bone with an
offset. Add a **Socket Attachment** component to an entity, pick the parent
entity and a socket by name (the property has a socket picker), and the entity
follows that socket every frame.

This is how you attach a weapon to a hand, a hat to a head, or a particle effect
to a muzzle.

Sockets also serve hit detection: a physics hit against a skeletal mesh reports
the bone it struck.

## Ragdolls

Add a **Ragdoll** component alongside a skeletal mesh to switch it from animated
to physically simulated. The bodies and joints come from a **Physics Asset**;
if you leave the asset empty, the system auto-generates one from the mesh's
skeleton.

The component has two states:

- `Inactive`, no bodies in the physics scene and the pose stays fully
  animation-driven.
- `Simulated`, full physics, with the ragdoll bodies driving the bone pose.

Flip the state to collapse into physics; the system creates and destroys the
bodies to match. There is no partial or blended ragdoll state today, so hit
reactions are an animation problem rather than a physics one.

**Drive Entity From Root** (on by default) moves the entity transform to follow
the ragdoll's root body each frame. Keep it on so the mesh's culling bounds track
the ragdoll; turning it off leaves the entity at its spawn transform while the
bones move away from it.

## Importing

Skeletal meshes and clips import from FBX and glTF. The importer creates the mesh,
the skeleton, and one animation asset per clip in the file.

:::caution
Axis and handedness settings matter at import time. If a character comes in
mirrored or lying on its side, fix the import settings and **reimport the mesh,
the skeleton, and every clip together**. Reimporting only the clips leaves them
inconsistent with the skeleton.
:::

## Performance notes

- Animation evaluation runs across worker threads, one task list per mesh.
  Parallelism comes from having many meshes, not from splitting one skeleton, so
  a scene with one very complex character does not scale the way a crowd does.
- `Tick When Rendered` plus update rate optimization are the two biggest levers
  for crowds. Leave both on unless a specific character needs otherwise.
- Bone counts drive both CPU evaluation and the per-instance GPU bone buffer.
  Keep the skeleton as small as the character needs.

## Scripting

The C# side of animation (playing clips, setting parameters, reacting to
notifies) is covered in [Animation](/manual/scripting/animation/) in the
scripting section.
