---
title: Water
description: The Water component, a high quality water surface with waves, refraction, reflection, foam, and an underwater view.
---

The **Water** component turns an entity into a high quality water surface: a
plane with animated waves, refraction, reflection, depth based coloring, foam,
and an underwater look when the camera goes below the surface. You drive it
entirely from the Details panel, there is no shader to write.

## Adding water

Select an entity and choose **Add Component, Rendering, Water**. The water is a
plane centered on the entity, sized by **Extent** and scaled by the entity's
transform, so move and rotate the entity to place it. Multiple water bodies in
one world are fine.

The surface is generated procedurally (no mesh asset needed), displaced by
**Gerstner waves**, and rendered after the opaque scene so it can refract what
is behind it and reflect the sky.

## Surface

| Property | What it does |
| --- | --- |
| **Extent** | Plane size in meters (local XZ), before the entity transform scale. |
| **Grid Resolution** | Vertices per side of the wave grid. Higher is smoother but costs more. |
| **Opacity** | Master surface opacity. |

## Waves

Waves are a sum of Gerstner waves fanned around the wind direction, plus an
optional scrolling detail normal for fine ripples.

| Property | What it does |
| --- | --- |
| **Wind Direction** | Direction (XZ) the waves travel along. |
| **Wind Speed** | Scales how fast the waves move. |
| **Wave Amplitude** | Peak height of the dominant wave, in meters. |
| **Choppiness** | Gerstner steepness, from rolling swell (0) to sharp peaks (1). |
| **Wave Scale** | Wavelength multiplier for the wave set. |
| **Wave Count** | Number of summed waves (1 to 8). |
| **Detail Normal Map** | Optional tangent space normal for high frequency ripples. |
| **Detail Strength** | Strength of the detail ripples. |
| **Detail Tiling** | Detail normal tiling across the surface. |
| **Detail Scroll Speed** | How fast the detail ripples scroll with the wind. |

## Color and depth

The water tints the scene behind it and fades from a shallow color to a deep
color with depth, absorbing light along the way (so submerged objects darken and
disappear the deeper they are).

| Property | What it does |
| --- | --- |
| **Shallow Color** | Tint where the bed is close to the surface. |
| **Deep Color** | Tint approached as the water deepens. |
| **Depth Fade Distance** | How far you can see into the water before it reads as deep. Lower it for murkier water. |
| **Absorption Scale** | Overall murkiness. Raise it to hide submerged objects faster, set 0 for perfectly clear water. |

## Refraction

| Property | What it does |
| --- | --- |
| **Refraction Strength** | How much the surface waves bend the view of the scene below. |

## Reflection

Reflections use screen space reflections of the scene with a prefiltered sky
fallback where the rays miss.

| Property | What it does |
| --- | --- |
| **Reflection Strength** | Overall reflection intensity. |
| **Roughness** | Blurs the reflection and softens the sun glint. |
| **Fresnel Power** | Higher values reflect only at grazing angles. |
| **SSR Max Distance** | How far the reflection rays march before falling back to the sky. |
| **SSR Step Count** | Ray march steps. Higher resolves more, costs more. |

## Specular

| Property | What it does |
| --- | --- |
| **Specular Intensity** | Strength of the sun glint and the light that scatters through wave crests. |

The sun glint and the subsurface scattering (wave crests glow when you look
toward the sun through them) both ride this value.

## Foam

Foam has two parts: **shoreline foam** where the water is shallow (near where it
meets geometry) and **crest foam** on tall wave peaks. Foam is off until you
raise **Foam Intensity**.

| Property | What it does |
| --- | --- |
| **Foam Color** | Color of shoreline and crest foam. |
| **Foam Intensity** | Overall foam strength. 0 disables foam. |
| **Shoreline Foam Width** | Water depth over which shoreline foam appears. |
| **Crest Foam Amount** | Wave height fraction that foams (1 foams all crests, 0 only the tallest). |
| **Foam Texture** | Optional foam texture, scrolled with the wind. A procedural pattern is used if none is set. |
| **Foam Tiling** | Foam texture tiling across the surface. |

## Underwater

When the camera drops below the water surface, a fog absorbs the view over
distance and a subtle distortion is applied, so being underwater reads correctly
even when the camera is half submerged at the waterline.

| Property | What it does |
| --- | --- |
| **Underwater Fog Color** | Color the view fades toward with distance underwater. |
| **Underwater Fog Density** | Absorption per meter of submerged view. |
| **Underwater Distortion** | Screen distortion while submerged. |
| **Underwater Tint** | Overall color cast applied to the submerged view. |

## Tips

- For open ocean, keep **Depth Fade Distance** low and **Absorption Scale** high
  so you cannot see far into the water.
- For a clear pool, raise **Depth Fade Distance** and lower **Absorption Scale**.
- Reflections only show on screen geometry; off screen the sky is used, so a
  visible sky (an Environment with a sky) improves reflections.
- The plane is finite. Size it with **Extent** and the entity scale to cover
  your body of water.
