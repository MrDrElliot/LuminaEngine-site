---
title: Animation Internals
description: Poses, the graph virtual machine, the task system, root motion, and notify dispatch.
---

Animation evaluation is split into two passes per frame:

1. An **update pass** that runs cheap logic (clock advance, state machine
   transitions, parameter reads) and **records a task list**. No pose math
   happens here.
2. An **execute pass** that runs only the tasks reachable from the output and
   produces GPU skinning matrices.

That split is what makes evaluation cheap for large crowds: inactive state
machine branches record tasks that are never executed, and the expensive pose
buffers are only touched for the branches that actually contribute.

For the authoring view see the [Animation](/manual/animation/) manual page.

## Poses

`FPose` (`Animation/Pose.h`) is a **local-space** skeletal pose: per-bone TRS
relative to the parent. The virtual machine blends entirely in this space, and
forward kinematics plus the inverse bind matrices fold into skinning matrices
exactly once, when the final pose is resolved.

The kernels in `AnimPose`:

| Kernel | Behavior |
| --- | --- |
| `Blend(A, B, Alpha, Out, NumActiveBones)` | `Out = Lerp(A, B, Alpha)`. Inputs and output **may alias**. Alpha is clamped. |
| `BlendMasked(A, B, Alpha, BoneWeights, Out, ...)` | Per-bone alpha is `Alpha * BoneWeights[i]`. Weights shorter than the bone count treat missing entries as 1. |
| `MakeAdditive(Src, Skeleton, OutDelta, ...)` | `Src` relative to the bind pose: translation and scale as differences and ratios, rotation as `Src * inverse(Bind)`. |
| `ApplyAdditive(Base, Delta, Alpha, Out, ...)` | Translation adds, scale lerps from 1, rotation slerps from identity then post-multiplies the base. |
| `ToSkinningMatrices(Pose, Skeleton, OutMatrices)` | Resolves local space into `Global * InvBind`. |

`NumActiveBones` is the **skeleton LOD cut**. Bones past it pass through from the
first input untouched rather than being blended, and `MakeAdditive` gives them
the identity delta. A negative value means all bones.

`FPose` also carries a direct TRS to column-major matrix conversion that avoids
two 4x4 multiplies, and a cheap TRS extract for rigid plus per-axis-scale
matrices. The extract is the **shared** decomposition used for all bind-pose math
specifically so results stay bit-consistent across call sites; do not hand-roll
another one.

## The graph virtual machine

`CAnimationGraph` compiles to bytecode that `AnimationGraphVM` interprets. The
VM has scalar registers (`sReg`) and pose registers (`pReg`).

`EAnimOp`:

| Opcode | Operands |
| --- | --- |
| `LoadConst` | immediate float to a scalar register |
| `LoadParam` | parameter index to a scalar register |
| `ScalarOp` | op, two scalar sources, destination |
| `AdvanceClock` | state index, speed, clip index, loop mode, destination clock, destination finished flag, **sync group** |
| `SampleAnim` | clip index, time, destination pose |
| `RefPose` | destination pose |
| `Blend` | two poses, alpha, destination |
| `BlendMasked` | two poses, alpha, mask index, destination |
| `MakeAdditive` / `ApplyAdditive` | pose sources, alpha, destination |
| `EvalStateMachine` | state machine index, destination pose |
| `BoneTransform` | source pose, alpha, bone index, space, mode, TRS offset, destination |
| `TwoBoneIK` | source pose, alpha, target xyz, root/mid/end bone indices, pole vector, destination |
| `Output` | source pose |

`EClipLoopMode` decides what `AdvanceClock` does at the end of a clip.

`BoneTransform` has two axes of behavior:

- **Space** (`EBoneTransformSpace`): the bone's local frame relative to its parent
  (cheap, no FK walk), or component space, where the offset is applied to the
  bone's global transform after FK and converted back to local.
- **Mode** (`EBoneTransformMode`): additive (translation offsets, rotation
  post-multiplies, scale multiplies, alpha scaling how strongly), or override
  (lerp the bone toward the given TRS by alpha).

Per-instance VM state (registers, playback clocks, parameter values) lives on the
component, sized lazily from the graph, and is **not serialized**.

### Parameters and blackboards

The VM's parameter registers are the graph's inputs. When the entity also has a
blackboard component, the animation system **refills those registers from the
blackboard before every evaluation**. On such an entity, writing a graph
parameter directly is overwritten; the blackboard is the value that survives.

### Sync groups

`AdvanceClock` takes a sync group index. Clips in a group advance on a shared
normalized time so blends stay foot-locked. A sync group **overrides the per-clip
speed**, which is intended but surprising when you see a clip ignore its own rate.

## The task system

`FAnimTask` (`Animation/TaskSystem/AnimTask.h`) is a recorded pose operation.
Design choices worth noting:

- **Dependencies are indices of earlier tasks in the same list**, so registration
  order is already a valid execution order. No topological sort at execute time.
- The payload is **flat POD**, not a per-type class hierarchy. The recipe comes
  from a fixed opcode set, so the list stays reusable with zero allocation and
  its capacity persists across frames.
- `EAnimTaskStage` splits tasks by which side of the physics step they must run
  on. Everything is `Any` today; the split exists so physics-coupled tasks
  (ragdoll write and read) can interleave with the simulation later.

`FAnimTaskList` is the per-entity recipe for one frame: the update pass fills it,
the executor consumes it into skinning matrices and clears it. It also carries the
final-pose fixups, the skeleton every pose is authored against (valid for the
frame), and the skeleton LOD cut.

### The executor

```cpp
AnimTaskExecutor::ExecuteTaskList(List, OutMatrices, OutSnapshot);
```

- **Only tasks reachable from the output execute.** Inactive state machine
  branches are recorded and skipped.
- Pose buffers come from a **per-thread pool with steal-in-place semantics**, so
  a whole entity costs at most a few live buffers regardless of graph size.
- **Parallel-safe across entities; one list executes on one thread.** Parallelism
  comes from having many meshes, not from splitting one skeleton. A scene with a
  single very complex character does not scale the way a crowd does.

`OutSnapshot` optionally records what actually happened (reachability, execution
order, buffer ownership) as the executor decides it, so tools never re-derive it.
Capture is armed for one component at a time (`ArmTaskCapture(Owner)` /
`DisarmTaskCapture`); disarmed, the cost is a single relaxed atomic load per mesh,
so it stays safe to leave compiled in a populated world. Publishing and reading a
snapshot are serialized by one mutex held for the copy.

### Inertialization

State machine transitions use inertialization (Bollo 2018) rather than
cross-fading two poses.

`FInertChannel` records one channel's offset decaying along a direction from
magnitude `X0` with initial velocity `V0` to zero over the transition. For
rotation, the direction is the axis and `X0` is the angle in radians; for
translation and scale, the direction is a unit offset and `X0` is its length.

`FAnimInertializer` holds the per-state-machine state. The control fields
(`bActive`, `Elapsed`, `Duration`) are advanced by the **update** pass; channel
capture and apply, plus the two-frame pose history, run **execute side** in the
`StateMachineOutput` task, because they need evaluated poses. Velocity is only
estimated once two frames of history exist, so the first transition after a graph
starts is position-only.

## Root motion

`Animation/RootMotion.h`:

```cpp
int32 ResolveRootBoneIndex(Skeleton, NameOverride);
FRootMotionDelta ExtractRootDelta(Animation, Skeleton, RootIndex, PrevTime, CurTime, ...);
void PinRootToBindPose(Pose, Skeleton, RootIndex);
FRootMotionDelta BlendRootMotion(A, B, Alpha);
```

- The motion root is the named bone if a name override is set and present,
  otherwise the first bone with a parent index below zero. `INDEX_NONE` when the
  skeleton has no root.
- `ExtractRootDelta` returns the component-space translation and rotation delta
  between two times, **loop-wrap aware**, applied as `E_new = E_prev * Delta`. It
  does not modify the pose. **Scale is intentionally not extracted.**
- Callers strip the root afterward with `PinRootToBindPose`, which pins it to the
  bind-pose local transform so the mesh never drifts.
- `BlendRootMotion` lerps translation and slerps rotation, with identity standing
  in for a motionless side, so blending fades motion in and out.
  `bHasMotion` propagates if either side has it, marking the branch as root-motion
  driven through the graph.

`ERootMotionLockMode` is the per-component override: use the asset's flag, always
lock, or never lock.

**Root motion is extracted in the parallel update pass and applied to the entity
transform in a serial pass afterward**, because transform writes mutate the
registry and are not `ParallelFor` safe.

## Notify dispatch

`FAnimNotifyEvent` is one fired event, buffered per component for the frame it
fired in. `EAnimNotifyEventType` covers a point notify crossed by the playhead
and a notify-state window's begin, tick, and end (simple playback only).

Each event carries the **blend weight of the branch that sampled it**: 1 for
direct clip playback, scaled by graph blends. Events from inactive state machine
branches never fire at all, since those branches are not reachable from the
output.

`CollectTriggeredNotifies(Clip, PrevTime, CurTime, ...)` appends a trigger for
every point notify crossed in the half-open interval `(PrevTime, CurTime]`,
handling a single loop wrap when the current time landed behind the previous one.
Equal times append nothing, which is what keeps a paused or scrubbed playhead from
re-firing.

Simple animation playback additionally tracks whether time advanced through
**playback** rather than a scrub or stop jump. Point notifies and notify-state
ticks fire only when it did, so seeking does not re-fire events. A notify state's
End still fires on stop, so a "weapon trail on" state cannot get stuck.

## Visibility and update rate

Two component-level controls feed straight into how often the passes run:

- `EAnimUpdateMode`: `TickWhenRendered` (default) skips evaluation while the mesh
  has not been rendered recently, `AlwaysTickPose` evaluates regardless.
  `LastRenderedTime` is stamped by the render gather.
- Update rate optimization re-evaluates distant meshes every two to four frames,
  **staggered by entity id** so the cost does not spike on one frame.
  `LastDistanceOverRadius` (camera distance over bounding radius, also stamped by
  the gather) drives the interval, and `PendingAnimTime` accumulates the skipped
  time so it is consumed as one larger step and playback speed is unaffected.

`SSkeletalMeshComponent` is `CACHE_ALIGN` because the render gather writes
`LastRenderedTime`, `LastDistanceOverRadius`, and the render bone cache from
worker threads. Without the alignment, adjacent components false-share at
parallel range boundaries.

## Data flow summary

```
update pass (parallel across meshes)
  VM: advance clocks, evaluate state machines, read params (blackboard first)
  record FAnimTaskList
  extract root motion delta
execute pass (parallel across meshes, one list per thread)
  AnimTaskExecutor: run reachable tasks, blend poses, inertialize
  ToSkinningMatrices -> SSkeletalMeshComponent::BoneTransforms
serial pass (game thread)
  apply root motion to entity transforms
  dispatch notify events
render gather
  pack bone matrices into the GPU 3x4 layout; FGPUInstance.BoneOffset points at the slice
```

## Common failure modes

| Symptom | Cause |
| --- | --- |
| Graph parameter writes are ignored | The entity has a blackboard; registers are refilled from it before every evaluation. Write through the blackboard. |
| A clip ignores its play rate | It is in a sync group, which overrides per-clip speed. |
| Notifies re-fire when scrubbing | Something advanced the clock outside genuine playback. Only playback advance fires point notifies. |
| Mesh drifts away from the entity | Root motion extracted but the root never pinned back to the bind pose. |
| Character teleports on the first transition | Inertialization has fewer than two frames of history, so velocity is not yet estimated. |
| Frame time spikes on one frame with a crowd | Update rate staggering defeated, for example by resetting the skip counter every frame. |
| False sharing stalls during the render gather | A component written from workers that is not cache aligned. |
| Poses corrupt under parallel evaluation | A task list executed across more than one thread. One list, one thread. |
