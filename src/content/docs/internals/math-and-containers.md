---
title: Math and Containers
description: The in-house math library, SIMD conventions, and which container types to reach for.
---

Lumina uses its **own math library** and its **own containers**. There is no GLM
and no `std::vector` in engine code, and as of August 2026 no EASTL either. Both
choices are load bearing: the math types have a guaranteed layout the renderer
and the C# interop mirror, and the containers route through the engine allocator.

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
- **Scalar** (`Math.h`, `Scalar.h`): `Max`, `Min`, `Clamp`, `Abs`, `Sign`,
  `NextPowerOfTwo`, `AlignUp`, `Lerp`, `IsNearlyEqual` and `IsNearlyZero`
  (defaulting to `LE_KINDA_SMALL_NUMBER`), `CountTrailingZeros64`, `IsEven`, and
  friends. Most are `constexpr`.

Prefer `LengthSquared` and `DistanceSquared` in comparisons. `Length` calls
`sqrt`.

`Math::Max` and `Math::Min` are the engine's, not the standard library's. They
take exactly two arguments of the same arithmetic type and return by value, so
there is no dangling reference to a temporary and no initializer-list form.

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
- `HashCombine(Seed, Value)` folds hashes. It funnels through `GetTypeHash`, so a
  type without one is a compile error rather than a silent fallback.

## Containers

`Runtime/Source/Containers` is written in house. Everything lives in
`Lumina::Containers` with a short alias hoisted into `Lumina`, and every type
allocates through the engine allocator, so allocations are tracked and go through
rpmalloc. See [Memory](/internals/memory/).

**There is no umbrella header.** One header per type, included by name:
`Containers/Vector.h`, `Containers/HashTable.h`, `Containers/String.h`, and so
on. A few of these are in the precompiled header already.

### Allocators

Containers are parameterized on a stateless allocator rather than a standard
allocator object:

| Allocator | Backing |
| --- | --- |
| `FHeapAllocator` | `Memory::Malloc`, the default for everything |
| `FScratchAllocator` | The calling thread's scratch arena. `Deallocate` is a no-op; an enclosing `FMemMark` reclaims the lot |
| `FFrameAllocator` | The calling thread's frame arena, reset at the frame boundary |

The concept requires `Allocate`, `Deallocate`, and **`TryExpand`**, which the
standard allocator model cannot express. `TryExpand` is what lets a growing
`TVector` claim adjacent rpmalloc space instead of allocating and copying.

### Sequence types

| Alias | Notes |
| --- | --- |
| `TVector<T>` | The default dynamic array. One pointer plus two `uint32`, so 16 bytes. Growth doubles. |
| `TInlineVector<T, N>`, `TFixedVector<T, N>` | `N` elements of inline storage, overflowing to the heap. |
| `TScratchVector<T>` | A `TVector` on the scratch arena. |
| `TArray<T, N>` | Fixed size, no allocation. |
| `TSpan<T>` | Non-owning view. The default parameter type for "a range of things". |
| `TRingBuffer<T>` | Fixed-capacity circular buffer. |
| `TDeque<T>`, `TQueue<T>`, `TStack<T>`, `TList<T>` | Segmented deque and the adaptors over it. `TList` is a node list and is rarely the right answer. |
| `TBitSet<N>` | Fixed-size bit set. |
| `TMultiVector<Ts...>` | Parallel arrays kept in lockstep, for structure-of-arrays layouts. |
| `TSparseArray<T>` | Stable-index array with non-contiguous storage. Indices survive removals. |
| `TSegmentMap<T>`, `THandle<T>` | Segmented storage addressed by opaque handle. `THandle<T>` is what the [RHI](/internals/rhi/) uses for all its resources. |

Note that `TVector` is the **dynamic array**, not a math vector. Math vectors are
`FVector3` and friends. The two are easy to confuse when skimming.

### Hash containers

The hash containers are a **SwissTable**, the same design as Abseil's
`flat_hash_map`: one byte of control metadata per slot, sixteen slots compared at
a time with SSE2, triangular probing, and a 7/8 load factor.

| Alias | Layout |
| --- | --- |
| `THashMap<K, V>`, `THashSet<T>` | Flat. Elements live in the table and **move when it grows**. |
| `TNodeHashMap<K, V>`, `TNodeHashSet<T>` | One heap node per element, so references and pointers are stable. |
| `TInlineHashMap<K, V, N>`, `TFixedHashMap<K, V, N>` | Inline storage for `N` elements before the first allocation. |
| `TScratchHashMap<K, V>`, `TScratchHashSet<T>` | On the scratch arena. |

Two things follow from flat storage:

- **Never hold a pointer or reference into a `THashMap` across an insert.** Use
  the node variant when you need stability. This is the most common bug when
  converting older code.
- Lookup is heterogeneous by default, so
  `THashMap<FString, V>::find(FStringView)` works without building a key.

`GetTypeHash` found by ADL is the extension point, and it is **mandatory**: there
is no `std::hash` fallback, and a key type without one is a compile error naming
the type. Declare it next to your type:

```cpp
NODISCARD FORCEINLINE uint64 GetTypeHash(const FMyKey& Key) noexcept
{
    return Containers::CombineHash(GetTypeHash(Key.A), GetTypeHash(Key.B));
}
```

`Containers/HashPrimitives.h` provides the pieces: `MixHash64` (splitmix64's
finalizer), `CombineHash`, `HashBytes`, and `GetTypeHash` for integers, enums,
pointers, and floats. Do not re-mix a hash you already got from `GetTypeHash`: a
heterogeneous lookup only finds a key when both spellings hash identically.

### Vocabulary types

| Alias | Header |
| --- | --- |
| `TPair<K, V>` | `Containers/Pair.h` |
| `TOptional<T>` | `Core/Templates/Optional.h` |
| `TVariant<Ts...>` | `Core/Variant/Variant.h` |
| `TSet<T>`, `TOrderedMap<K, V>`, `TTuple<Ts...>` | Still the standard library. Ordered lookup and tuples did not justify a bespoke red-black tree. |

### Strings

| Alias | Storage |
| --- | --- |
| `FString` | `TBasicString<char>`. **16 bytes**, with a small-string buffer holding 15 characters before the first allocation. |
| `FStringView` | Non-owning view. Prefer it for parameters. |
| `FCStringView` | A view that is **guaranteed null-terminated**, so it can be handed to a C API without a copy. |
| `FFixedString` | 255 characters inline. |
| `TFixedString<N>` | `N` characters inline. |
| `FPathString` | 512 characters inline, sized for a path. |
| `FWString`, `FFixedWString`, `FWStringView` | Wide equivalents. |

Prefer `Lumina::StringCast<>` for narrow and wide conversion. It uses an inline
buffer (no heap for short strings) and the platform conversion, and the temporary
lives to the end of the full expression.

### Callables

`Containers/Function.h` and `Containers/FunctionRef.h`:

| Type | Owns the target | Use for |
| --- | --- | --- |
| `TFunction<Sig>` | yes, copyable | The default. An alias for `TCopyableFunction`. |
| `TCopyableFunction<Sig>` | yes, copyable | The explicit spelling. |
| `TMoveOnlyFunction<Sig>` | yes, move only | Anything capturing a `TUniquePtr` or another move-only value: render commands, task bodies, continuations. |
| `TFunctionRef<Sig>` | **no** | A parameter that is called before the function returns. Two pointers, never allocates, must not outlive its target. |

The owning forms keep a target of up to four pointers inline and only reach the
allocator past that. `operator()` is `const` on both, so a `const TFunction&`
parameter is callable.

`Invoke(Callable, Args...)` in `Containers/Invoke.h` is the engine's INVOKE: it
calls functors, function pointers, pointers to member function, and pointers to
member data through one spelling. It replaced `std::invoke`.

### Algorithms

`Containers/Algorithm.h` is `Lumina::Algo`, and it replaced `<algorithm>` in
engine code:

- **Sorting**: `Sort` (introsort, median of three, heapsort past a depth limit),
  `StableSort` (bottom-up merge through one heap buffer), `NthElement`,
  `StablePartition`, `IsSorted`.
- **Searching**: `Find`, `FindIf`, `FindIfNot`, `Contains`, `Count`, `CountIf`,
  `AllOf`, `AnyOf`, `NoneOf`, `ForEach`, `Equal`.
- **Ordered**: `LowerBound`, `UpperBound`, `BinarySearch`, `MinElement`,
  `MaxElement`.
- **Mutating**: `Remove`, `RemoveIf`, `Unique`, `Reverse`, `Rotate`, `Replace`,
  `ReplaceIf`, `Fill`, `Iota`, `Copy`, `CopyIf`, `Transform`.

`std::max`, `std::min` and `std::clamp` are **not** part of this; those are
`Math::Max`, `Math::Min` and `Math::Clamp`.

### Formatting

`Containers/StringFormat.h` is the public API; `Lumina::Fmt` in
`Containers/Format.h` is the engine behind it. The syntax is the standard's, and
the whole parser lives out of line in one translation unit, so a call site
instantiates almost nothing.

```cpp
FString Text = Format("{} in {:.2f} ms", Name, ElapsedMs);
AppendFormat(Existing, " ({} more)", Count);
FormatTo(Reused, "{:#010x}", Address);

FStringBuilder Builder;
Builder.AppendFormat("{}:{}", Key, Value);
```

| Entry point | Result |
| --- | --- |
| `Format(Fmt, Args...)` | A new `FString`. |
| `FormatAs<TOut>(Fmt, Args...)` | A new string of your choice, so a `FFixedString` result stays off the heap. |
| `AppendFormat(Out, Fmt, Args...)` | Appends to a string or a format buffer. |
| `FormatTo(Out, Fmt, Args...)` | Clears and replaces. |
| `FormatToBuffer(Ptr, Capacity, Fmt, Args...)` | Writes into a caller-owned array, truncating rather than allocating. |
| `TStringBuilder<N>` | Builds text in an `N`-byte inline buffer. |

Format strings are **checked where they are written**. A bad index, an unmatched
brace, mixed automatic and manual indexing, or a specifier the argument type
rejects is a compile error naming the fault, not a bad line at runtime. Use
`Fmt::RuntimeFormat(Text)` to opt a string built at runtime out of the check.

To make your own type formattable, declare a `FormatArgument` beside it and ADL
finds it. There is no `std::formatter` specialization involved, and the specifier
arrives already parsed:

```cpp
void FormatArgument(Fmt::FFormatBuffer& Out, const FMyType& Value, const Fmt::FFormatSpec& Spec);
```

Anything with `data()` and `size()` over `char` already formats as a string, which
covers `FString`, `FStringView`, `std::string`, and the third-party string types.

## FName

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

The **container** layouts are mirrored too. `NativeMarshal.cs` decodes `FString`
and `TVector` byte layouts in place, so changing either one's storage is a
breaking change on the C# side as well.

## Common failure modes

| Symptom | Cause |
| --- | --- |
| Geometry inside out, or culled from the wrong side | Handedness or front-face assumption. Left handed, `+Z` forward, clockwise front face after the projection's Y flip. |
| Z-fighting in a new pass | Standard depth compare instead of reverse-Z. |
| Illegal instruction on an older CPU | An AVX2 or FMA intrinsic used without the `LUMINA_SIMD_HAS_FMA` guard. |
| Crash in a `LoadAligned` | Buffer not aligned to `SIMD::kAlignment` (32). |
| Reflection parse errors in a header using SIMD | An intrinsic type reached a `PROPERTY`. Reflect the member as its scalar shape with `ReflectAs`. |
| Allocation not showing in memory tracking | A raw `std::vector` or `std::string` instead of the engine containers. |
| Dangling reference after inserting into a map | `THashMap` is flat and moves its elements on growth. Use `TNodeHashMap`. |
| Compile error naming a key type with no `GetTypeHash` | There is no `std::hash` fallback. Declare `GetTypeHash` beside the type. |
| Heterogeneous lookup misses a key that is present | Two spellings hashing differently, usually because one path re-mixed the result of `GetTypeHash`. |
| Dangling string from a numbered `FName` | `c_str()` on a numbered name returns a short-lived buffer. |
| Hash mismatch across runs | FNV1a used for something persisted. It is for code-only ids. |
