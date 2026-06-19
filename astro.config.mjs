// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightThemeRapide from 'starlight-theme-rapide';
import remarkGfm from 'remark-gfm';

// https://astro.build/config
export default defineConfig({
  site: 'https://luminagameengine.com',
  // gfm is on by default for .md, but the MDX pipeline only inherits
  // remarkPlugins, so add gfm here to get tables/strikethrough in .mdx too.
  markdown: {
    remarkPlugins: [remarkGfm],
  },
  integrations: [
    starlight({
      title: 'Lumina Engine',
      description: 'A modern C++ game engine with a data-driven editor, C# scripting, and a Vulkan renderer.',
      favicon: '/favicon.png',
      plugins: [starlightThemeRapide()],
      logo: {
        light: './src/assets/logo-light.png',
        dark: './src/assets/logo-dark.png',
        replacesTitle: false,
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/MrDrElliot/LuminaEngine' },
      ],
      editLink: {
        baseUrl: 'https://github.com/MrDrElliot/LuminaEngine-site/edit/main/',
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: 'getting-started/introduction' },
            { label: 'Installation', slug: 'getting-started/installation' },
            { label: 'Your First Project', slug: 'getting-started/first-project' },
            { label: 'First-Person Tutorial', slug: 'getting-started/first-person-tutorial' },
          ],
        },
        {
          label: 'Engine',
          items: [
            { label: 'Overview', slug: 'manual/overview' },
            { label: 'Reflection', slug: 'manual/reflection' },
          ],
        },
        {
          label: 'World & ECS',
          items: [
            { label: 'Entities & Components', slug: 'manual/ecs' },
            { label: 'Worlds & Coordinates', slug: 'manual/worlds-and-coordinates' },
            { label: 'Prefabs', slug: 'manual/prefabs' },
          ],
        },
        {
          label: 'Rendering',
          items: [
            { label: 'Overview', slug: 'manual/rendering' },
            { label: 'Cameras', slug: 'manual/cameras' },
            { label: 'Water', slug: 'manual/water' },
            {
              label: 'Materials',
              items: [
                { label: 'Overview', slug: 'manual/materials' },
                { label: 'The Material Graph', slug: 'manual/materials/graph' },
                { label: 'Material Instances', slug: 'manual/materials/instances' },
                { label: 'Best Practices', slug: 'manual/materials/best-practices' },
              ],
            },
          ],
        },
        {
          label: 'Physics',
          items: [
            { label: 'Overview', slug: 'manual/physics' },
            { label: 'Rigid Bodies', slug: 'manual/physics/rigid-bodies' },
            { label: 'Colliders', slug: 'manual/physics/colliders' },
            { label: 'Collisions & Triggers', slug: 'manual/physics/collisions' },
            { label: 'Character Controller', slug: 'manual/physics/characters' },
            { label: 'Materials & Destruction', slug: 'manual/physics/materials-destruction' },
          ],
        },
        {
          label: 'Audio',
          items: [
            { label: 'Overview', slug: 'manual/audio' },
          ],
        },
        {
          label: 'Scripting',
          items: [
            { label: 'Overview', slug: 'manual/scripting' },
            { label: 'Entity Systems', slug: 'manual/scripting/entity-systems' },
            { label: 'Entities & Components', slug: 'manual/scripting/entities-components' },
            { label: 'The World API', slug: 'manual/scripting/world' },
            { label: 'Globals & Helpers', slug: 'manual/scripting/globals' },
            { label: 'World Systems', slug: 'manual/scripting/world-systems' },
            { label: 'Parallel Work', slug: 'manual/scripting/tasks' },
            { label: 'Timers', slug: 'manual/scripting/timers' },
            { label: 'Physics & Collisions', slug: 'manual/scripting/physics' },
            { label: 'Audio', slug: 'manual/scripting/audio' },
            { label: 'Animation', slug: 'manual/scripting/animation' },
            { label: 'Input', slug: 'manual/scripting/input' },
            { label: 'User Interface', slug: 'manual/scripting/ui' },
            { label: 'Low-Level Rendering (RHI)', slug: 'manual/scripting/rhi' },
            { label: 'Events', slug: 'manual/scripting/events' },
            { label: 'AI Perception', slug: 'manual/scripting/perception' },
            { label: 'Networking', slug: 'manual/scripting/networking' },
            { label: 'Reference', slug: 'manual/scripting/reference' },
          ],
        },
        {
          label: 'Editor',
          items: [
            { label: 'Overview', slug: 'manual/editor' },
            { label: 'Viewport', slug: 'manual/editor/viewport' },
            { label: 'Panels', slug: 'manual/editor/panels' },
            { label: 'Content Browser', slug: 'manual/editor/content-browser' },
            { label: 'Asset Editors', slug: 'manual/editor/asset-editors' },
            { label: 'Tools & Profilers', slug: 'manual/editor/tools' },
          ],
        },
        {
          label: 'Asset Pipeline',
          items: [
            { label: 'Overview', slug: 'manual/assets' },
            { label: 'Importing', slug: 'manual/assets/importing' },
            { label: 'Textures', slug: 'manual/assets/textures' },
            { label: 'Referencing Assets', slug: 'manual/assets/references' },
            { label: 'Cooking & Packaging', slug: 'manual/assets/packaging' },
          ],
        },
        {
          label: 'Contributing',
          items: [{ autogenerate: { directory: 'contributing' } }],
        },
      ],
    }),
  ],
});
