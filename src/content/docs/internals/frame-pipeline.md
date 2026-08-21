---
title: Frame Pipeline
description: Extract, recording, frames in flight, and how a world reaches the screen.
---

Lumina separates the world's live state from what a render pass may read with a
per-frame **extract** step. Extract writes a snapshot; recording reads only that
snapshot. Nothing in a render pass ever reads live ECS state.

Both halves run on the game thread inside `FrameEnd`, one after the other. The
split is not a thread boundary. It is what lets several worlds record
concurrently, and what keeps passes off the ECS.

```
FrameEnd (game thread)
  FWorldManager::ExtractWorlds
    FRenderReleaseQueue::BeginExtract   open a new extract generation
    CWorld::Extract                     fill this frame's snapshot
  FRenderManager::FrameEnd
    ImGuiRenderer->BuildFrame           editor only, produces this frame's ImDrawData
    RHI::Core::BeginFrame(slot)         wait the slot, drain retires, flush uploads
    FWorldManager::RenderWorlds
      IRenderScene::PrepareRender       every live scene, serial
      IRenderScene::RenderView          per scene, parallel when >1 live world
    acquire swapchain / composite / present
```

## Frames in flight

`RHI::kFramesInFlight` is **2**. The frame index advances once per
`FRenderManager::FrameEnd`, and `slot = FrameIndex % kFramesInFlight` selects:

- the command lists to recycle,
- the transient memory ring slice to reset,
- the retire queue to drain,
- each render scene's per-slot buffers (draw arguments, cull scratch, readbacks).

`RHI::Core::BeginFrame(slot)` waits **every queue's** timeline value recorded for
that slot, not just the last queue to submit into it. That wait is what makes
recycling everything else safe.

What `BeginFrame` does, in order:

1. Waits the slot's recorded timeline value on each queue.
2. Drains the slot's retire queue, then calls `RHI::RetireSlot(slot)` for the
   backend-side destroys.
3. Flushes shader-library releases queued since the last frame boundary.
4. Resets the slot's command lists.
5. Flushes pending uploads, split across the transfer and graphics queues when
   async transfer is real, and records the timeline values they signal.
6. Grows the slot's transient ring slice if last frame overflowed it, shrinks it
   after a long low streak, then rewinds the cursor.
7. Publishes the slot as current, and only then retires the staging memory the
   upload flush used, so it lands on the queue gated by that upload's own
   timeline value.

## Extract

`CWorld::Extract()` runs on the game thread during `FrameEnd`, through
`FWorldManager::ExtractWorlds()`. Worlds that are suspended, throttled, or have
no renderer (a dedicated server) are skipped, so the editor never extracts an
invisible world.

`IRenderScene::Extract(ViewVolume, PostProcess)` fills the frame slot's snapshot:
visible primitives, lights, transforms, material bindings, per-view constants.
Everything a pass needs must be in there. A pass that reaches back into the ECS
is reading data the game thread may be mutating.

Extract also opens a **release generation**. Anything posted to
`FRenderReleaseQueue` from that point carries the current generation and cannot
be released until a later extract has been rendered, which is what keeps a
material slot and its textures alive for the frames the retained scene is still
drawing them. See [Scene resources and release](#scene-resources-and-release).

## FrameEnd

`FRenderManager::FrameEnd` advances the frame index, builds the ImGui draw data,
and runs the frame inline:

```cpp
const uint8 ThisFrameIndex = CurrentFrameIndex;
CurrentFrameIndex = (CurrentFrameIndex + 1) % RHI::kFramesInFlight;

ImGuiDrawData = ImGuiRenderer->BuildFrame();     // editor only
RHI::Core::BeginFrame(ThisFrameIndex);
ApplyPendingResize();
GWorldManager->RenderWorlds(ThisFrameIndex);
// acquire, composite, present
```

See [Threading Model](/internals/threading-model/) for what may touch what.

## RenderWorlds

`FWorldManager::RenderWorlds(FrameIndex)` runs in two phases.

1. **`PrepareRender(FrameIndex)` for every live scene, serially.** This is where
   device-wide reconciliation lives: work that cannot run while other scenes are
   recording, typically anything guarded by `WaitDeviceIdle` such as recreating
   IBL cubemaps at a new resolution. The loop counts live worlds as it goes.
2. **`RenderView(FrameIndex)` per scene.** Each scene opens its own command list,
   so scenes can record concurrently. With more than one live world (the editor's
   multi-view case) this runs under `Task::ParallelFor`
   (`r.ParallelWorldRender`); with a single world it takes the identical serial
   path with no task overhead.

Both phases gate on the same condition, so a world with no renderer or one not
ticking this frame does neither. A skipped record leaves the scene's output image
holding the last frame it drew, which is what a throttled viewport should show:
low frame rate, not frozen.

## Presentation

After the worlds have recorded:

1. `AcquireNextImage(Swapchain)`. An invalid handle means out of date: recreate
   the swapchain and return, skipping the rest of the frame.
2. Open a command list, bind the global texture heap, and transition the
   swapchain image for rendering.
3. **Editor build**: render RmlUi editor contexts, then record ImGui from this
   frame's draw data straight into the swapchain image. The scene's output image
   is sampled by the viewport panel as a bindless texture, so there is no
   separate blit.
4. **Game build**: blit the primary game world's display texture
   (`IRenderScene::GetDisplayTexture()`) into the swapchain image.
5. `RHI::Core::Present(Swapchain, CL)`.
6. **Editor build**: render and present secondary ImGui viewports, the
   dragged-out tool windows, each with its own swapchain.

## ImGui draw data

`ImGuiRenderer->BuildFrame()` produces the frame's `ImDrawData` at the top of
`FRenderManager::FrameEnd`, and it is recorded later in the same function. There
is no snapshot ring: recording no longer happens a frame later on another thread,
so the draw data is consumed before control returns to the update loop.

## The render scene interface

`IRenderScene` (`World/Scene/RenderScene/RenderScene.h`) is the contract a world
renderer implements. Only a small core is required; every optional capability
defaults to "not supported" so a minimal renderer stays minimal.

**Required:**

| Method | Purpose |
| --- | --- |
| `Init()` | Two-phase construction. Required here because it makes virtual calls and hands `this` to systems, neither of which works from a constructor. |
| `Extract(ViewVolume, PostProcess)` | Fill the frame slot's snapshot. Game thread. |
| `RenderView(FrameIndex)` | Record and submit. Reads only the snapshot. |
| `Resize(NewSize)` | Recreate render targets. |
| `GetRenderExtent()` | Current render target size. |

There is deliberately **no `Shutdown()`**. Each class's destructor releases what
it owns.

**Optional hooks:** `PrepareRender`, `SetPrimaryViewSize`,
`SetActivePostProcessMaterials`, `GetDisplayResourceID`, `GetDisplayTexture`,
`GetEntityAtPixel` and `SetPickerCursor` (editor picking), `RegisterCaptureView`
/ `SetCaptureView` / `GetCaptureDisplayResourceID` (scene capture),
`GetShadowAtlas`, `GetImmediateLines` / `BeginImmediateLines`, and the
`IPrimitiveDrawInterface` debug-draw methods.

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

## Scene resources and release

Render targets are `FSceneImage` values carrying a `bOwned` flag. A scene that
hands one of its images to a second holder calls `BorrowSceneImage` rather than
copying the value, so only the owner releases it. Getting this wrong produces a
double free at scene teardown.

Resources whose owner has gone away go through `FRenderReleaseQueue`
(`Renderer/RenderRelease.h`), which clears **two** gates in order:

1. **Extract liveness.** The token is held until every extract that was already
   in flight when it was posted has been rendered. The caller supplies the other
   half: it posts only once the owning object's last strong reference has
   dropped, so nothing game-side can hand the resource out again.
2. **GPU liveness.** The release itself routes through `RHI::Core::Retire`, which
   fences per queue.

Gate 2 alone is not enough. Releasing a material slot on GPU liveness only is
what made an unloaded material flash the magenta placeholder, because the
retained scene still had a frame or two of primitives naming the slot. The
counters are global rather than per scene, since one `FMaterialManager` is shared
across every world.

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
which is up to a frame behind. Anything that destroys a resource the GPU may
still be reading goes through `RHI::Core::Retire` or the release queue above, or
`WaitIdle` for the heavyweight cases (renderer teardown, resize).

## Common failure modes

| Symptom | Cause |
| --- | --- |
| Torn or one-frame-late visuals | A pass reading live ECS state instead of the snapshot. |
| Unloaded material flashes magenta | A render resource released on GPU liveness alone, bypassing the release queue's extract gate. |
| Double free at world teardown | A scene image copied instead of borrowed, so two holders think they own it. |
| A viewport freezes instead of slowing down | The world stopped ticking, so both `PrepareRender` and `RenderView` are skipped. Expected for a throttled tab, a bug anywhere else. |
| Hitch when several editor viewports go idle | More than one idle reclaim in a frame. |
| Crash on module unload with a custom renderer | `RenderSceneFactory::SetOverride(nullptr)` missing from `ShutdownModule`. |
