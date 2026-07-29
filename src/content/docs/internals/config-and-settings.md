---
title: Configuration and Settings
description: FConfig, developer settings classes, where values persist, and the live-refresh contract.
---

Lumina has two configuration mechanisms sharing one owner (`FConfig`, published
as `GConfig`):

- **Developer settings**, reflection-driven `CDeveloperSettings` classes. This is
  what almost everything uses. A settings class gets a property grid, JSON
  persistence, and a change notification for free.
- **Generic JSON config**, a dotted-key tree over a directory of JSON files. Used
  for input action maps and cooked or launch metadata, where the shape is not a
  fixed C++ class.

Console variables are a third, separate thing; see
[Diagnostics](/internals/diagnostics/).

## Developer settings

Declare a settings class by deriving from `CDeveloperSettings` and pointing it at
a config file:

```cpp
REFLECT(MinimalAPI, ConfigFile = "/Config/MySettings.json",
        DisplayName = "My System", Category = "Engine")
class CMySettings : public CDeveloperSettings
{
    GENERATED_BODY()
public:

    PROPERTY(Editable, Category = "General")
    float Threshold = 1.0f;

    void PostInitSettings() override;   // derive cached state here
};
```

Read one through its class default object:

```cpp
const float T = GetDefault<CMySettings>()->Threshold;
```

That is the whole contract. The values live on the **CDO**, so there is no
instance to own and no singleton to write.

`REFLECT` metadata that matters here:

| Key | Effect |
| --- | --- |
| `ConfigFile` | The VFS path the class persists to. Several classes may share one file; each gets its own section. |
| `DisplayName` | The label in the settings UI. |
| `Category` | Which settings group it appears under: `Project`, `Engine`, or `Editor`. |
| `MinimalAPI` | Exports only what the reflection system needs, keeping the DLL surface small. |

The **section key** within a shared file is the class name with the leading `C`
stripped, so `CEditorSettings` writes a `EditorSettings` section.

### The built-in classes

| Class | File | Shown as |
| --- | --- | --- |
| `CProjectSettings` | `/Config/GameSettings.json` | Project |
| `CGameplayTagsSettings` | `/Config/GameplayTags.json` | Project, Gameplay Tags |
| `CRendererSettings` | `/Config/RendererSettings.json` | Engine, Rendering |
| `CInputSettings` | `/Config/InputSettings.json` | Engine, Input |
| `CAudioSettings` | `/Config/AudioSettings.json` | Engine, Audio |
| `CNetworkSettings` | `/Config/NetworkSettings.json` | Engine, Networking |
| `CEditorSettings` and the editor tool settings | `/Editor/Config/EditorPreferences.json` | Editor, several sections |

Note that the editor preferences file holds many classes: general, colors, world
tool, prefab tool, scripting, content browser, RmlUi editor. That is the shared
file with per-class sections in action.

### Lifecycle

```cpp
GConfig->DiscoverAndLoadSettings();   // find every CDeveloperSettings subclass, load its section
GConfig->ReloadSettings(Class);       // force a re-read of one class
GConfig->SaveSettings(Class);         // re-serialize the CDO, preserving other sections
```

- `DiscoverAndLoadSettings` is **idempotent**: classes already initialized are
  skipped, so it is safe to call again after a module registers more settings
  classes. The editor calls it during init, after its own classes have
  registered.
- Loading calls `PostInitSettings()` on the class. Override it to derive cached
  state rather than recomputing on every read.
- Saving preserves the other sections in a shared file, so two classes writing to
  `EditorPreferences.json` do not clobber each other.
- `GetSettingsDefault(Class)` returns a **pristine code-default snapshot**, taken
  before any file load. That is the baseline the property grid's reset-to-default
  uses, so resetting restores the value the code declared rather than the value
  that happened to be on disk.
- `ForEachSettingsClass` iterates discovered classes in load order, which is what
  the editor's settings panel walks.

`ReloadSettings` exists for a specific case: **class-reference properties that
could not resolve at first load**. A `TSubclassOf` naming a class from a module
or script assembly that had not loaded yet resolves to null. When a C# script
reload mints, for example, a `CGameInstance` subclass that
`Project.GameInstanceClass` names, reloading that settings class re-resolves the
reference.

### The change contract

Saving broadcasts:

```cpp
FCoreDelegates::OnSettingsSaved.Broadcast(CClass* SavedClass);
```

Subsystems subscribe and react. Two do so in `FEngine::Init`:

```cpp
(void)FCoreDelegates::OnSettingsSaved.AddLambda([](CClass* Class)
{
    if (Class == CInputSettings::StaticClass())
    {
        FInputActionMap::Get().RebuildFromSettings();
    }
    else if (Class == CAudioSettings::StaticClass())
    {
        Audio::ApplySettings();
    }
});
```

**If your settings class needs to take effect without a restart, subscribe here.**
Nothing polls the CDO for changes. Open editors also use this to live-refresh
instead of waiting for a reopen.

See [Delegates and Events](/internals/delegates-and-events/) for the delegate
semantics, including the fact that this one is a standing subscription rather
than broadcast-and-clear.

## Generic JSON config

For data whose shape is not a C++ class:

```cpp
GConfig->LoadConfigDirectory("/Config");                    // every .json under the dir
int32 Value = GConfig->Get<int32>("Section.Key", Default);  // dotted key, default on miss
bool  Ok    = GConfig->Set("Section.Key", NewValue);        // updates memory and writes the owning file
```

Mechanics:

- Loading a directory merges each file's top-level keys into one root tree, and
  **records which file each key came from**, so `Set` can write back to the right
  file.
- `Set` returns false when no owning file can be inferred for the key. Ownership
  resolves as: an explicit registration first, then an existing path-to-file
  entry, otherwise nothing.
- Raw `nlohmann::json` access is available for advanced cases. The input action
  map loader uses it, because an action map is a nested structure rather than a
  flat set of scalars.
- Files are cached after the first load; an absent or unparseable file yields an
  empty object rather than an error.

## Where files live

| Path | Contents |
| --- | --- |
| `/Config/*.json` | Project and engine settings. |
| `/Editor/Config/EditorPreferences.json` | Editor preferences, many sections. |
| `<Project>.lproject` | The project descriptor: plugin enable and disable overrides, cook roots, the startup map. Read directly, not through `FConfig`. |

The `.lproject` file is read early and **before any module loads**, so plugin
overrides apply before the plugin manager acts on them. See
[Modules and Plugins](/internals/modules-and-plugins/).

## Ordering

Configuration participates in engine startup at three points:

1. **Before subsystems**: `FConsoleRegistry::LoadFromConfig()` applies console
   variable values, so a subsystem reading a variable at construction sees the
   configured value.
2. **Before module loading**: the project's `.lproject` plugin overrides are
   preloaded.
3. **During editor init**: `DiscoverAndLoadSettings()` runs after the editor's
   own settings classes have registered.

A settings class registered by a plugin loading later than editor init is
discovered by the **next** `DiscoverAndLoadSettings` call. Since the function is
idempotent, calling it again from your module's `StartupModule` is the correct
fix rather than a workaround.

## Adding a settings class

1. Derive from `CDeveloperSettings`, add `GENERATED_BODY()`, and set
   `ConfigFile`, `DisplayName`, and `Category` in `REFLECT`.
2. Mark the properties `Editable` and give them a `Category`.
3. Read through `GetDefault<T>()`.
4. If the value must apply live, subscribe to `OnSettingsSaved` and compare
   against `T::StaticClass()`.
5. Override `PostInitSettings()` if you cache anything derived from the values.

## Common failure modes

| Symptom | Cause |
| --- | --- |
| A settings change does nothing until restart | Nothing subscribed to `OnSettingsSaved` for that class. |
| Two classes overwrite each other's file | Section keys collide. The key is the class name minus the leading `C`. |
| Reset to default restores a disk value, not the code value | Reading the CDO instead of `GetSettingsDefault`. The pristine snapshot is captured before any load. |
| A `TSubclassOf` setting is null | The named class was not loaded when the settings were first read. Call `ReloadSettings` for that class once it is. |
| A plugin's settings never appear in the editor | The plugin loaded after `DiscoverAndLoadSettings`. Call it again from `StartupModule`. |
| `Set` returns false | No owning file could be inferred for that dotted key. |
| A console variable ignores its configured value | It was read before `FConsoleRegistry::LoadFromConfig()`. |
