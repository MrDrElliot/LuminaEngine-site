---
title: Tasks & Yielding
description: Pause a script and resume it later — waits, task scheduling, and awaitable loads.
---

A script can **pause and resume later** without blocking the game. This is called
*yielding*: the script hands control back to the engine, and the engine resumes
it when the thing it's waiting on is ready. It's what lets you write a sequence
top-to-bottom instead of scattering it across callbacks:

```lua
function Script:OnReady()
    Wait(1)                                            -- pause for a second
    local door = Asset.LoadAwait("/Game/Props/Door")   -- pause until it loads
    self:Spawn(door)
    print("ready")
end
```

While this script is paused, every other script keeps running — only *this* one
is suspended.

## `Wait`

`Wait(seconds)` pauses the current script for `seconds`, then resumes it. `Wait()`
with no argument resumes on the next frame.

```lua
Wait(0.5)        -- half a second
Task.Wait(0.5)   -- identical; the Task.* spelling
```

## Where you can yield

Yielding only works from a script thread that is allowed to pause. The
once/per-event hooks run on such a thread, so you can `Wait` (and await) directly
inside them. The per-frame and teardown hooks do not — a hook that ran every
frame can't pause mid-frame.

| Hook | Can yield directly? |
| --- | --- |
| `OnAttach`, `OnReady` | Yes |
| `OnInput`, `OnContactBegin`/`End`, `OnOverlapBegin`/`End` | Yes |
| `OnUpdate`, `OnFixedUpdate`, `OnEditorUpdate` | No — use `Task.Spawn` |
| `OnDetach` | No (the entity is going away) |

From a hook that can't yield, start a **task**: a separate script thread that
*can*.

```lua
function Script:OnUpdate(dt)
    if self.ShouldOpen and not self.Opening then
        self.Opening = true
        Task.Spawn(function()
            Wait(0.25)
            self:Open()        -- OnUpdate already returned; this runs on its own thread
        end)
    end
end
```

## The `Task` library

| Call | Does |
| --- | --- |
| `Task.Wait(seconds)` | Pause the current thread, then resume. Same as `Wait`. |
| `Task.Spawn(fn, ...)` | Run `fn` now on a new thread (passing any extra args), up to its first pause. |
| `Task.Delay(seconds, fn)` | Run `fn` on a new thread after `seconds`. |
| `Task.Defer(fn)` | Run `fn` on a new thread next frame. |

`Task.Delay` and `Task.Defer` take a function of no arguments — capture what it
needs with a closure (`Task.Delay(2, function() self:Explode() end)`).

## Awaitable loading

`Asset.LoadAwait(path)` pauses until the asset finishes loading in the
background, then resumes with it (or `nil` if the path doesn't resolve). It's the
pausing form of [`Asset.LoadAsync`](/manual/assets/references/) — no callback,
just a return value:

```lua
Task.Spawn(function()
    local fx = Asset.LoadAwait("/Game/FX/Explosion")
    if fx then
        self:Spawn(fx)
    end
end)
```

## Cancellation

Waits are tied to your entity. If the entity is **destroyed while a script is
paused**, the pending wait is dropped — the thread is simply never resumed, so it
can't run code against a dead entity. You don't need to clean these up by hand.

:::note[Keep waits out of `OnUpdate`]
Don't `Wait` *directly* in `OnUpdate`/`OnFixedUpdate` — those can't pause, and
you'd get an error. Spawn a task instead, and guard against starting it twice (a
flag like `self.Opening` above), since `OnUpdate` keeps running while the task is
paused.
:::
