---
title: Logging
description: How to log from C++ and C#, the LOG_ macros, the Debug class, severities, and where the output ends up.
---

Everything logged by the engine, the editor, and your scripts goes through one
logger. It writes to three places at once:

- the **console** attached to the process,
- **`Lumina.log`**, next to the executable (rotated per run, five kept),
- the editor's **[Output Log](/manual/editor/panels/)** panel (**Ctrl+J**).

Logging is asynchronous: the calling thread formats the message and hands it off,
and a background thread does the writing. It's cheap enough to call from gameplay
code, and it's safe from any thread.

## C++

Include `Log/Log.h` (already in the precompiled header for most modules) and use
the macros. The format string uses the engine's formatter, `Lumina::Format`,
with the standard `{}` placeholder syntax.

```cpp
LOG_INFO("Loaded {} assets in {:.2f} ms", Assets.size(), ElapsedMs);
LOG_WARN("Mesh '{}' has no material slot {}", Mesh->GetName(), SlotIndex);
LOG_ERROR("Failed to open {}", Path);
```

Arguments are checked at compile time, so a mismatched placeholder is a build
error, not a garbled line at runtime.

| Macro | Severity | Survives Shipping |
| --- | --- | --- |
| `LOG_CRITICAL` | critical | yes |
| `LOG_ERROR` | error | yes |
| `LOG_WARN` | warning | yes |
| `LOG_DISPLAY` | info | yes |
| `LOG_INFO` | info | no |
| `LOG_DEBUG` | debug | no |
| `LOG_TRACE` | trace | no |

`LOG_TRACE` / `LOG_DEBUG` / `LOG_INFO` compile to nothing in Shipping builds
(they're gated on the `VerboseLogging` build feature), so their arguments cost
nothing there. Use them freely for everyday status.

`LOG_DISPLAY` is the one info-severity macro that survives Shipping. Reserve it
for one-shot boot and system milestones you'd want in a packaged game's log,
like mounted PAKs, "loading startup map X", or a linked plugin module. It is not a
general info channel; frequent use drowns out the signal.

### Logging your own types

A single argument is logged verbatim, so braces in it are harmless:

```cpp
LOG_ERROR(ErrorText);   // ErrorText is an FString / const char* / FStringView
```

`FString`, `FStringView`, `FName`, `FGuid`, and `FTransform` can be passed
straight in, as can anything else with `data()` and `size()` over `char`. Math
types can't, so use `Math::ToString`:

```cpp
LOG_INFO("Spawned {} at {}", Prefab->GetName(), Math::ToString(Location));
```

For your own types, declare a `FormatArgument` beside the type and the logger
finds it through ADL. The specifier arrives already parsed, so there is no
separate parse step:

```cpp
void FormatArgument(Fmt::FFormatBuffer& Out, const FMyType& Value, const Fmt::FFormatSpec& Spec)
{
    AppendFormat(Out, "{}:{}", Value.Name, Value.Index);
}
```

The same formatter is available outside logging as `Format`, `FormatAs<T>`,
`AppendFormat`, `FormatTo`, and `FStringBuilder`. See
[Math and Containers](/internals/math-and-containers/#formatting).

### Flushing

Log writes reach the OS at the end of every batch, so a crash won't lose them.
If you need a hard guarantee before doing something dangerous, call
`Logging::Flush()`, which blocks until everything logged so far has landed. The
crash handler, the assert handler, and the hang watchdog already do this.

## C#

Use the static `Debug` class. It's available anywhere in script code.

```csharp
public override void OnReady()
{
    Debug.Log($"{Entity} ready with {Health} hp");
    Debug.LogWarning("No spawn point assigned, falling back to origin");
    Debug.LogError("Target prefab failed to load");
}
```

| Call | Severity |
| --- | --- |
| `Debug.Log` | info |
| `Debug.LogWarning` | warning |
| `Debug.LogError` | error |

Use C# string interpolation (`$"..."`), the message is a plain string by the
time it reaches the engine.

Script messages are tagged `[C#]` in the log, so they're easy to pick out:

```
[2026-07-28 14:51:22.147] [info    ] [9128] [C#] Loaded C# scripts [generation 1]
```

Unhandled exceptions in script callbacks are logged as errors automatically, with
the stack trace, so you don't need to wrap callbacks in try/catch just to see them.

:::note
`Debug.Log` maps onto `LOG_INFO`, which is stripped from Shipping builds. That's
usually what you want for gameplay logging. Anything that must survive a
packaged build should be logged from C++ with `LOG_DISPLAY`, or raised as a
warning or error.
:::

## Reading the output

The file log carries the full detail; the console is the short form.

```
[2026-07-28 14:51:18.682] [info    ] [9128] Job system online: 30 workers
 └─ date + time      └─ severity  └─ thread id
```

The thread id matters more than it looks: the engine runs gameplay, rendering,
and job workers concurrently, so two interleaved lines are often two threads, not
one confused system.

In the editor, the Output Log panel filters by severity and text, and doubles as
the console-variable command line.
