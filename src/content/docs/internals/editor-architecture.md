---
title: Editor Architecture
description: The editor engine, tool registry, ImGui integration, property grid, and transactions.
---

The editor is a **module**, not a separate application. `Engine/Editor` builds
alongside `Runtime` and the same executable runs both: `WITH_EDITOR` selects
`FEditorEngine` over `FEngine` in `LuminaMain`, and the editor UI is created as
the engine's `IDevelopmentToolUI`.

That is why the editor and the game share a runtime, and why an editor world
behaves like a game world.

For the user-facing view of panels and workflows see the
[Editor](/manual/editor/) section of the manual.

## FEditorEngine

`Engine/Editor/Source/LuminaEditor.h`. A thin `FEngine` subclass:

| Override or method | Purpose |
| --- | --- |
| `Init` / `Shutdown` | Editor-specific setup on top of the base engine. |
| `CreateDevelopmentTools()` | Returns the `FEditorUI` instance. |
| `LoadStartupMap()` | **Deliberately a no-op.** The editor does not auto-load a world; the user picks one. |
| `GetCurrentEditorWorld()` | The active editor world. |
| `CreateProject(...)` | Creates a project on disk from the Blank template, returns the generated `.lproject` path or a human-readable error. |
| `CreatePlugin(...)` | Scaffolds a project-local plugin from the Plugin template: the `.lplugin` descriptor plus a Runtime and an Editor module, each with its own `.Build.cs`. Requires a loaded project, and project files must be regenerated afterward. |
| `GenerateProjectFiles(Dir)` | Runs the project's `GenerateProject.bat` on a worker thread, streaming LuminaBuildTool's output into the editor log. |

The canonical new-project path is the editor's own project browser: launch with
no project, the Open Project dialog appears, Create New Project copies the Blank
template and runs LuminaBuildTool, then Open Solution.

## FEditorUI

`UI/EditorUI.cpp` implements `IDevelopmentToolUI` and is driven directly from
`FEngine::Update`:

| Hook | When |
| --- | --- |
| `StartFrame` | Beginning of `FrameStart`. |
| `Update` | Once per update stage, so tools can pick a stage. |
| `EndFrame` | End of `FrameEnd`. |
| `OnEvent` | Registered at the `EditorChrome` input layer (500). |

It owns the dockspace, the main menu, the toolbar, and the lifetime of every open
tool.

## Editor tools

`FEditorTool` (`UI/Tools/EditorTool.h`) is the base for everything that opens a
window. It is `EDITOR_API` specifically so plugins can derive tools out of
module.

Required overrides:

```cpp
virtual void OnInitialize() = 0;
virtual void OnDeinitialize(const FUpdateContext&) = 0;
virtual uint32      GetUniqueTypeID() const = 0;
virtual char const* GetUniqueTypeName() const = 0;
```

Useful optional ones:

| Override | Effect |
| --- | --- |
| `InitializeDockingLayout(DockspaceID, Size)` | Default docking arrangement on first open. |
| `IsSingleWindowTool()` | Only one instance may exist. |
| `ShouldOpenDocked()` | False opens floating; the user can still dock manually. |
| `ShouldGenerateThumbnailOnSave()` plus `GenerateThumbnail(Package)` | Asset thumbnails. |
| `SetWorld` / `RebindToWorld` / `SetupWorldForTool` | Tools that own a preview world. |
| `CreateFloorPlane(...)` | Convenience for preview scenes. |
| `WorldUpdate(Context)` | Ticks with the tool's world. |

A tool owns `FToolWindow` instances, so one tool can present several dockable
windows.

### The editor camera

Each tool ticks its **own** editor camera (`FEditorTool`'s camera state), so
camera mode and focus are per editor rather than global. Two modes:

- `Free`, WASD movement with right-mouse-drag look, DCC-style flythrough.
- `Orbit`, right-mouse-drag yaw and pitch around a focal point, middle-mouse pan,
  wheel zoom.

Yaw and pitch are degrees on **+Z forward**. `OrbitAnchor` is the home position;
middle-mouse pan moves `OrbitTarget` and `ResetOrbitPan` snaps back. Focus uses an
exponential-decay interpolation (a rate of about 12 per second reaches 95% in
roughly 250 ms) and any movement input cancels the lerp.

Mouse capture is released on the trailing edge, once on right-mouse-up, rather
than every non-looking frame.

## The tool registry

`FEditorToolRegistry` (`UI/Tools/EditorToolRegistry.h`) maps asset classes and
file extensions to the tool that opens them.

```cpp
// In a plugin's StartupModule, during the EditorInit phase:
FEditorToolRegistry::Get().RegisterAssetEditor<CMyAsset, FMyAssetEditor>();
FEditorToolRegistry::Get().RegisterFileEditor<FMyTextEditor>({ ".myext" });
```

- Asset editors are keyed by `CClass`. Resolution walks the asset's class
  hierarchy **most derived first** and constructs the first match, so a base-class
  editor covers every subclass until a more specific one is registered.
- File editors are keyed by extension in leading-dot, case-insensitive form
  (`".rml"`).
- **A later registration for the same key overrides the earlier one**, which is
  how a plugin replaces a built-in editor.
- The factory returns a freshly constructed but **not yet initialized** tool.
  `FEditorUI` owns the lifecycle from there.

`ToolsMenuRegistry` does the same job for the Tools menu, so a plugin can add
entries without touching editor code.

## Asset editors

`UI/Tools/AssetEditors` holds the built-ins: Animation, AnimationGraph,
AudioStream, Blackboard, DataAsset, FontEditor, GeometryCollection,
MaterialEditor, MaterialFunctionEditor, MeshEditor, ParticleSystemEditor,
PhysicsMaterial, PrefabEditor, RmlUiEditor, TextureEditor. `FAssetEditorTool` is
their shared base, adding dirty tracking and save handling.

`Assets/Factories` holds the content-browser creation factories, one per asset
type that can be created from scratch.

## World editing

`FWorldEditorTool` is the scene editor. It hosts:

- **Edit modes** (`WorldEditorMode.h` plus the registry): Terrain, Foliage,
  NavMesh, and so on. A mode owns the viewport interaction while active, so a
  plugin can add one without modifying the world editor.
- **CPU picking**: the render scene writes entity IDs into a picker buffer, and
  `GetEntityAtPixel` reads back a small region around the cursor rather than the
  full target.
- **Gizmos** through ImGuizmo, with transactions opened on drag start and closed
  on release so a drag is one undo step.
- **Component visualizers** (`Tools/ComponentVisualizers`) drawing per-component
  handles and shapes.

## Transactions and undo

`UI/Tools/Transactions`:

| Command | Captures |
| --- | --- |
| `FObjectSnapshotCommand` | A `CObject`'s reflected properties before and after. |
| `FEcsRegistrySnapshotCommand` | A slice of the entity registry, for structural changes. |
| `FEditorTransaction` | The scope that groups commands into one undo step. |

Snapshot-based rather than delta-based: a transaction records the before and
after state and restores by reapplying. That makes correctness easy and cost
proportional to the captured scope, so keep transaction scopes tight.

Gizmo drags are explicitly gated: one transaction spans the whole drag rather
than one per frame of mouse movement.

## The property grid

`UI/Properties/PropertyTable.cpp` renders any reflected type from its `CStruct`.
It handles:

- Every property type the reflection system knows, including containers
  (`TVector<T>`, `THashMap<K, V>`) and `FInstancedStruct` polymorphic pickers.
- Metadata-driven presentation: `Category`, ranges, tooltips, read-only.
- Multi-entity editing, where a property showing different values across the
  selection displays as mixed and writes to all.
- Per-property customizations through `Core/Reflection/PropertyCustomization`,
  which is how a type gets a bespoke editor row.

Edits route through `PostPropertyChange(FProperty*)` on the object.

## ImGui integration

- `Runtime/Tools/UI/ImGui` holds the platform-agnostic layer, `ImGuiX` helpers,
  and the Vulkan renderer (`Vulkan/VulkanImGuiRender.cpp`).
- Draw data is built on the game thread and recorded on the render drain a frame
  later through a **snapshot ring**, one slot per frame in flight. Every exit
  path from the render command must release its slot.
- Multi-viewport is supported: a dragged-out tool window gets its own swapchain,
  rendered and presented after the main present.
- DPI scaling comes from `FWindow::GetContentScale()`.
- Drag and drop between panels goes through `Lumina::DragDrop`, a typed payload
  layer (`EPayloadKind` plus `FPayload`) over a single ImGui payload type, rather
  than per-tool payload strings. Set on the source side, accept or peek on the
  target.
- **Exactly one modal owner.** Modals go through `FEditorModalManager` and
  `FEditorToolModal`; competing modal owners across tools lock up the UI.

`ColorTextEdit` is the vendored text editor widget (used by script and RML
editing) and `imgui-node-editor` backs the node graphs.

## Node graphs

`UI/Tools/NodeGraph` hosts the graph-based editors. The material editor's
compiler (`NodeGraph/Material/MaterialCompiler.cpp`) walks the graph and emits
the shader body into the appropriate stage template; see
[Shaders](/internals/shaders/). The animation graph editor uses the same
framework.

Node connections are serialized by stable identifiers rather than pointers, so a
graph survives node reordering.

## Cooker

`Engine/Editor/Source/Cooker` is editor-side. It walks the dependency graph from
the cook roots (`Cooker/Graph`), runs per-type analyzers (`Cooker/Analyzers`)
that report additional references a package's import table does not capture, and
writes cooked packages, the baked asset registry, the shader cache, and the
`.pak`. See [Assets](/internals/assets/).

Analyzer transitivity matters: an analyzer that reports a reference must report
it for every level of the graph, or content reachable only through that edge is
dropped from the cook.

## Thumbnails

`Engine/Editor/Source/Thumbnails` renders asset thumbnails asynchronously
through a service, so importing a folder of meshes does not block the UI. Tools
opt in with `ShouldGenerateThumbnailOnSave()`.

## Adding an editor tool

1. Derive from `FEditorTool` (or `FAssetEditorTool` for an asset).
2. Implement `OnInitialize`, `OnDeinitialize`, `GetUniqueTypeID`,
   `GetUniqueTypeName`.
3. Register it with `FEditorToolRegistry` from your module's `StartupModule`,
   which must run in the `EditorInit` plugin phase.
4. If it needs a menu entry, register with `ToolsMenuRegistry`.
5. If it edits objects, open an `FEditorTransaction` around mutations.

## Common failure modes

| Symptom | Cause |
| --- | --- |
| A plugin's asset editor never opens | Registered outside the `EditorInit` phase, or a more derived class match won. |
| UI deadlock on a dialog | Two modal owners. Route through `EditorToolModal`. |
| Undo restores the wrong state | A mutation happened outside the transaction scope, or the snapshot did not cover the changed object. |
| Dragging a gizmo creates hundreds of undo steps | The transaction was opened per frame instead of per drag. |
| The editor stalls after a swapchain resize | An ImGui snapshot slot was not released on an early-return path. |
| Cooked build missing content | An analyzer edge that was not reported transitively. |
| Picking selects nothing | The picker readback region did not include the cursor, or the picker pass ran before the geometry that should be selectable. |
