---
title: Gameplay Tags
description: Hierarchical tags for classifying entities, filtering queries, and naming message channels.
---

A **gameplay tag** is a hierarchical, dotted name like `Ability.Fire.Fireball`.
Tags replace the enums and booleans you would otherwise sprinkle across
components: they are authored as data, matched hierarchically, and compared by
integer at runtime.

They are used in three places:

- **On entities**, through the Gameplay Tag component, to classify what something
  is or what state it is in.
- **As filters**, for example AI perception affiliation.
- **As message channels**, on the gameplay message bus.

## The hierarchy

A tag's dots define its ancestry. `Ability.Fire.Fireball` has parent
`Ability.Fire`, which has parent `Ability`.

Matching comes in two flavors, and picking the wrong one is the most common
mistake with tags:

| Match | Behavior |
| --- | --- |
| **Hierarchical** (`MatchesTag`, `HasTag`) | The tag **is** the queried tag, or a descendant of it. `Ability.Fire.Fireball` matches a query for `Ability.Fire` and for `Ability`. |
| **Exact** (`MatchesTagExact`, `HasTagExact`) | Names are equal. `Ability.Fire.Fireball` matches only `Ability.Fire.Fireball`. |

Matching is directional. A query for `Ability.Fire` is satisfied by
`Ability.Fire.Fireball`, but a query for `Ability.Fire.Fireball` is **not**
satisfied by an entity tagged only `Ability.Fire`. Query the broad tag, tag the
specific one.

## Authoring tags

Project tags live in **Project Settings, Gameplay Tags**
(`CGameplayTagsSettings`), which persists to `/Config/GameplayTags.json`. Each
entry is a dotted name; **ancestors are interned automatically**, so adding
`Ability.Fire.Fireball` also registers `Ability.Fire` and `Ability`. You do not
declare parents separately.

Anywhere a tag is edited you get the **tag picker**, which lists every registered
tag. The picker's plus button appends a new tag to the project settings, so you
can author from the point of use rather than going back to settings.

Tags requested at runtime are also registered, so a tag created in code appears
in the picker even if it was never authored in settings.

## Tagging an entity

Add a **Gameplay Tag** component. Its `Tags` field is a container you seed in the
editor with the picker; scripts add, remove, and query at runtime.

Hierarchical matching applies to queries: an entity tagged `Status.Burning`
satisfies a query for `Status`.

## Tag containers

`FGameplayTagContainer` is an unordered set of tags, authored as a list where
each element uses the picker. It is the type you put on your own components and
data assets when something needs a set of tags rather than one.

| Operation | Behavior |
| --- | --- |
| `AddTag` / `RemoveTag` | Add or remove. Removal is exact. |
| `HasTag` | Hierarchical. A `Damage.Fire` entry satisfies `HasTag("Damage")`. |
| `HasTagExact` | Exact. |
| `HasAny(Other)` | Any tag in `Other` matches. |
| `HasAll(Other)` | Every tag in `Other` matches. |
| `Num` / `IsEmpty` | Size queries. |

## From C#

Tags are integer ids at runtime, so comparisons are cheap. `GameplayTag.Request`
interns a name and returns the tag.

```csharp
GameplayTag Burning = GameplayTag.Request("Status.Burning");

World.Tags.Add(Entity, Burning);
World.Tags.Add(Entity, "Status.Stunned");     // string overload interns for you

if (World.Tags.Has(Entity, "Status"))          // hierarchical: true for either tag
{
    // ...
}

if (World.Tags.HasExact(Entity, Burning))      // exact: only Status.Burning
{
    // ...
}

World.Tags.Remove(Entity, Burning);
World.Tags.Clear(Entity);
```

| Member | Behavior |
| --- | --- |
| `GameplayTag.Request(Name)` | Interns a dotted name and returns the tag. |
| `GameplayTag.None` | The invalid tag. `IsValid` is false. |
| `Tag.Name` | The dotted name. |
| `Tag.Parent` | The immediate parent, or `None` at the root. |
| `Tag.Matches(Other)` | Hierarchical. |
| `Tag.MatchesExact(Other)` | Exact. |
| `World.Tags.Add / Remove / Has / HasExact / Clear` | Per-entity operations. Each takes a `GameplayTag` or a string. |
| `World.Tags.Get(Entity)` | The entity's current tags. |

Notes that matter in practice:

- `Add` **creates the tag component on first use**, so you do not have to add it
  in the editor to tag from script. It is idempotent.
- `Remove` is an exact match. Removing `Status` does not remove
  `Status.Burning`.
- `Get` returns at most `GameplayTags.MaxTags` (64) tags in one call.
- Tag operations are **game thread only**.
- Cache the `GameplayTag` rather than passing strings in hot code. The string
  overloads intern on every call.

## As message channels

The gameplay message bus uses tags as channel names, which is where the hierarchy
pays off: subscribe to `Combat` and you receive messages broadcast on
`Combat.Damage` and `Combat.Heal`.

```csharp
World.Messages.Subscribe<DamageMessage>("Combat.Damage", Msg => { /* ... */ });
World.Messages.Broadcast("Combat.Damage", new DamageMessage { Amount = 10 });
```

Subscriptions take a `GameplayTagMatch`, defaulting to `Partial` (hierarchical).
Use `Exact` when you want only the precise channel. See
[Events](/manual/scripting/events/) for the full bus API, including
entity-scoped subscriptions and `SendUp` / `SendDown` along the entity
hierarchy.

## As filters

AI perception uses tags for affiliation: a stimuli source advertises
`AffiliationTags`, and a perceiver lists `DetectableTags` it cares about. The
perceiver senses the source when any tag matches. An empty filter senses
everyone. See [AI Perception](/manual/scripting/perception/).

The same pattern works for your own systems: put an `FGameplayTagContainer` on a
component and use `HasAny` as the filter.

## How it works

`FGameplayTagRegistry` is a process-global table. `RequestTag` interns a name and
its **whole ancestor chain**, returning an integer id; id 0 is the None
sentinel. Each node stores its name and its parent id.

- A hierarchical match walks parent ids from the candidate upward looking for the
  query id, so it costs the depth of the tag, not a string comparison.
- An exact match is an integer comparison.
- The registry is mutex guarded, so requesting a tag is thread safe. The
  per-entity operations built on it are not; those are game thread only.
- Ids are stable for the process lifetime but are **not stable across runs**.
  Serialize tags by name (`FGameplayTag` stores an `FName`), never by id.

## Naming conventions

The hierarchy is only useful if it is consistent. A few conventions that hold up:

- Group by domain first: `Status.`, `Damage.`, `Ability.`, `Team.`, `Combat.`.
- Query at the level you actually branch on. If nothing ever asks about
  `Status.Burning.Severe`, do not create it.
- Prefer adding a level over inventing a parallel root. `Damage.Fire` and
  `Damage.Ice` beat `FireDamage` and `IceDamage`, because the first pair lets you
  query `Damage`.
- Message channels and entity tags share one registry. Keeping them in separate
  roots (for example `Combat.` for channels, `Status.` for entity state) avoids
  accidental overlap.
