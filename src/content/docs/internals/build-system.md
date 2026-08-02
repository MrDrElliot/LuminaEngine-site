---
title: Build System
description: LuminaBuildTool, targets, modules, plugins, and the rules files that describe them.
---

Lumina builds with **LuminaBuildTool** (LBT), its own build tool. You describe what to
build in small C# files next to your code, and LBT works out the rest: dependency order,
what needs recompiling, and the IDE projects.

There is no CMake and no Premake. Visual Studio is used as a compiler and a place to
debug, not as the build system.

## Building

From the engine root:

```bat
LuminaBuild.bat Build Lumina -TargetType=Editor -Configuration=Development
```

Or generate a solution and press F5:

```bat
GenerateProjectFiles.bat
```

Useful options:

| Option | What it does |
| --- | --- |
| `-Configuration=Debug\|Development\|Shipping` | Which configuration to build |
| `-TargetType=Editor\|Game\|Program` | Editor build, standalone game, or a tool |
| `-Project=<path>` | Build a game project instead of the engine |
| `-Clean` | Delete outputs first |
| `-NoUnity` | Compile every file separately, see [Unity builds](#unity-builds) |
| `-DryRun` | List what would rebuild without doing it |

## The three things you declare

**A target** is something you can build and run: the editor, a game, a tool. Declared in
`<Name>.Target.cs`.

**A module** is one library. It compiles to a DLL and is the unit of dependency. Declared
in `<Name>.Build.cs`.

**A plugin** is a folder of modules that can be switched on and off per project. Declared
in `<Name>.lplugin`.

A target names one launch module, and pulls in whatever that module depends on.

## Modules

A module is a folder with a `.Build.cs` in it. Everything beside the file is its source.

```
Source/Combat/
├── Combat.Build.cs
├── CombatComponent.h
└── CombatComponent.cpp
```

```csharp
using LuminaBuildTool.Configuration;

public class Combat : LuminaModuleRules
{
    public Combat(TargetInfo Target)
        : base(Target)
    {
        PublicDependencyModuleNames.Add("Runtime");

        PrivateDependencyModuleNames.Add("JoltPhysics");
    }
}
```

That is a complete module. No source list, no project file, no registration anywhere
else. Add a `.cpp` and it compiles on the next build.

### Public versus private

This is the one distinction worth understanding.

**Public** means "my headers expose this, so anyone using me needs it too". A dependent
gets it automatically.

**Private** means "I use this inside my `.cpp` files". It stops at your module.

```csharp
// CombatComponent.h includes a Runtime header, so anyone including
// CombatComponent.h needs Runtime as well.
PublicDependencyModuleNames.Add("Runtime");

// Only CombatComponent.cpp touches Jolt. Nobody downstream needs to know.
PrivateDependencyModuleNames.Add("JoltPhysics");
```

Prefer private. It keeps rebuilds small and stops one module's choices spreading through
the codebase.

### Common settings

```csharp
// Extra include paths, relative to the module directory.
PublicIncludePaths.Add("Public");
PrivateIncludePaths.Add("Internal");

// Preprocessor defines.
PublicDefinitions.Add("COMBAT_ENABLED=1");
PrivateDefinitions.Add("COMBAT_INTERNAL_CHECKS=1");

// A precompiled header for this module.
PrecompiledHeader = new PrecompiledHeaderRules("CombatPCH.h", "Source/CombatPCH.cpp");

// Skip reflection if this module has no reflected types. Saves build time.
bEnableReflection = false;

// A file that needs a flag the rest of the module must not get.
AddPerFileOption("Scheduler.cpp", "/GT");
```

If you name a file that does not exist, the build fails and tells you. A setting attached
to a renamed file would otherwise disappear silently.

### Exporting types

Mark anything other modules need with your module's API macro:

```cpp
class COMBAT_API FCombatSystem
{
    ...
};
```

The build system defines `COMBAT_API` for you, working out export versus import from the
dependency graph. There is no header to edit and nothing to declare.

## Targets

A target says what to build and how to run it.

```csharp
using LuminaBuildTool.Configuration;

public class MyGameTarget : LuminaGameTargetRules
{
    public MyGameTarget(TargetInfo Target)
        : base(Target)
    {
        LaunchModuleName = "MyGame";

        SetProjectFileToOpen("../MyGame.lproject");
    }
}
```

Most projects never need more than this. Targets can also set engine-wide options
(`bMonolithic`, `CppStandard`, `GlobalDefinitions`), but changing those means the engine
is compiled differently for your target and is no longer shared with other projects.

## Plugins

A plugin bundles modules that can be turned on and off per project. Project plugins live
in `Plugins/` beside your `.lproject`; engine plugins live in the engine's own `Plugins/`.

```
Plugins/Combat/
├── Combat.lplugin
└── Source/
    ├── CombatRuntime/          Loaded in the editor and in a packaged game
    └── CombatEditor/           Editor only, stripped from packaged builds
```

The descriptor lists the modules and when they load:

```json
{
    "Name": "Combat",
    "EnabledByDefault": true,
    "Modules": [
        { "Name": "CombatRuntime", "Type": "Runtime", "LoadingPhase": "PreEngineInit" },
        { "Name": "CombatEditor",  "Type": "Editor",  "LoadingPhase": "EditorInit" }
    ]
}
```

Create one from the editor with **Tools > Plugin Browser > New Plugin**, which scaffolds
it and regenerates your project files. Toggle plugins in the same window; the choice is
recorded in your `.lproject`.

Plugin names must be unique across your project and the engine, because discovery keys on
the name.

## Game projects

A project builds against the engine tree rather than a prebuilt copy:

```bat
LuminaBuild.bat Build MyGame -Project=C:\Path\To\MyGame
```

Your modules build into your project's `Binaries` and `Intermediates`. Engine modules stay
in the engine tree and are shared by every project, so the engine is built once, not once
per project. The first build on a fresh clone pays for the engine; every project after that
reuses it.

In the generated solution your code appears under `Games/<Project>/Source` and
`Games/<Project>/Plugins`, with the engine's own projects kept separate.

## Unity builds

LBT compiles each module as a few generated files that include the real sources, so shared
headers are parsed once per group instead of once per file. This is on by default.

It changes what the language guarantees: sources in one group share a translation unit, so
a file-scope `static`, an anonymous namespace, a `using namespace`, or a leftover macro
reaches its neighbors.

If a compile error only appears in a normal build and not with `-NoUnity`, that is the
cause. Two ways out:

```csharp
// One file that must stay on its own, for example because it carries a
// single-header library's implementation macro.
ExcludeFromUnity.Add("StbImageImpl.cpp");

// Or opt the whole module out.
bUseUnityBuild = false;
```

Files with per-file compiler options, a precompiled header source, and generated reflection
code are held back automatically.

## Reflection

Modules with `bEnableReflection` are scanned for `REFLECT()` types and the generated code is
compiled in. This is automatic; you only interact with it by including the generated header:

```cpp
#include "CombatComponent.generated.h"
```

See [Reflection & Codegen](/internals/reflection-codegen/) for what the generator produces.

## Adding files

Add a `.cpp` or `.h` anywhere under a module and it is picked up on the next build. Re-run
`GenerateProjectFiles.bat` only when you want the IDE's file list to catch up.

## When something goes wrong

| Symptom | Cause |
| --- | --- |
| `No target named 'X'` | Building a project without `-Project=<path>` |
| `Module 'X' has no source or header files` | The `.Build.cs` is not beside the sources |
| `lists 'Y.cpp' but has no such source file` | A file named in the rules was renamed or removed |
| Error disappears with `-NoUnity` | A unity merge conflict, see above |
| `<NAME>_API` undefined | The module is not in the dependency graph of what you are building |

Build with `-Verbose` to see what the tool decided and why.
