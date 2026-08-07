---
title: How to Contribute
description: Workflow, coding standards, and the pull request process.
sidebar:
  order: 1
---

Contributions are welcome. The canonical, always-current version of this document
is
[CONTRIBUTING.md](https://github.com/MrDrElliot/LuminaEngine/blob/main/CONTRIBUTING.md)
in the engine repository; this page summarizes it and points at the parts of the
documentation you will need.

## Before you start

1. Get the engine building. See [Installation](/getting-started/installation/).
2. Read the [Engine Internals](/internals/) overview, in particular
   [Application Lifecycle](/internals/application-lifecycle/) and
   [Threading Model](/internals/threading-model/). Most first-contribution
   mistakes are threading or lifetime mistakes.
3. Discuss anything substantial in an issue first. Small fixes can go straight to
   a pull request.

## Workflow

```bash
git clone https://github.com/YOUR_USERNAME/LuminaEngine.git
```

```bash
git remote add upstream https://github.com/MrDrElliot/LuminaEngine.git
```

```bash
git checkout -b feature/my-change
```

Rebase on the latest `main` before opening a pull request.

## Coding standards

### Prefixes

| Prefix | Use |
| --- | --- |
| `F` | Internal engine types (non-reflected): `FRenderManager`, `FEngine` |
| `C` | Reflected `CObject` classes: `CWorld`, `CTexture` |
| `S` | Reflected structs: `SPostProcessSettings` |
| `E` | Enums: `EUpdateStage` |
| `I` | Interfaces: `IRenderScene`, `IModuleInterface` |
| `T` | Templates: `TObjectPtr<T>`, `TVector<T>` |
| `G` | Globals: `GEngine`, `GRenderManager` |

### Case and formatting

- **PascalCase for everything**: types, functions, variables (local, member,
  global), constants, namespaces. No `snake_case`, no `camelCase`, and no
  Hungarian notation beyond `b` for booleans.
- **Allman braces**: opening brace on its own line.
- American English spelling.
- Comments are terse and explain *why*, not *what*. Do not add banner comments or
  restate the code.
- Do not use em dashes in prose or comments.

### Patterns

- **No raw `CObject*` ownership.** Use `TObjectPtr<T>` for owning references and
  `TWeakObjectPtr<T>` for non-owning ones. See
  [The Object System](/internals/cobject/).
- Prefer the engine's containers, allocators, and math types over the standard
  library equivalents in engine code.
- Constrain templates with concepts.
- Mark affinity in the name when it is not obvious: `_GameThread` for a hard
  game-thread requirement, `_Extract` / `_Render` for which half of the frame a
  render-side function belongs to.
- Reflected structs get the `S` prefix and a `GENERATED_BODY()`; the generated
  header include goes **last**. See
  [Reflection and Code Generation](/internals/reflection-codegen/).

## Adding files

Adding or removing a source file needs no build script edit. LuminaBuildTool
discovers every `.cpp` and `.h` under a module's directory at build time, and the
reflection step reads the same list. Regenerate project files only when you want
the IDE's file list to catch up:

```bash
GenerateProjectFiles.bat
```

See [Build System](/internals/build-system/).

## Quality checklist

Before opening a pull request:

- Compiles without warnings on MSVC.
- Follows the naming and style conventions above.
- No raw owning `CObject*`.
- Threading assumptions stated and correct. If your code runs on a job, it does
  not cache a worker index across a wait, and does not touch main-thread-only
  state.
- Resources are freed on the deferred schedule if the GPU can still reference
  them.
- No new warnings from the Vulkan validation layers in a Debug build.
- Documentation updated when behavior changes.
- Performance impact considered, and measured if the change is on a hot path.
  For build-time changes, measure CPU seconds rather than wall clock.

The Tests target is not part of a normal solution build. Build it when your
change has test coverage:

```bash
LuminaBuild.bat Build Tests
```

## Commit messages

```
[Category] Brief description (50 chars or less)

More detailed explanation if needed, wrapped at 72 characters.
Explain the problem this commit solves and why you chose this
particular solution.

Fixes #123
```

Categories: `Feature`, `Fix`, `Refactor`, `Docs`, `Test`, `Perf`.

Write in the imperative mood and be specific. "Fix crash when destroying entities
during iteration" beats "Fixed stuff".

## Pull requests

Include a description, the motivation, the changes made, how you tested
(editor, standalone game, packaged), screenshots for visual changes, and any
related issues.

A maintainer reviews within a few days. Address feedback, and once approved the
change is merged and credited in the release notes.

## Documentation

This site lives in its own repository,
[LuminaEngine-site](https://github.com/MrDrElliot/LuminaEngine-site). Every page
has an "Edit page" link. See [Editing These Docs](/contributing/editing-these-docs/)
for the local workflow.

When you change engine behavior, update the affected page in the same pull
request cycle. The [Engine Internals](/internals/) pages are written against the
source and go stale quickly if a refactor lands without touching them.
