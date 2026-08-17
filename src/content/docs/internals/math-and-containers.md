---
title: Math and Containers
description: The in-house math library, SIMD conventions, and which container types to reach for.
---

Lumina uses its **own math library** and **EASTL** containers. There is no GLM
and no `std::vector` in engine code. Both choices are load bearing: the math
types have a guaranteed layout the renderer and the C# interop mirror, and the
containers route through the engine allocator.

## Math

`Core/Math/Math.h` is the hub. It pulls in the vector, quaternion, and matrix
library and adds the scalar utilities that do not belong to one type.

### Types

| Alias | Underlying |
| --- | --- |
| `FVector2`, `FVector3`, `FVector4` | `TVec<float, N>` |
| `FIntVector2/3/4`, `FUIntVector2/3/4` | `TVec<int32, N>`, `TVec<uint32, N>` |
| `FQuat` | `TQuat<float>` |
| `FMatrix2`, `FMatrix3`, `FMatrix4` | `TMat<float, R, C>`. `FMatrix` aliases `FMatrix4`. |
| `FTransform` / `VTransform` | Location, rotation, scale. See below. |
| `FAABB`, `FFrustum`, `FColor` | Bounds, culling volume, color. |

`TVec<T, N>` is a plain struct over `T Data[N]`, with 2, 3, and 4 component
specializations exposing anonymous-union aliases: `x/y/z/w`, `r/g/b/a`, and
`s/t/p/q`. There is no padding and no vtable, so a `FVector3` is exactly three
floats and can be memcpy'd into a GPU buffer or a blittable C# struct.

Construction is per component with mixed arithmetic types accepted (the cast
removes brace narrowing), plus an explicit scalar-broadcast constructor:

```cpp
FVector3 A(1.0f, 2, 3u);   // mixed args are fine
FVector3 B(1.0f);          // explicit: broadcasts to all components
```

### Conventions

- **Left handed.** At identity rotation, forward is `+Z`, right is `+X`, up is
  `+Y`.
- **Column-major matrices**, matching the Slang shader target configuration.
- View space is `+Z` forward.
- Depth is **reverse-Z** everywhere in the renderer: clear to 0, compare greater.
  `Perspective` builds a matrix consistent with that, and also bakes the Vulkan Y
  flip, which is why the scene renderer sets a clockwise front face.

Getting a convention wrong is the single most common source of "geometry is
inside out" and "everything z-fights" bugs. See
[Vulkan Backend](/internals/vulkan-backend/).

### Operations

Free functions in `Lumina::Math`, found in `VectorMath.h`, `MatrixMath.h`, and
`Quat.h`:

- **Vector**: `Dot`, `Cross`, `Length`, `LengthSquared`, `Distance`,
  `DistanceSquared`, `Normalize`, plus a vector overload of `Lerp`.
- **Matrix**: `Transpose`, `Inverse` (with hand-written 3x3 and 4x4 float
  specializations), `Perspective`, `PerspectiveFov`, `Ortho`, `LookAt`, and
  `Decompose` into translation, rotation, scale, skew, and perspective.
- **Quaternion**: the usual algebra plus `QuatLookAt(Direction, Up)`.
- **Scalar** (`Math.h`, `Scalar.h`): `NextPowerOfTwo`, `AlignUp`, `Lerp`,
  `IsNearlyEqual` and `IsNearlyZero` (defaulting to `LE_KINDA_SMALL_NUMBER`),
  `CountTrailingZeros64`, `IsEven`, and friends. Most are `constexpr`.

Prefer `LengthSquared` and `DistanceSquared` in comparisons. `Length` calls
`sqrt`.

### SIMD

`Core/Math/SIMD` is a thin, explicit wrapper over x86 intrinsics in the
`Lumina::SIMD` namespace. It is not automatic vectorization of the `TVec` types;
you opt in by using the `V*` register types.

| Type | Register |
| --- | --- |
| `VFloat4` | `__m128`, 4 lanes, SSE and SSE4.1 |
| `VFloat8` | `__m256`, 8 lanes, AVX |
| `VQuat1`, `VQuat4` | One quaternion, and four quaternions in SoA form |

The baseline is **`/arch:AVX`**, not AVX2. AVX2 crashes on older CPUs still in
the target range, so:

- `VFloat8` and all float SSE/AVX operations are always available.
- 256-bit **integer** ops and FMA are AVX2 and are guarded, to avoid an illegal
  instruction on an AVX-only machine. `LUMINA_SIMD_HAS_FMA` is the feature test
  (set from `__AVX2__` or `__FMA__`).

The baseline must stay in sync across the `/arch` flag, the `__AVX__` define, and
the `VectorExtensions` setting in `Engine/Build/Lumina.BuildRules.cs`, which
applies to engine modules and game projects alike. Changing one without the
others produces code that runs until it does not.

`SIMD::kAlignment` is 32, the natural alignment for the widest register. Buffers
fed to `LoadAligned` and `StoreAligned` must meet it; `Load` and `Store` are the
unaligned forms.

Comparisons return a per-lane mask, combined with `Select`, `MoveMask`, `Any`,
and `All`. `Reciprocal` and `ReciprocalSqrt` are accurate; the `*Fast` variants
use the roughly 12-bit hardware approximations for when precision does not
matter.

### VTransform

`Core/Math/Transform.h` defines a SIMD-backed transform, `alignas(16)`:

```cpp
struct alignas(16) VTransform
{
    SIMD::VFloat4 Location;   // x, y, z, 0
    SIMD::VFloat4 Rotation;   // x, y, z, w
    SIMD::VFloat4 Scale;      // x, y, z, 1
};
```

Two details in that layout are deliberate:

- `Location.w` is 0 and `Scale.w` is **1**. The scale pad lane is 1 so
  `Inverse`'s reciprocal never divides by zero, and so composition's pad lanes
  stay consistent (`1 * 1 = 1`).
- Everything (compose, inverse, rotate-about-axis, matrix build) stays in
  registers. `GetForward`, `GetRight`, and `GetUp` are quaternion rotations of
  the basis vectors, not matrix column reads.

`VTransform` is reflected directly, with no parser-only stub. It carries
`REFLECT(ReflectedName = "FTransform", ...)` so it registers under the name every
caller and saved package already uses, and each `SIMD::VFloat4` member carries
`PROPERTY(..., ReflectAs = "FVector3")` or `ReflectAs = "FQuat"` so the editor and
tagged serialization see the scalar TRS at the real member offsets. See
[Reflection](/manual/reflection/#reflecting-a-type-under-another-name).

### Hashing

`Core/Math/Hash/Hash.h`:

- **XXHash** is the engine default: `Hash::GetHash32` and `Hash::GetHash64` over
  raw bytes, strings, floats, and blobs.
- **FNV1a** is available as a `constexpr` hash. Use it **only for code-only
  features** such as custom RTTI type ids, never for anything persisted, since it
  is not the engine's serialization hash.
- `HashCombine(Seed, Value)` folds hashes.

## Containers

`Runtime/Containers` aliases EASTL. Using these rather than the standard library
matters because `EASTLAllocatorType` routes to the engine allocator, so
allocations are tracked and go through rpmalloc. See [Memory](/internals/memory/).

### Sequence and map types

| Alias | EASTL type | Use for |
| --- | --- | --- |
| `TVector<T>` | `vector` | The default dynamic array. |
| `TFixedVector<T, N>` | `fixed_vector` | Inline storage for `N` elements, overflowing to the heap by default. Avoids an allocation in the common case. |
| `TArray<T, N>` | `array` | Fixed size, no allocation. |
| `TSpan<T>` | `span` | Non-owning view. The default parameter type for "a range of things". |
| `THashMap<K, V>` | `hash_map` | The default map. |
| `TFixedHashMap<K, V, N>` | `fixed_hash_map` | Inline node and bucket storage. |
| `TUnorderedMap<K, V>` | `unordered_map` | When you need the standard-library semantics. |
| `TOrderedMap<K, V>` | `map` | Ordered iteration. |
| `TVectorMap<K, V>` | `vector_map` | Sorted vector. Faster for small maps and iteration-heavy use. |
| `TList<T>` | `list` | Node list. Rarely the right answer. |
| `TPair<K, V>` | `pair` | |
| `TBitSet<N>`, `FBitVector` | `bitset`, `bitvector` | Fixed and dynamic bit sets. |
| `TTupleVector<Ts...>`, `TFixedTupleVector<N, Ts...>` | `tuple_vector` | Structure-of-arrays storage. |

Note that `TVector` is the **dynamic array**, not a math vector. Math vectors are
`FVector3` and friends. The two are easy to confuse when skimming.

### Engine-specific containers

| Type | Purpose |
| --- | --- |
| `TMultiVector<Ts...>` | Parallel arrays kept in lockstep, for structure-of-arrays layouts. |
| `TSparseArray<T>` | Stable-index array with non-contiguous storage. Indices survive removals. |
| `TSegmentArray<T>` and `THandle<T>` | Segmented storage addressed by opaque handle. `THandle<T>` is the handle type the [RHI](/internals/rhi/) uses for all its resources. |
| `TFunction`, `TMoveOnlyFunction` | Callables. The move-only form is what render commands and task bodies capture into. |
| `TAny` | Type-erased value. |
| `TTuple` | Tuple. |

### Strings

| Alias | Storage |
| --- | --- |
| `FString` | Heap-allocated `basic_string<char>`. |
| `FStringView` | Non-owning view. Prefer it for parameters. |
| `FFixedString` | `fixed_string<char, 255>`, inline for short strings. |
| `TFixedString<N>` | Inline for `N` characters. |
| `FWString`, `FFixedWString` | Wide equivalents. |

Prefer `Lumina::StringCast<>` for narrow and wide conversion. It uses an inline
buffer (no heap for short strings) and the platform conversion, and the temporary
lives to the end of the full expression.

### FName

`FName` is the interned, case-insensitive name type used for every identifier the
engine compares often: object names, class names, asset names, shader keys.

```cpp
FName A("Entity");
FName B("Entity", 3);      // "Entity_3": explicit base plus external number
```

Mechanics worth knowing:

- The id is a **case-folded hash of the base string, ignoring any numeric
  suffix**, so `"A"` and `"a"` share it, and `Entity` and `Entity_3` share a base
  id.
- `HasNumber()` and `GetNumber()` expose the suffix. Internally, "no number" is 0
  and external numbers are stored as `+1` of that, so `GetNumber()` returns 0
  when there is no suffix.
- `GetBaseName()` strips the suffix.
- `NAME_None` is the empty name; `IsNone()` tests it.
- Comparison is an integer compare. `FName` converts to `uint64` implicitly.
- **The name table is built on demand and its entries are immortal**, so
  constructing an `FName` during static initialization is safe.

Two traps:

- `c_str()` on a **numbered** name renders into a short-lived buffer. Do not hold
  the pointer.
- `None`'s serialized wire form is the **empty string**. Its `c_str()` renders
  `"NAME_None"`, which is a display string and must never round-trip back into a
  real name. Always serialize through the archive's `FName` operator. See
  [Serialization](/internals/serialization/).

## Reflected math types

The math types are reflected, so they appear in the property grid and cross the
C# boundary. That means their **layout is part of the ABI**: adding a member to
`FVector3` breaks every mirrored C# struct, every GPU buffer that assumes tight
packing, and every serialized asset.

They reflect through their aliases: `REFLECT()` sits on
`using FVector3 = TVec<float, 3>;`, and the Reflector walks the real `TVec`
members rather than a hand-written description of them, so the reflected shape
cannot drift from the type. `NoCSharp` and `CSharpValueMirror` keep the C# side
hand-written, which is what `CSharpLayoutChecks.cpp` guards.

If you change a mirrored type, add it to the layout registry checks described in
[Scripting Host](/internals/scripting-host/), which validate size and field
offsets on both sides at startup.

## Common failure modes

| Symptom | Cause |
| --- | --- |
| Geometry inside out, or culled from the wrong side | Handedness or front-face assumption. Left handed, `+Z` forward, clockwise front face after the projection's Y flip. |
| Z-fighting in a new pass | Standard depth compare instead of reverse-Z. |
| Illegal instruction on an older CPU | An AVX2 or FMA intrinsic used without the `LUMINA_SIMD_HAS_FMA` guard. |
| Crash in a `LoadAligned` | Buffer not aligned to `SIMD::kAlignment` (32). |
| Reflection parse errors in a header using SIMD | An intrinsic type reached a `PROPERTY`. Reflect the member as its scalar shape with `ReflectAs`. |
| Allocation not showing in memory tracking | A raw `std::vector` or `std::string` instead of the engine aliases. |
| Dangling string from a numbered `FName` | `c_str()` on a numbered name returns a short-lived buffer. |
| Hash mismatch across runs | FNV1a used for something persisted. It is for code-only ids. |
