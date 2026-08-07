---
title: Frame Pipeline
description: Extract, recording, frames in flight, and how a world reaches the screen.
---

Lumina separates the world's live state from what a render pass may read with a
per-frame **extract** step. Extract writes a snapshot; recording reads only that
snapshot. Nothing in a render pass ever reads live ECS state.

Both halves run on the game thread inside `FrameEnd`, one after the other. The
split is not a thread boundary — it is what lets several worlds record
concurrently, and what keeps passes off the ECS.

```
FrameEnd (game thread)
  FWorldManager::ExtractWorlds
    CWorld::Extract                  fill this frame's snapshot
  FRenderManager::FrameEnd
    RHI::Core::BeginFrame(slot)      wait the frame timeline semaphore
    FWorldManager::RenderWorlds
      IRenderScene::PrepareRender    every scene, serial
      IRenderScene::RenderView       per scene, parallel when >1 world
    acquire swapchain / composite / present
```

## Frames in flight

`RHI::kFramesInFlight` is **3**. The frame index advances once per
`FRenderManager::FrameEnd`, and `slot = FrameIndex % kFramesInFlight` selects:

- the command list pool to recycle,
- the transient memory ring slice to reset,
- the render scene's snapshot slot in its frame ring,
- the ImGui draw-data snapshot slot.

`RHI::Core::BeginFrame(slot)` waits the **frame timeline semaphore** for that
slot's previous submission before touching any of it. That single wait is what
makes recycling everything else safe.

## Extract

`CWorld::Extract()` runs on the game thread during `FrameEnd`, through
`FWorldManager::ExtractWorlds()`. Worlds that are suspended or have no renderer
(a dedicated server) are skipped, so the editor never extracts an invisible
world.

`IRenderScene::Extract(ViewVolume, PostProcess)` fills the frame slot's snapshot:
visible primitives, lights, transforms, material bindings, per-view constants.
Because the ring is N-buffered, extract for frame N can run while `RenderView`
for frame N-1 is still recording. Extract **back-pressures** on the slot's
consumed fence: if the render side has not released the slot yet, extract waits.

Everything a pass needs must be in the snapshot. A pass that reaches back into
the ECS is reading data the game thread may be mutating concurrently.

## FrameEnd

`FRenderManager::FrameEnd` advances the frame index, builds the ImGui draw data,
and then runs the frame inline:

```cpp
RHI::Core::BeginFrame(ThisFrameIndex);      // frame timeline fence for this slot
ApplyPendingResize();
GWorldManager->RenderWorlds(ThisFrameIndex);
// acquire, composite, present
```

See [Threading Model](/internals/threading-model/) for what may touch what.

## RenderWorlds

`FWorldManager::RenderWorlds(FrameIndex)` runs in two phases.

1. **`PrepareRender(FrameIndex)` for every scene, serially.** This is where
   device-wide reconciliation lives: work that cannot run while other scenes are
   recording, typically anything guarded by `WaitDeviceIdle` such as recreating
   IBL cubemaps at a new resolution.
2. **`RenderView(FrameIndex)` per scene.** Each scene opens its own command list,
   so scenes can record concurrently. With more than one live world (the editor's
   multi-view case) this runs under `Task::ParallelFor` (`r.ParallelWorldRender`);
   with a single world it takes the identical serial path with no task overhead.

## Presentation

After the worlds have recorded:

1. `AcquireNextImage(Swapchain)`. An invalid handle means out of date: recreate
   the swapchain, release the ImGui snapshot slot, and skip the frame.
2. Open a command list, bind the global texture heap, and transition the
   swapchain image for rendering.
3. **Editor build**: render RmlUi editor contexts, then record ImGui from the
   game-thread snapshot straight into the swapchain image. The scene's output
   image is sampled by the viewport panel as a bindless texture, so there is no
   separate blit.
4. **Game build**: blit the primary game world's display texture
   (`IRenderScene::GetDisplayTexture()`) into the swapchain image.
5. `RHI::Core::Present(Swapchain, CL)`.
6. **Editor build**: render and present secondary ImGui viewports (dragged-out
   tool windows, each with its own swapchain), then release the snapshot slot.
   This must finish before the slot is released because it reads that slot's
   captures.

## ImGui draw data

`ImGuiRenderer->BuildFrame()` produces the frame's `ImDrawData` at the top of
`FRenderManager::FrameEnd`, and it is recorded later in the same function. Since
recording no longer happens a frame later on another thread, the draw data does
not need to be snapshotted into a ring — it is consumed before control returns to
the update loop.

## The render scene interface

`IRenderScene` (`World/Scene/RenderScene/RenderScene.h`) is the contract a world
renderer implements. Only a small core is required; every optional capability
defaults to "not supported" so a minimal renderer stays minimal.

**Required:**

| Method | Thread | Purpose |
| --- | --- | --- |
| `Init()` | Game | Two-phase construction. Required here because it makes virtual calls and hands `this` to systems, neither of which works from a constructor. |
| `Extract(ViewVolume, PostProcess)` | Game | Fill the frame slot's snapshot. |
| `RenderView(FrameIndex)` | Recording | Record and submit. Reads only the snapshot. |
| `Resize(NewSize)` | Game | Recreate render targets. |
| `GetRenderExtent()` | Game | Current render target size. |

There is deliberately **no `Shutdown()`**. Each class's destructor releases what
it owns.

**Optional hooks:** `PrepareRender`, `SignalFrameConsumed`,
`SetActivePostProcessMaterials`, `GetDisplayResourceID`, `GetDisplayTexture`,
`GetEntityAtPixel` and `SetPickerCursor` (editor picking),
`RegisterCaptureView` / `SetCaptureView` / `GetCaptureDisplayResourceID` (scene
capture), `GetShadowAtlas`, and the `IPrimitiveDrawInterface` debug-draw methods.

Capture view handles are **only meaningful to the scene that issued them**.
`SetCaptureView` returns false for a handle the scene does not recognize (for
example one that predates a scene rebuild), and the caller must re-register.

## Replacing the renderer

`RenderSceneFactory` is the extension point. A project or plugin installs a
process-wide override from its module startup:

```cpp
void FMyGameModule::StartupModule()
{
    RenderSceneFactory::SetOverride([](CWorld* World) -> TUniquePtr<IRenderScene>
    {
        return MakeUnique<FMyRenderScene>(World);
    }, "MyRenderScene");
}

void FMyGameModule::ShutdownModule()
{
    RenderSceneFactory::SetOverride(nullptr);   // mandatory
}
```

- The override applies to worlds created **after** the call. Live worlds keep the
  renderer they were created with.
- The factory may return null to decline a world (editor or utility worlds, for
  instance); that world falls back to the engine default.
- A module that installs an override **must** clear it before unloading, or the
  function pointer dangles into an unloaded DLL.

## Scene images and ownership

Render targets are `FSceneImage` values carrying an `bOwned` flag. A scene that
hands one of its images to a second holder calls `BorrowSceneImage` rather than
copying the value, so only the owner releases it. Getting this wrong produces a
double free at scene teardown.

Images and buffers freed mid-frame go onto per-slot deferred lists
(`DeferredBufferFrees`, `DeferredImageReleases`) and are released at the top of
`RenderView` for that slot, at which point the frame timeline has already proven
the GPU is done with them.

## Idle reclaim

`FWorldManager::ReclaimIdleRenderers(Now)` destroys the renderer of a world that
has not rendered for a grace period (a console variable, in seconds). This
matters in the editor, where many worlds exist but only a few are visible.

**One reclaim per frame, maximum**: `DestroyRenderer` calls `WaitIdle`, and
batching several of them stalls hard.

## Flushing

There is nothing to flush: recording and submission finish inside `FrameEnd`
before the update loop continues, so any code running in an update stage is
already outside the render half of the frame. What still matters is the **GPU**,
which is up to `kFramesInFlight` frames behind — anything that destroys a
resource the GPU may still be reading goes through the deferred-release lists
below, or `WaitIdle` for the heavyweight cases (renderer teardown, resize).

## Common failure modes

| Symptom | Cause |
| --- | --- |
| Renderer stalls after a swapchain resize | An early return from the render command that skipped `SignalSnapshotSlotConsumed`. |
| Extract blocks every frame | The render side is not releasing slots, usually a scene that never calls `SignalFrameConsumed`. |
| Torn or one-frame-late visuals | A pass reading live ECS state instead of the snapshot. |
| Double free at world teardown | A scene image copied instead of borrowed, so two holders think they own it. |
| Hitch when several editor viewports go idle | More than one idle reclaim in a frame. |
| Crash on module unload with a custom renderer | `RenderSceneFactory::SetOverride(nullptr)` missing from `ShutdownModule`. |
