---
title: Animation Task System
description: The deferred pose-task model behind animation evaluation, its Esoterica lineage, and why it scales to crowds.
---

Animation evaluation in Lumina does not compute poses where the graph logic runs.
The graph update is a cheap logic pass that **records** a list of pose operations,
and a second pass **executes** only the operations that the final output actually
depends on.

That split is the whole performance story. Everything below is a consequence of it.

This page is the deep dive on the task model. For poses, root motion, notifies,
and the rest of the runtime, see [Animation Internals](/internals/animation-internals/).
For the authoring view, see the [Animation](/manual/animation/) manual page.

## Lineage

The model is taken from [Esoterica](https://github.com/BobbyAnguelov/Esoterica),
Bobby Anguelov's engine, which is the clearest public implementation of a deferred
animation task system. Lumina's version was written against it in July 2026 and
keeps the core ideas, including some names.

What came across unchanged:

- **Record, then execute.** Graph logic never touches a pose buffer.
- **Dependencies are indices of earlier tasks**, so registration order is already a
  valid execution order and nothing needs a topological sort at execute time.
- **A pose buffer pool with transfer semantics.** A task that is the last consumer
  of a dependency's buffer takes ownership of it and writes its result in place
  instead of asking the pool for a fresh one.
- **A pre-physics / post-physics stage tag** on every task, so physics-coupled work
  (ragdoll write and read) can interleave with the simulation.
- **Cached poses**, which Lumina calls pose snapshots.

Where the two diverge, and why:

| | Esoterica | Lumina |
| --- | --- | --- |
| Task representation | `Task`, a reflected polymorphic class with a virtual `Execute`, heap-allocated per registration and deleted on reset | `FAnimTask`, a flat POD struct in a vector whose capacity persists across frames |
| Producer | Node graph; nodes register tasks as they update | Bytecode VM; the whole program runs and every pose opcode records a task |
| Selection | Nodes on inactive branches never update, so nothing unnecessary is registered | Every branch records; the executor prunes by reachability from the output |
| Pose pool scope | One pool per character's `TaskSystem`, six buffers initially | One pool per worker thread, shared by every entity that thread evaluates |
| Buffer transfer | The task decides, calling `TransferDependencyPoseBuffer` in its own `Execute` | The executor decides, from a use count computed during the reachability pass |
| Fan-out | A tree, so a result has one consumer | A register file, so a pose register can feed several tasks; the use count handles it |
| Serialization | `TaskSerializer` compresses a task list for network replication and replay | Not implemented |
| Secondary skeletons | Supported, multiple poses per buffer | Not implemented |

The two differences that matter are **reachability pruning** and **pool scope**.

Esoterica does not need reachability pruning because its producer is a node graph:
an inactive state's nodes are never updated, so their tasks never exist. Lumina's
producer is a linear bytecode program, so every branch's opcodes run. Pruning at
execute time recovers the same property without conditional jumps in the bytecode
or a compiler that has to prove which branch is live.

Pool scope is a straight consequence of that. Esoterica's pool lives on the
character, so pose buffer memory scales with the number of animated characters.
Lumina's lives in `thread_local` storage in the executor, so it scales with the
number of worker threads instead. One thread evaluates one list at a time, and the
list is consumed before the next one starts, so the buffers are free to be reused.

## The two passes

```
update pass   (parallel across meshes)
  advance clocks, evaluate transitions, read parameters
  record FAnimTaskList          <- no pose math happens here
  extract root motion delta

execute pass  (parallel across meshes, one list per thread)
  walk reachability from the output task
  run the reachable tasks into pooled pose buffers
  ToSkinningMatrices -> SSkeletalMeshComponent::BoneTransforms

serial pass   (game thread)
  apply root motion to entity transforms
  dispatch typed notifies (user code)
```

`SAnimationSystem` wires this as one `FTaskGraph`: a `ParallelFor` for the simple
one-clip path, a `ParallelFor` for the graph path that depends on it (so a dual
component entity resolves deterministically rather than racing on
`BoneTransforms`), then a single `ParallelFor` execute node over every skeletal
mesh that depends on both. Follower pose copying hangs off the execute node as its
own pass, so every leader has finished before any follower reads one.

## `FAnimTask`

```cpp
struct FAnimTask
{
    static constexpr int16 NoTask = -1;

    EAnimTaskType  Type;
    EAnimTaskStage Stage;

    int16 DepA = NoTask;    // indices of earlier tasks in the same list
    int16 DepB = NoTask;

    CAnimation* Clip;  float Time;   // SampleClip
    float Alpha;                     // blends, additives, bone ops
    const TVector<float>* MaskWeights;
    FAnimInertializer* Inert;  FAnimDeadBlend* Dead;
    FPose* Snapshot;
    FVector3 T;  FQuat R;  FVector3 S;
    uint16 BoneA, BoneB, BoneC;
    uint8 Space, Mode;
};
```

Three decisions are worth calling out.

**The payload is flat, not a class hierarchy.** The recipe comes from a fixed
opcode set, so there is nothing to extend at runtime and nothing to dispatch
virtually. The list is a `TVector<FAnimTask>` that is cleared, not freed, so the
steady state allocates nothing. Esoterica's polymorphic `Task` is a `new` and a
`delete` per task per frame per character; at crowd scale that alone is real money.

**Fields are reused across task types.** `T` is a component-space IK target for
`TwoBoneIK` and `FABRIK`, a look-at target for `LookAt`, a ground offset for
`FootIK`, and a plain offset for `TranslateBone`. `BoneC` is the end bone for
two-bone IK and the iteration count for FABRIK. That keeps the struct small enough
to stay cache friendly when a list holds a few dozen of them.

**Dependencies are `int16` indices, not pointers.** The list can move in memory
between frames and the indices stay valid, and the invariant that a dependency's
index is lower than its consumer's is what makes both the reachability pass and
the execution pass single linear sweeps.

### Task types

| Type | Produces |
| --- | --- |
| `ReferencePose` | The skeleton's bind pose. The fallback for anything that cannot resolve. |
| `SampleClip` | One clip sampled at a time, respecting the skeleton LOD cut. |
| `Blend`, `BlendMasked` | Lerp of two poses, optionally weighted per bone. |
| `MakeAdditive`, `ApplyAdditive` | Delta extraction and application, local or mesh space. |
| `Inertialize` | Bollo-style offset decay across a seam. Carries capture and apply flags. |
| `DeadBlend` | Extrapolates the source forward from its seam velocity while it fades out. |
| `SavePoseSnapshot`, `LoadPoseSnapshot` | Named pose buffers that outlive the frame. |
| `BoneTransform`, `TranslateBone` | Single-bone offset or override. |
| `TwoBoneIK`, `FABRIK`, `LookAt`, `FootIK` | Solvers. |

### `FAnimTaskList`

The per-entity recipe, a transient member on `SSkeletalMeshComponent`:

```cpp
struct FAnimTaskList
{
    TVector<FAnimTask> Tasks;
    int16 OutputTask = FAnimTask::NoTask;

    FSkeletonResource* Skeleton = nullptr;
    bool  bLockRoot     = false;
    int32 RootBoneIndex = INDEX_NONE;
    int32 ActiveBoneCount = 0;   // skeleton LOD cut, 0 = every bone
};
```

The final-pose fixups ride on the list rather than on a task, because they are not
pose operations. The root pin happens once, on the final buffer, immediately before
it is resolved into skinning matrices.

`ActiveBoneCount` is the skeleton LOD cut. Bones are stored parents-first, so any
prefix of the array is a valid partial hierarchy. Sampling and blending stop at the
cut and the tail rides along at bind-pose locals, but **forward kinematics still
walks the full hierarchy**, so a bone past the cut still composes correctly against
its animated ancestors and a weapon socket on a hand still follows the arm.

## Recording: what the VM does

`FAnimationGraphVM::BuildTasks` is the update-side interpreter. Scalar ops, clock
advance, and state machine transition logic all run immediately. Every pose opcode
records a task instead of computing anything.

The bridge is a scratch array mapping pose register to producing task index:

```cpp
thread_local TVector<int16> PoseTasks;   // pose register -> task index
PoseTasks.assign(NumPose, FAnimTask::NoTask);
```

Writing a pose register records which task produces it. Reading one wires a
dependency. That is the whole translation from a register machine to a dependency
graph, and it costs one array write per pose opcode.

`BuildTasks` always leaves a valid output task, appending a `ReferencePose` if the
program produced none, so a mesh can never keep stale skinning matrices from a
previous frame.

### State machines record one branch's consumer

This is where reachability comes from. `EvalStateMachine` looks at the state slot,
picks the current state, and records exactly one task:

```cpp
FAnimTask Task;
Task.Type     = EAnimTaskType::Inertialize;
Task.DepA     = PoseTaskFor(CurReg);   // current state's pose register only
Task.Inert    = &Inert;
Task.bCapture = bStart;
Task.bApply   = Inert.bActive;
Task.Time     = Inert.Elapsed;
SetPoseTask(Dst, OutTasks.Add(Task));
```

Every state's blend tree already ran as bytecode and recorded its tasks. Only the
current state's chain is referenced by this `Inertialize` task, so only that chain
is reachable from the output. Every other state's sample and blend tasks sit in the
list and cost nothing but the bytes they occupy.

Note the split: the inertializer's control fields (`bActive`, `Elapsed`,
`Duration`) are advanced here, update-side, because transition selection is logic.
Channel capture, channel apply, and the two-frame pose history run execute-side
inside the task, because they need evaluated poses.

The one accepted consequence is that a nested state machine inside an inactive
state freezes its pose history, since its output task is unreachable. Reactivation
can inertialize from a stale pose. That is the same trade every "inactive branches
do not evaluate" design makes.

## Executing: `Anim::ExecuteTaskList`

```cpp
Anim::ExecuteTaskList(List, OutMatrices, OutSnapshot /* optional */);
```

Four phases, all linear.

### 1. Reachability

```cpp
Needed[List.OutputTask] = 1;
for (int32 i = List.OutputTask; i >= 0; --i)
{
    if (!Needed[i]) continue;
    const FAnimTask& Task = List.Tasks[i];
    if (Task.DepA >= 0 && Task.DepA < i) { Needed[Task.DepA] = 1; ++UseCount[Task.DepA]; }
    if (Task.DepB >= 0 && Task.DepB < i) { Needed[Task.DepB] = 1; ++UseCount[Task.DepB]; }
}
```

One reverse pass. Because a dependency's index is always lower than its consumer's,
by the time the loop reaches index `i` every task that could have marked it has
already been visited. No worklist, no recursion, no visited set beyond the flag
array itself.

The same pass builds `UseCount`, the number of reachable tasks that read each
result. That number is what drives buffer ownership.

`Needed`, `UseCount`, and `ResultBuf` are `thread_local` and reused across every
list that thread executes, so the pass allocates nothing after the first list.

### 2. Buffer ownership

A task whose dependency has exactly one consumer takes that buffer and writes into
it:

```cpp
const bool bStealA = BufA != FAnimTask::NoTask && UseCount[Task.DepA] == 1;
Dst = bStealA ? BufA : Pool.Acquire();
```

This is Esoterica's transfer model with the decision moved from the task to the
executor. It works because every `AnimPose` kernel is aliasing-safe and
stream-linear: `Blend(A, B, Alpha, Out)` explicitly permits `Out` to alias `A` or
`B`, and reads each element before it writes it.

Esoterica's tree structure guarantees one consumer per result, so a task can just
transfer. Lumina's register file allows fan-out, where one pose register feeds two
downstream tasks. The use count covers both cases with one rule: steal when you are
the last reader, otherwise take a fresh buffer and leave the shared result alone.

Buffers retire as soon as their last consumer has run:

```cpp
if (Task.DepA >= 0 && --UseCount[Task.DepA] == 0 && BufA != Dst && BufA != NoTask)
{
    Pool.Release(BufA);
}
```

### 3. Execution

One forward sweep from 0 to `OutputTask`, skipping anything not marked. Each task
reads its dependencies' result buffers by index and writes to `Dst`.

### 4. Resolve

The final buffer gets the root pin if the list asked for one, then
`ToSkinningMatrices` folds forward kinematics and the inverse bind matrices into
the component's `BoneTransforms` in a single pass. The buffer is released, the list
is reset, and `SkeletalUtils::PackRenderBones` packs the matrices into the 3x4
layout the render gather bulk-copies.

### The pool

```cpp
FPosePool& GetThreadPosePool()
{
    thread_local FPosePool Pool;
    return Pool;
}
```

Linear scan for a free slot, grow on demand, never shrink. The scan is trivially
cheap because the pool never gets large: peak live buffers is bounded by the
**depth of the reachable chain**, not by the number of tasks and not by the number
of entities. The worked example above, a four-state machine with an additive layer and
foot IK, peaks at two.

## A worked example

A graph with a four-state locomotion machine, an additive aim layer, and foot IK.
Say idle / walk / run / jump, with the machine currently in `run`.

The VM records something like:

```
 0  SampleClip   idle
 1  SampleClip   walk_fwd
 2  SampleClip   walk_back
 3  Blend        1, 2         alpha 0.3
 4  SampleClip   run_fwd
 5  SampleClip   run_back
 6  Blend        4, 5         alpha 0.3
 7  SampleClip   jump
 8  Inertialize  6                      <- current state is run
 9  SampleClip   aim_pose
10  MakeAdditive 9
11  ApplyAdditive 8, 10      alpha 1.0
12  FootIK       11

OutputTask = 12
```

`Output` is an opcode, not a task. It points `OutputTask` at an existing task and
stamps the list's root-lock flags, so it adds nothing to execute.

Reachability marks 12, 11, 10, 9, 8, 6, 5, 4. Tasks 0, 1, 2, 3, and 7 are never
touched: the idle clip, both walk clips, their blend, and the jump clip cost
nothing this frame beyond the `FAnimTask` bytes already sitting in the vector.

Buffer traffic for the reachable set:

| Task | Action | Live buffers after |
| --- | --- | --- |
| 4 `SampleClip run_fwd` | acquire buffer 0 | 1 |
| 5 `SampleClip run_back` | acquire buffer 1 | 2 |
| 6 `Blend 4, 5` | task 4 has one consumer, steal buffer 0; release buffer 1 | 1 |
| 8 `Inertialize 6` | steal buffer 0 | 1 |
| 9 `SampleClip aim_pose` | acquire buffer 1 | 2 |
| 10 `MakeAdditive 9` | steal buffer 1 | 2 |
| 11 `ApplyAdditive 8, 10` | steal buffer 0; release buffer 1 | 1 |
| 12 `FootIK 11` | steal buffer 0 | 1 |

Two buffers, one copy avoided at every step, and the entire graph resolves without
a single pose-sized memcpy between tasks.

## Why it is fast

### Cost is proportional to the active branch

This is the big one. A graph's size is an authoring concern, not a runtime cost. A
state machine with thirty states executes the tasks of one. Adding an unreached
state to a graph costs a few opcodes in the update pass and a few `FAnimTask` bytes
in the list, and nothing at all in the execute pass.

The pre-task implementation evaluated every branch's pose math because the VM
computed into pose registers as it went. Conditional execution would have needed
either branch opcodes in the bytecode or a compiler that could prove liveness.
Reachability pruning gets the same result with a reverse loop.

### Pose memory is per-thread, not per-instance

Pose buffers are the largest thing animation touches: three arrays of TRS per bone,
so roughly 40 bytes per bone per buffer. Before the task system, pose registers
lived on each instance's VM state, so the cost was `instances x registers x bones`.
Now it is `worker threads x chain depth x bones`.

At five thousand animated characters on a sixteen-thread machine, that is the
difference between thousands of resident pose buffers and a few dozen.

### The steady state does not allocate

The task vector, the pose pool, the reachability arrays, the curve scratch, and the
event scratch are all either persistent members or `thread_local` and are cleared
rather than freed. After the first few frames, a full evaluation of a complex graph
performs no heap traffic at all.

### The kernels are SIMD over flat streams

`FPose` is structure-of-arrays. Translations and scales are contiguous `FVector3`
arrays that blend as flat float streams eight wide; rotations slerp four quaternions
at a time through `VQuat4`'s transpose-load kernels:

```cpp
SIMD::LerpArray(Out.Translations, A.Translations, B.Translations, Active * 3, Alpha);
SIMD::LerpArray(Out.Scales,       A.Scales,       B.Scales,       Active * 3, Alpha);
SIMD::BlendQuatArray(Out.Rotations, A.Rotations, B.Rotations, Active, Alpha);
```

Inertialization decays its channels the same way, eight bones per iteration, with
every scalar early-out turned into a lane select.

Clip sampling uses hemisphere-aligned nlerp rather than slerp between adjacent
keyframes. Keys are dense enough that the difference is not visible, and it removes
an `acos` plus three `sin` per rotation channel. At crowd scale that was on the
order of a million transcendental calls a frame.

### Aliasing-safe kernels make stealing free

The buffer transfer is only a win because writing in place is as cheap as writing
out of place. Every kernel reads element `i` before writing element `i`, so
`Out == A` costs nothing extra and skips a full pose copy.

### Parallelism comes from entity count

One list executes on one thread, start to finish. There is no intra-list
parallelism and no synchronization inside `ExecuteTaskList` beyond the debug capture
check, which is a single relaxed atomic load.

The honest limitation: **a scene with one very complex character does not scale the
way a crowd does.** Splitting a skeleton across threads would cost more in
synchronization than the blends are worth at typical bone counts.

`SSkeletalMeshComponent` is `CACHE_ALIGN` because the render gather writes
`LastRenderedTime`, `LastDistanceOverRadius`, and the render bone cache from worker
threads. Without the alignment, adjacent components false-share at parallel range
boundaries.

### Work that never enters the list

Three gates run before any task is recorded, so skipped meshes cost a branch:

- **Visibility.** `EAnimUpdateMode::TickWhenRendered` skips evaluation entirely
  when the mesh has not been rendered within a 0.25s grace window. No tasks are
  recorded and the existing matrices are left untouched.
- **Update rate.** Distant meshes evaluate every 2, 3, or 4 frames at camera
  distance-over-radius thresholds of 30, 60, and 120. The stagger is a per-component
  countdown seeded from the entity id, so the cost spreads across frames instead of
  spiking on one. Skipped time accumulates in `PendingAnimTime` and is consumed as
  one larger step, so playback speed is unaffected.
- **Skeleton LOD.** Past a distance-over-radius of 60, `CSkeleton::LowDetailBoneCount`
  cuts sampling and blending to a bone prefix.

The staggering detail matters more than it looks. An earlier version used a global
atomic frame counter, which breaks with multiple worlds ticking: a world only
observes every Nth counter value, so entities could permanently miss their
evaluation slot and freeze. The per-component countdown has no such coupling.

### Where the time actually goes

A profile capture of five thousand graph-driven characters put roughly ninety
percent of `ExecuteTaskList` in self time rather than in its named child zones,
with clip sampling and skinning-matrix resolution accounting for the rest. The cost
was in the blend kernels and the inertialization channel math, not in scheduling.

That is the useful shape to keep in mind: once the structural wins are in, the task
system is not what costs anything. It is arithmetic over bone arrays, which is why
the answers have been SIMD kernels, fewer evaluated frames, and fewer evaluated
bones rather than more clever scheduling. The per-task-type profiler zones in the
executor exist so the next capture attributes that self time properly.

## Physics staging

Every task carries an `EAnimTaskStage`:

```cpp
enum class EAnimTaskStage : uint8 { AnyStage, PrePhysics, PostPhysics };
```

Everything is `AnyStage` today and the whole list executes in the pre-physics
update. The tag exists so ragdoll pose write and pose read can eventually split
across the simulation step, which is what Esoterica's `UpdatePrePhysics` and
`UpdatePostPhysics` pair does. The field is on the task rather than derived later
because the producer is the only thing that knows.

## Debug capture

`ExecuteTaskList` optionally fills an `FAnimTaskSnapshot` as it decides things,
rather than having tooling re-derive them:

| Field | Recorded |
| --- | --- |
| `bReachable` | Whether the task ran, or was pruned as an inactive branch |
| `bStoleBuffer` | Whether it wrote in place into its dependency's buffer |
| `ExecOrder` | Position in the executed sequence, `-1` when skipped |
| `BufferIndex` | Which pool buffer holds the result |
| `Level` | Dependency depth; tasks at the same level have no dependency between them |
| `LiveBuffers` | Pool buffers in use immediately after the task ran |
| `MaskWeightedBones` | For `BlendMasked`, how many bones the mask actually weights |

Capture is armed for one component at a time:

```cpp
Anim::ArmTaskCapture(&Mesh);
// ...
Anim::GetTaskCapture(OutSnapshot);
Anim::DisarmTaskCapture();
```

Disarmed, the cost is a single relaxed atomic load per mesh, so it stays compiled in
and safe to leave live in a populated world. Publishing and reading a snapshot are
serialized by one mutex held only for the copy.

Two console variables cover the rest:

| Variable | Effect |
| --- | --- |
| `anim.DumpGraphTasks` | Logs every graph-driven mesh's recorded list each frame |
| `anim.ValidateTasks` | Re-evaluates single-clip recipes the direct way and logs divergence from the executor |

`anim.ValidateTasks` is the data-versus-logic discriminator. Divergence means a
playback bug in the task path; agreement on a wrong-looking pose means the
animation data itself is wrong.

## Failure modes

| Symptom | Cause |
| --- | --- |
| Poses corrupt under parallel evaluation | A task list executed across more than one thread. One list, one thread, no exceptions. |
| Bone matrices are wrong after a ragdoll or editor write | A writer of `BoneTransforms` that did not set `bRenderBonesDirty`. Only the anim execute phase may write `RenderBones` or clear the flag. |
| A graph shows the bind pose and logs a version warning | The graph was compiled against an older `kAnimBytecodeVersion`. Open and re-save it. |
| A nested state machine pops on reactivation | Its output was unreachable while the parent state was inactive, so its pose history is stale. Expected. |
| Bones past the LOD cut look frozen but attachments are fine | Working as intended. Sampling stops at the cut; forward kinematics does not. |
| Distant characters animate at the wrong speed | Skipped time is not being accumulated into `PendingAnimTime`, or the skip counter is being reset every frame. |
| Frame time spikes on one frame with a crowd | Update-rate staggering defeated. The countdown is per component and seeded from the entity id for a reason. |
| A pose op silently produces the bind pose | A dependency resolved to `NoTask`. Every executor case falls back to the bind pose rather than reading an unset buffer. |
