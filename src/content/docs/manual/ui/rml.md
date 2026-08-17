---
title: RML Syntax
description: The markup language behind Lumina's UI. Document structure, elements, templates, and the full data binding reference.
---

**RML** is RmlUi's markup language. It reads like HTML: tags, attributes,
nesting, and text. This page is the syntax reference for authoring a Lumina
document. For how it is styled, see [RCSS Styling](/manual/ui/rcss/); for
driving it from code, see [Driving UI from C#](/manual/scripting/ui/).

## Document structure

Every document is an `<rml>` root with a `<head>` and a `<body>`.

```html
<rml>
<head>
    <title>My Document</title>

    <!-- An external stylesheet. Relative to this file, or an absolute virtual path. -->
    <link type="text/rcss" href="MyDocument.rcss"/>

    <!-- A reusable widget, registered so <template src="..."> can inject it. -->
    <link type="text/template" href="Window.rml"/>

    <!-- Rules can also live inline. Handy while prototyping; move them to a
         .rcss once more than one document needs them. -->
    <style>
        div { display: block; }
    </style>
</head>
<body>
    <div class="panel">Content goes here.</div>
</body>
</rml>
```

`<title>` is metadata, not a visible element. Comments are `<!-- ... -->` and may
span lines.

:::note[`@import` does not work]
RmlUi does not support the CSS `@import` at-rule. Pull in another stylesheet with
a `<link>` in the document head instead.
:::

## Elements

Any tag name is valid. Unknown tags become a generic element, so `<panel>` and
`<row>` work exactly like `<div>` and are purely a readability choice. What
differs between them is only what your stylesheet says.

A handful of tags have built-in behavior:

| Tag | Behavior |
| --- | --- |
| `<body>` | The document root element. |
| `<div>`, `<span>`, `<p>`, and any other name | Generic. No behavior; styling decides everything. |
| `<img>` | Draws a texture. See [Images](#images). |
| `<input>` | Form control. See [Form controls](#form-controls). |
| `<textarea>` | Multi-line text entry. |
| `<select>` with `<option>` children | Drop-down list. |
| `<label>` | Forwards clicks to the control named by its `for` attribute. |
| `<form>` | Groups controls for submission. |
| `<progress>` (or `<progressbar>`) | A progress bar. Set `value`, optionally `max` (default 1), `direction`, and `start-edge`. |
| `<tabset>` | Tabbed panel. See [Tabsets](#tabsets). |
| `<handle>` | A drag handle that moves or resizes another element. |

### Common attributes

| Attribute | Meaning |
| --- | --- |
| `id` | Unique name. Selected in RCSS as `#name`, and fetched from C# with `document["name"]`. |
| `class` | Space-separated style classes. Selected as `.name`. |
| `style` | Inline RCSS for this element only, for example `style="width: 50dp;"`. |

Text is written directly between tags. It is content, not an element, so you
style it through its parent.

### Images

```html
<img src="/Game/Content/UI/Icons/health.png" width="32" height="32"/>
```

| Attribute | Meaning |
| --- | --- |
| `src` | Virtual path to the texture. |
| `sprite` | A named sprite from an `@spritesheet` rule, instead of `src`. |
| `width` / `height` | Size in pixels. Omit both to use the texture's own size. |
| `rect` | Sub-rectangle of the source texture: `x y width height`. |

### Form controls

```html
<input type="text" data-value="PlayerName"/>
<input type="checkbox" data-checked="Fullscreen"/>
<input type="range" min="0" max="100" step="5" data-value="Volume"/>
<input type="submit">Apply</input>

<select data-value="Difficulty">
    <option value="easy">Easy</option>
    <option value="hard">Hard</option>
</select>

<textarea data-value="Notes"/>
```

Supported `type` values are `text`, `password`, `checkbox`, `radio`, `range`,
`submit`, and `button`. A checkbox or radio carries a `checked` attribute when
selected, which you can style with the `:checked` pseudo-class.

Controls have no built-in appearance. Give them a width, height, and background
in RCSS or they will be invisible.

### Tabsets

A tabset needs a `<tabs>` container and a `<panels>` container, paired by order.

```html
<tabset>
    <tabs>
        <tab>Video</tab>
        <tab>Audio</tab>
    </tabs>
    <panels>
        <panel>Video settings.</panel>
        <panel>Audio settings.</panel>
    </panels>
</tabset>
```

The selected tab gets the `:checked` pseudo-class.

## Data binding

Data binding is the way to drive UI in Lumina. Rather than looking up elements
and pushing text into them from code, the document declares what it wants and
reads it from a **view-model**: a C# class whose properties are the data and
whose methods are the commands.

Bind a subtree to a named model with `data-model`, then use the bindings inside
it:

```html
<body data-model="hud">
    <div class="label">{{ PlayerName }}</div>
    <div class="fill" data-style-width="Health + '%'"/>
    <div class="button" data-event-click="Respawn()">Respawn</div>
</body>
```

The model named `hud` is registered from C# with `World.UI.AddModel("hud", model)`.
See [Driving UI from C#](/manual/scripting/ui/#data-binding-mvvm) for the
view-model side.

:::caution[Register the model first]
RmlUi resolves bindings while parsing the document. `AddModel` must run before
`LoadDocument`, or the bindings silently resolve to nothing.
:::

### The bindings

| Binding | Effect |
| --- | --- |
| `{{ Expr }}` | Interpolate a value into text, inline with other text. |
| `data-text="Expr"` | Replace the element's entire text with a value. |
| `data-rml="Expr"` | Replace the element's inner markup with a value. The string is parsed as RML, so only use it on trusted content. |
| `data-style-<prop>="Expr"` | Drive one RCSS property, for example `data-style-width="Health + '%'"`. |
| `data-class-<name>="Expr"` | Add the class while the expression is true, remove it when false. |
| `data-attr-<name>="Expr"` | Drive an attribute's value. |
| `data-attrif-<name>="Expr"` | Add the attribute (with no value) while the expression is true. |
| `data-if="Expr"` | Include the element in the document only while true. Removed from layout entirely when false. |
| `data-visible="Expr"` | Show or hide the element, keeping it in the document. |
| `data-value="Prop"` | **Two-way** bind a form control's value. |
| `data-checked="Prop"` | **Two-way** bind a checkbox or radio. |
| `data-event-<event>="Cmd(args)"` | Call a command when the event fires, for example `data-event-click`. |
| `data-for="item : List"` | Repeat this element once per list item. See [Lists](#lists). |
| `data-alias-<name>="Variable"` | Give a bound variable a second name inside this element's subtree. Takes a variable, not an expression. |

Two-way means the control writes back: typing in a `data-value` field runs the
C# property's setter. A bound property with no setter is display-only, and
writebacks to it are ignored.

### Expressions

Bindings take expressions, not just names:

- Arithmetic: `+`, `-`, `*`, `/`
- Comparison: `==`, `!=`, `<`, `<=`, `>`, `>=`
- Logic: `!`, `&&`, `||`
- Literals: numbers, `'single-quoted strings'`, `true`, `false`
- Ternary: `Cond ? A : B`
- The transform pipe: `Value | transform(args)`

The built-in transforms are `to_lower`, `to_upper`, `format(decimals)`, and
`round`.

```html
<div data-if="Health &lt; 25" class="warning">Critical</div>
<div data-text="'Score: ' + Score"/>
<div data-class-dead="Health == 0"/>
```

Because RML is XML-like, `<` and `&` inside an attribute must be escaped as
`&lt;` and `&amp;`. Flipping the comparison (`Health > 25` negated) is usually
easier to read than escaping.

See the [RmlUi expression reference](https://mikke89.github.io/RmlUiDoc/pages/data_bindings/expressions.html)
for the full grammar.

### Commands

`data-event-<event>` calls a method on the view-model. Any RmlUi event name
works: `click`, `mousedown`, `mouseover`, `change`, `submit`, `keydown`.

```html
<div data-event-click="Play()">Play</div>
<div data-event-click="ApplyPreset('high')">High</div>
```

Arguments cross to C# as strings and are converted to the parameter's type, so a
command may take parameters.

### Lists

`data-for` repeats an element once per item in a bound list. The loop variable
exposes that item's own bound members.

```html
<div class="card" data-for="member : Members">
    <div class="name">{{ member.Name }}</div>
    <div class="fill" data-style-width="member.Health + '%'"/>
</div>
```

The element carrying `data-for` is the one repeated, and it is repeated in place,
so wrap it in a container if you want to lay the items out.

Lists are pushed as a snapshot and are **display-only**: a repeated element
cannot write back. Mutate the C# list and re-push it to change what is shown.

### What can be bound

Lumina's binding layer maps a limited set of C# types.

| Bindable | Notes |
| --- | --- |
| `bool`, `string` | |
| Integer types and enums | Enums cross as their integer value. |
| `float`, `double` | |
| `IEnumerable<T>` where `T` has bound members | Becomes a `data-for` list. |

Anything else is skipped with a warning in the log. In particular there is **no
nested object binding**: `{{ Player.Name }}` does not work outside a `data-for`
loop. Expose the value you need as a flat property on the model instead.

## Templates and composition

A **template** is a reusable fragment: a health bar, a window frame, a stat
panel. It is an `.rml` file whose root is `<template>` rather than `<rml>`.

```html
<template name="healthbar" content="healthbar-body">
<head>
    <style>
        div { display: block; box-sizing: border-box; }
        .hpbar { width: 200dp; padding: 8dp; background-color: #11111b; }
    </style>
</head>
<body>
    <div class="hpbar">
        <div class="label">HEALTH {{ Health }}%</div>
        <div class="track"><div class="fill" data-style-width="Health + '%'"/></div>

        <!-- Anything the consumer nests inside the template lands here. -->
        <div id="healthbar-body"/>
    </div>
</body>
</template>
```

| Attribute | Meaning |
| --- | --- |
| `name` | The name consumers refer to it by. Not the filename. |
| `content` | The `id` of the element inside the template that receives the consumer's children. |

To use a template, register it in your head and then inject it:

```html
<head>
    <link type="text/template" href="HealthBar.rml"/>
</head>
<body data-model="hud">
    <!-- Inline: drop the widget at this point in the document. -->
    <div id="hp"><template src="healthbar"/></div>
</body>
```

Or wrap the whole document in one, which is how you get shared window chrome:

```html
<body template="window" data-model="settings">
    <!-- These children land inside the window template's content element. -->
    <div class="row">Master Volume</div>
</body>
```

Three things worth knowing:

- **Templates bind to the consumer's model.** A template has no model of its own.
  `{{ Health }}` inside `HealthBar.rml` resolves against whatever document
  composes it, which is why the same widget works in a HUD and in a roster card.
- **Registration is transitive.** A template that itself uses another template
  registers the inner one in its own `<head>`, and documents that use the outer
  one get both for free.
- **A `<template src>` leaves no element behind.** It is consumed at parse time
  and replaced by the template's contents, so you cannot find it in the DOM later.

The [UI editor](/manual/ui/editor/#composing-widgets) can assign templates to
slots visually and writes exactly this markup.

## Escaping

RML is parsed as XML, so five characters need escaping in text and attributes:

| Character | Write it as |
| --- | --- |
| `<` | `&lt;` |
| `>` | `&gt;` |
| `&` | `&amp;` |
| `"` | `&quot;` |
| `'` | `&apos;` |

Text set from C# with `UIElement.SetText` is escaped for you. Text set through
`UIElement.Rml` or `data-rml` is not, and is parsed as markup.
