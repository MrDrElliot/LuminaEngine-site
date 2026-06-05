---
title: Reflection
description: How Lumina knows its own types at runtime.
---

:::note
This page is a stub. A full reference is coming. For now, here is what you need
to know as a user.
:::

**Reflection** is the system that makes Lumina's C++ types known at runtime. You
mark a class, struct, or property in C++, and the engine generates the metadata
that describes it. That metadata powers three things you use every day:

- **The editor**, the Details panel builds itself from a component's reflected
  properties, so there is no hand-written UI per component.
- **Serialization**, reflected properties are what gets saved into worlds,
  prefabs, and assets.
- **Scripting**, every reflected component type is exposed to Luau by its name,
  so you can write `self:AddComponent(SRigidBodyComponent)` with no glue code.
  See [Lua Scripting](/manual/scripting/).

## Naming prefixes

Reflection is also why Lumina's type names carry a one-letter prefix:

| Prefix | Meaning | Example |
| --- | --- | --- |
| `C` | A reflected class (a `CObject`, usually an asset or type) | `CMaterial`, `CPrefab` |
| `S` | A reflected struct, including all components | `STransformComponent`, `SRigidBodyComponent` |
| `F` | A plain (non-reflected) engine type | `FVector3`, `FName` |

When you see an `S`-prefixed name in the editor or in a script, it is a reflected
type, and the same name works in Luau.
