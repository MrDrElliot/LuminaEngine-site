---
title: User Interface
description: Screen-space UI with RmlUi. Bind a C# view-model (MVVM) or drive the DOM directly, and handle events.
---

Lumina's screen UI is built on **[RmlUi](https://mikke89.github.io/RmlUiDoc/)**,
an HTML/CSS-style retained-mode UI library. You author the look as **`.rml`**
markup and **`.rcss`** stylesheet assets, then load, show, and drive them from a
script through `World.UI`. Documents render full-screen over the world's view.

:::note
`World.UI` is screen-space UI for a world's viewport. For UI that lives *in* the
world (a panel on a control console, a floating health bar), use a world-space
`SWidgetComponent` instead.
:::

## Authoring a document

An RML document is markup with an attached stylesheet. Create one from the
Content Browser and edit it in the [UI asset editor](/manual/editor/asset-editors/).
Here is a minimal menu.

```html
<rml>
<head>
    <title>Lumina Menu</title>
    <link type="text/rcss" href="Menu.rcss"/>
</head>
<body>
    <div id="panel">
        <div class="title">LUMINA</div>
        <div id="play" class="button">Play</div>
        <div id="toggle" class="button secondary">Toggle Theme</div>
        <div id="status" class="status">Click Play to begin.</div>
    </div>
</body>
</rml>
```

Elements are matched from script by their `id` (`#play`) or CSS classes, and
`.rcss` styles them with familiar CSS-like properties (`color`, `width`,
`background-color`, flexbox layout, transitions). See the
[RmlUi RCSS reference](https://mikke89.github.io/RmlUiDoc/pages/rcss.html).

## Loading and showing

Load a document by its virtual asset path. It starts hidden, call `Show` to
present it. A common pattern is to expose the path as a `[Property]` so it's
editable.

```csharp
public sealed class Menu : EntityScript
{
    [Property(Tooltip = "RML document shown on screen.", AssetType = "rml")]
    public string Document = "/Game/Content/UI/Menu.rml";

    private UIDocument _Doc;

    public override void OnReady()
    {
        _Doc = World.UI.LoadDocument(Document);
        if (!_Doc.IsValid)
        {
            Debug.LogError($"Failed to load UI document '{Document}'.");
            return;
        }

        _Doc.Show();
        World.UI.EnableCursor();   // free the cursor so buttons are clickable
    }

    public override void OnDetach()
    {
        _Doc.Close();              // unload before the world tears down
        World.UI.DisableCursor();
    }
}
```

| `World.UI` member | Does |
| --- | --- |
| `LoadDocument(path)` | Loads an `.rml` asset; returns a `UIDocument` (hidden until shown). |
| `LoadDocumentFromMemory(rml, sourceUrl)` | Loads a document from an in-memory RML string. |
| `SetInputMode(mode)` / `SetCursorMode(mode)` | Route input and set cursor visibility (below). |
| `EnableCursor()` / `DisableCursor()` | Shortcuts for menu-open / menu-close cursor state. |

| `UIDocument` member | Does |
| --- | --- |
| `Show(modal, autoFocus)` | Make it visible. `modal` blocks focus to other documents. |
| `Hide()` | Hide without unloading (handles + listeners stay valid). |
| `Close()` | Unload and destroy. Element handles from it become invalid. |
| `BringToFront()` | Raise above other documents in z-order. |
| `Root` | The document's body element. |

## Data binding (MVVM)

For anything dynamic, prefer **data binding** over poking the DOM by hand. You
write a **view-model** (a C# class whose properties and methods are the data and
commands the UI needs), and the RML binds to it declaratively. When a property
changes the view updates itself; when the user clicks, a command runs. No element
lookups, no manual text/style updates. This is RmlUi's
[data binding](https://mikke89.github.io/RmlUiDoc/pages/data_bindings.html) system,
surfaced to C# as `ViewModel` + `World.UI.AddModel`.

### A view-model

Derive from `ViewModel`, mark data with `[Bind]` and commands with `[BindCommand]`:

```csharp
public sealed class MenuModel : ViewModel
{
    private string _Status = "Click Play to begin.";
    private bool _Dark = true;

    [Bind] public string Status { get => _Status; set => Set(ref _Status, value); }
    [Bind] public bool Dark     { get => _Dark;   set => Set(ref _Dark, value); }

    // Computed (get-only) = display only. Re-push it with NotifyChanged when its input changes.
    [Bind] public string ThemeLabel => _Dark ? "Light theme" : "Dark theme";

    [BindCommand] public void Play()        => Status = "Starting...";
    [BindCommand] public void ToggleTheme() { Dark = !_Dark; NotifyChanged(nameof(ThemeLabel)); }
}
```

`Set(ref field, value)` assigns the backing field and, if it changed, pushes the
new value to the view. A get-only `[Bind]` property is display-only; one with a
setter is **two-way**: form controls write back into it.

### Binding in RML

Mark the element that owns the model with `data-model`, then bind inside it:

```html
<body data-model="menu">
    <div class="panel" data-class-light="!Dark">
        <div class="title">LUMINA</div>
        <div class="button" data-event-click="Play()">Play</div>
        <div class="button" data-event-click="ToggleTheme()">{{ ThemeLabel }}</div>
        <div class="status">{{ Status }}</div>
    </div>
</body>
```

| Binding | Effect |
| --- | --- |
| `{{ Prop }}` | Interpolate a value into text. |
| `data-text="Prop"` | Set the element's whole text. |
| `data-style-<prop>="expr"` | Drive a CSS property, e.g. `data-style-width="Health + '%'"`. |
| `data-class-<name>="expr"` | Add/remove a class while the boolean expression is true. |
| `data-attr-<name>="expr"` | Drive an attribute. |
| `data-if="expr"` / `data-visible="expr"` | Conditionally include / show. |
| `data-value="Prop"` / `data-checked="Prop"` | **Two-way** bind a form control. |
| `data-event-<event>="Cmd(args)"` | Call a `[BindCommand]` on the event. |
| `data-for="item : List"` | Repeat the element per list item (see [Lists](#lists-data-for)). |

Expressions support arithmetic, comparisons, `!` / `&&` / `||`, string literals,
and the `|` transform pipe. See the
[expression reference](https://mikke89.github.io/RmlUiDoc/pages/data_bindings/expressions.html).

### Registering the model

Register the model with `AddModel` **before** loading the document that binds to it
(RmlUi resolves bindings at load time), and **dispose** the returned `UIDataModel`
when done.

```csharp
private MenuModel _Model;
private UIDataModel _Binding;
private UIDocument _Menu;

public override void OnReady()
{
    _Model = new MenuModel();
    _Binding = World.UI.AddModel("menu", _Model);     // BEFORE LoadDocument

    _Menu = World.UI.LoadDocument("/Game/Content/UI/Menu.rml");
    _Menu.Show();
    World.UI.EnableCursor();
}

public override void OnDetach()
{
    _Menu.Close();
    _Binding?.Dispose();    // removes the model, frees the callback
    World.UI.DisableCursor();
}
```

After that, just set properties like `_Model.Status = "Go!";` and the view follows.

### Commands with arguments

A `[BindCommand]` may take parameters; RML passes them in the call:

```csharp
[BindCommand] public void ApplyPreset(string preset) { /* ... */ }
```
```html
<div class="preset" data-event-click="ApplyPreset('high')">High</div>
```

### Lists (`data-for`)

Expose a list of an item type whose properties are `[Bind]`, then repeat an element
over it with `data-for`:

```csharp
private sealed class RosterEntry
{
    [Bind] public string Name   { get; set; }
    [Bind] public int    Health { get; set; }
}

public sealed class RosterModel : ViewModel
{
    private readonly List<RosterEntry> _Members = new() { /* ... */ };
    [Bind] public IReadOnlyList<RosterEntry> Members => _Members;

    public void Touch() => NotifyChanged(nameof(Members));   // re-push after mutating the list
}
```
```html
<div class="card" data-for="member : Members">
    <div class="name">{{ member.Name }}</div>
    <div class="fill" data-style-width="member.Health + '%'"/>
</div>
```

The list is pushed as a snapshot: mutate the C# list, then call
`NotifyChanged(nameof(List))` (or `Refresh()`) to re-push it. List items are
display-only.

### Reference

| `ViewModel` member | Does |
| --- | --- |
| `Set(ref field, value)` | Assign a bound field and push it if it changed. |
| `NotifyChanged(name)` | Force a re-push of one property (computed values, list changes). |
| `Refresh()` | Re-push every bound property. |
| `IsBound` | True once registered and live. |

| Attribute | On | Does |
| --- | --- | --- |
| `[Bind]` | property | A bound variable: one-way if get-only, two-way if it has a setter; a list if the type is `IEnumerable<T>` of a type with `[Bind]` members. |
| `[BindCommand]` | method | Callable from `data-event-*`; may take parameters. |

| `World.UI` member | Does |
| --- | --- |
| `AddModel(name, vm)` | Register a `ViewModel` as a data model (before `LoadDocument`); returns a `UIDataModel`. |
| `GetModel(name)` | Re-fetch a registered model (e.g. to push from another script). |

:::note[When to use which]
Reach for data binding for anything dynamic: HUDs, menus, settings, lists. The
direct DOM API below is the lower-level escape hatch for one-off tweaks or
imperative flows.
:::

## Finding and changing elements

Reach an element by `id` (the indexer or `GetElementById`) or a CSS selector
with `Query`. The returned `UIElement` is a lightweight handle, calls on a
missing element are safe no-ops.

```csharp
UIElement Score = _Doc["score"];        // by id, shorthand for GetElementById
UIElement Fill = _Doc.Query(".bar > .fill");

Score.SetText($"Score: {_Points}");     // escaped plain text
Fill.SetStyle("width", "75%");          // inline CSS
Fill.AddClass("full");
```

| `UIElement` member | Does |
| --- | --- |
| `SetText(value)` / `Text` | Set plain text (HTML-escaped). |
| `Rml` | Get/set the element's inner RML markup (not escaped). |
| `SetStyle(prop, value)` / `ClearStyle(prop)` | Set or remove an inline CSS property. |
| `AddClass` / `RemoveClass` / `ToggleClass(c, on)` / `HasClass` | CSS class control. |
| `GetAttribute(name)` / `SetAttribute(name, value)` | Read/write an attribute. |
| `SetVisible(bool)` / `Visible` | Show/hide via CSS `display`. |
| `Focus()` / `Blur()` / `Click()` | Focus control and synthesizing a click. |
| `Query(selector)` | First descendant matching a CSS selector. |

:::note[Property vs method form]
`Text` and `Visible` are property setters, so they work on a stored variable
(`var e = _Doc["x"]; e.Visible = false;`). On a chained call off the indexer
(`_Doc["x"]`), use the method form (`SetText`, `SetVisible`); you can't assign a
struct property on an rvalue.
:::

## Events

Subscribe to an RmlUi event on an element with `On` (or the `OnClick` shorthand).
The handler runs on the game thread. `On` returns a `UIEventSubscription`, so
**dispose it before the world tears down** (in `OnDetach`).

```csharp
private UIEventSubscription? _PlayClick;

public override void OnReady()
{
    // Wire callbacks BEFORE Show so the first click is handled.
    _PlayClick = _Doc["play"].OnClick(() => StartGame());
    _Doc.Show();
}

public override void OnDetach()
{
    _PlayClick?.Dispose();
    _Doc.Close();
}
```

`OnClick` accepts a no-argument handler or one that takes a `UIEvent`; `On` takes
an event-type string and a `UIEvent` handler. Common event types are `"click"`,
`"mousedown"`, `"mouseup"`, `"mouseover"`, `"mouseout"`, `"mousemove"`,
`"keydown"`, `"keyup"`, `"textinput"`, `"change"`, `"submit"`, `"focus"`,
`"blur"`.

The `UIEvent` passed to a handler.

| Field | Meaning |
| --- | --- |
| `Type` | The `UIEventType` (e.g. `Click`, `MouseDown`, `Change`). |
| `Target` | The deepest element the event originated on. |
| `Current` | The element the listener is attached to. |
| `MouseButton` | 0 = left, 1 = right, 2 = middle; -1 if not a mouse event. |
| `MouseX` / `MouseY` | Cursor position in the document's layout space. |
| `KeyIdentifier` | The RmlUi key id, for key events. |
| `Ctrl` / `Shift` / `Alt` / `Meta` | Modifier keys held with the event. |

## Cursor and input routing

While a menu is open you usually want a visible cursor and the UI to receive
clicks; during gameplay you want the cursor captured for mouselook. `World.UI`
controls both.

```csharp
World.UI.EnableCursor();    // GameAndUI input + a free, visible cursor
World.UI.DisableCursor();   // Game-only input + a captured (hidden, locked) cursor
```

For finer control, set the modes directly.

| `UIInputMode` | Routing |
| --- | --- |
| `Game` | Input drives gameplay only; the UI gets nothing. |
| `UI` | Input drives the UI only; gameplay input is gated off. |
| `GameAndUI` | UI gets first refusal, the rest reaches gameplay. |

| `UICursorMode` | Cursor |
| --- | --- |
| `Normal` | Visible and free, for menus and pointer UI. |
| `Hidden` | Hidden but free to move. |
| `Captured` | Hidden and locked to the window, for mouselook. |

```csharp
World.UI.SetInputMode(UIInputMode.UI);
World.UI.SetCursorMode(UICursorMode.Normal);
```

## Full example

This script loads a menu, wires two buttons back to C#, and mutates the live DOM
in response, the end-to-end shape of a `World.UI` screen.

```csharp
using System;
using LuminaSharp;
using Lumina;

namespace Game;

public sealed class MenuExample : EntityScript
{
    [Property(Tooltip = "RML document shown on screen.", AssetType = "rml")]
    public string Document = "/Game/Content/UI/Menu.rml";

    private UIDocument _Menu;
    private UIEventSubscription? _PlayClick;
    private UIEventSubscription? _ToggleClick;
    private int _PlayCount;
    private bool _DarkTheme = true;

    public override void OnReady()
    {
        _Menu = World.UI.LoadDocument(Document);
        if (!_Menu.IsValid)
        {
            Debug.LogError($"Failed to load UI document '{Document}'.");
            return;
        }

        _PlayClick = _Menu["play"].OnClick(OnPlay);
        _ToggleClick = _Menu["toggle"].OnClick(OnToggleTheme);

        _Menu.Show();
        World.UI.EnableCursor();
    }

    private void OnPlay(UIEvent Event)
    {
        _PlayCount++;
        _Menu["status"].SetText($"Play clicked {_PlayCount}x");
    }

    private void OnToggleTheme(UIEvent Event)
    {
        _DarkTheme = !_DarkTheme;
        _Menu["panel"].SetStyle("background-color", _DarkTheme ? "#1e1e2eff" : "#eff1f5ff");
        _Menu["status"].SetText(_DarkTheme ? "Dark theme" : "Light theme");
    }

    public override void OnDetach()
    {
        _PlayClick?.Dispose();
        _ToggleClick?.Dispose();
        _Menu.Close();
        World.UI.DisableCursor();
    }
}
```
