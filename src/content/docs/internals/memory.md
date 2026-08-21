---
title: Memory
description: The allocator stack, frame arenas, scratch marks, and memory tracking.
---

Every allocation in Lumina goes through `Lumina::Memory`. Underneath it is
**rpmalloc**, a lock-free thread-caching allocator. On top of it sit a few
bump allocators for per-frame and scratch work, plus an opt-in tracker.

## The global allocator

`Memory::GMalloc` is an `FMalloc` wrapping rpmalloc. The free functions are the
public surface:

```cpp
void* Memory::Malloc(size_t Size, size_t Alignment = DEFAULT_ALIGNMENT); // 16
void* Memory::Realloc(void* Memory, size_t NewSize, size_t Alignment);
void  Memory::Free(void*& Memory);   // takes a reference and nulls it

template<typename T, typename... Args> T* Memory::New(Args&&...);
template<typename T>                   void Memory::Delete(T*&);
```

`Memory::Free` takes the pointer **by reference** and nulls it, which removes a
whole class of double-free bug. `Memory::Delete` does the same for typed
deletion.

Statistics are available without enabling tracking, straight from rpmalloc:
`GetCurrentMappedMemory`, `GetPeakMappedMemory`, `GetCachedMemory`,
`GetCurrentHugeAllocMemory`, `GetTotalMappedMemory`, `GetTotalUnmappedMemory`.
The editor's Memory tool displays these.

### Per-module instances and thread heaps

rpmalloc keeps per-thread heaps. Two rules follow:

- **Every module must route its `operator new` / `delete` through the engine
  allocator.** `DECLARE_MODULE_ALLOCATOR_OVERRIDES()` defines the full set of
  global operator overloads (sized, aligned, nothrow, array forms). The
  executable declares it in `Launch.cpp`; `IMPLEMENT_MODULE` emits it for every
  modular DLL. Skip it and memory allocated in one module and freed in another
  goes through two different CRT heaps.
- **Every thread that allocates needs a thread heap.**
  `Memory::InitializeThreadHeap()` is called by the module init export, by
  `Threading::Initialize`, and by the job scheduler for its workers.
  `IsThreadHeapInitialized()` checks the state.

### Third-party libraries

Vendored libraries that take an allocator hook are routed through a C-ABI shim:

```c
void* LmThirdPartyMalloc(size_t Size, const char* Category);
void* LmThirdPartyRealloc(void* Ptr, size_t Size, const char* Category);
void* LmThirdPartyCalloc(size_t Count, size_t Size, const char* Category);
void  LmThirdPartyFree(void* Ptr);
```

The shim is declared without an API macro (to avoid a linkage clash inside
vendored translation units) and exported with `/EXPORT` pragmas from
`Memory.cpp`. miniz, OpenFBX, MikkTSpace, and RmlUi use it, so their allocations
show up in the engine's tracking with their own category label.

## Bump allocators

`Memory/Allocators/Allocator.h` defines an `IAllocator` interface plus three
implementations.

| Type | Behavior |
| --- | --- |
| `FDefaultAllocator` | Forwards to `Memory::Malloc` / `Free`. |
| `FLinearAllocator` | Single fixed block, bump pointer, bulk reset. |
| `FBlockLinearAllocator` | Chained blocks, bump pointer, mark and restore. The workhorse. |

`FBlockLinearAllocator` never runs destructors. Freeing is rewinding a cursor.
Blocks past a restored mark stay allocated and get reused by later requests, so a
steady-state workload stops calling the OS entirely.

An oversized request that cannot fit any block **fails loudly** rather than
handing back a pointer whose writes would overrun the block. If you see that
assert, the allocation is larger than the arena's block size and needs the heap
instead.

### Scratch: FMemMark

`Memory::GetThreadScratchAllocator()` is a per-thread scratch stack. Do not use
it directly; use `FMemMark`, an RAII scope that captures the cursor on
construction and rewinds it on destruction.

```cpp
{
    FMemMark Mark;
    auto* Scratch = Mark.Alloc<FThing>(Count);
    auto Temp = TVector<int, ...>(Mark.Eastl());   // container backed by this scope
    // ...
}   // O(1) bulk free
```

Nested marks compose LIFO. **No destructors run on scope exit**, so only store
trivially destructible data (or destroy it yourself). Marks are reclaimed only by
their scope or by thread exit, never per allocation.

### Frame arenas

`Memory::GetThreadFrameAllocator()` is a different lifetime: a per-thread bump
allocator that lives for the whole frame and is bulk-reset at the frame boundary
by `ResetThreadFrameAllocators()`, **not** by an `FMemMark` scope.

Use it for per-thread scratch whose data must outlive a parallel-for and be
consumed later in the same frame, the classic gather-then-merge shape:

```cpp
GTaskSystem->ParallelFor(Num, [&](const Task::FParallelRange& Range)
{
    auto& Arena = Memory::GetThreadFrameAllocator();
    // gather into per-thread storage from Arena
});
// ... later this frame, on the game thread: merge the per-thread results
```

An arena registers itself globally on first touch so the boundary reset can find
it. It grows to the per-thread high-water mark and is reused every frame, so a
repeated parallel pass never reallocates its pool.

`ResetThreadFrameAllocators()` runs at the top of `FEngine::Update`, which is the
one point in the frame that is genuinely quiescent: one game thread, and the
previous frame's parallel gathers already joined and consumed. **Holding a
frame-arena pointer across a frame boundary is a use-after-free.**

Containers reach an arena through the allocator they are parameterized on:
`TScratchVector<T>` and `TScratchHashMap<K, V>` sit on the scratch arena,
`FFrameAllocator` on the frame arena. `Deallocate` is a no-op for both, so the
arena must outlive the container and the whole thing is bulk-reset with no
per-item free. See [Math and Containers](/internals/math-and-containers/#allocators).

## Memory tracking

`MemoryTracking.h` is an opt-in tracker layered over the allocator. It is
category-based and callstack-capable.

```cpp
{
    LUMINA_MEMORY_SCOPE("Render Scene");
    // every allocation on this thread inside the scope is attributed to that category
}
```

Categories are just strings registered on first use (`RegisterCategory`), so
adding one is a new `LUMINA_MEMORY_SCOPE` string, not an edit to a central enum.
The macro compiles to nothing when tracking is disabled at build time.

| Call | Purpose |
| --- | --- |
| `SetTrackingEnabled(bool)` / `IsTrackingEnabled()` | Runtime toggle. |
| `GetCategoryStats(Out, MaxOut)` | Per-category live bytes and counts. |
| `GetTrackedLiveBytes()` / `GetTrackedLiveCount()` | Totals. |
| `GetTrackingOverflowCount()` | Allocations the tracker could not record. Nonzero means the results are incomplete. |
| `SetCaptureCallstacks(bool)` | Adds a callstack per allocation. Expensive. |
| `GetTopCallSites(Out, MaxOut, Sort)` | Hot call sites, sorted by live bytes, count, or total. |
| `ResolveSymbol(Address, Out, Size)` | Symbolizes a captured frame. |

Tracing also feeds Tracy: `LUMINA_PROFILE_ALLOC` / `LUMINA_PROFILE_FREE` wrap
`TracyCAllocS` / `TracyCFreeS` with a 12-frame callstack depth.

The editor exposes all of this through a single Memory tool, which shows
rpmalloc totals, per-category breakdown, and top call sites.

## Smart pointers and reference counting

- `Memory/SmartPtr.h` provides `TUniquePtr`, `TSharedPtr`, and `TWeakPtr`
  aliases, plus `MakeUnique` / `MakeShared`, all allocator-aware.
- `Memory/RefCounted.h` provides an intrusive reference-counted base for types
  that need it (render resources, for instance).
- `CObject` instances are **not** managed by these. They have their own lifetime
  model; see [The Object System](/internals/cobject/).

## Common failure modes

| Symptom | Cause |
| --- | --- |
| Crash freeing a pointer allocated in another module | Missing `DECLARE_MODULE_ALLOCATOR_OVERRIDES()` in that module. |
| Crash on first allocation on a new thread | The thread heap was never initialized. Threads created outside the scheduler must call `Memory::InitializeThreadHeap()`. |
| Assert about an oversized arena allocation | The request exceeds the arena's block size. Use the heap. |
| Garbage data read from a gather buffer | A frame-arena pointer survived past `ResetThreadFrameAllocators()`. |
| Objects not destructed after a scratch scope | Bump allocators never run destructors. Store trivially destructible data. |
| Tracking totals do not add up | Check `GetTrackingOverflowCount()`, and remember untracked paths (direct rpmalloc use inside third-party code without the shim). |
