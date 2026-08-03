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
            { label: 'Building & Modules', slug: 'internals/build-system' },
            { label: 'Reflection', slug: 'manual/reflection' },
            { label: 'Logging', slug: 'manual/logging' },
          ],
        },
        {
          label: 'World & ECS',
          items: [
            { label: 'Entities & Components', slug: 'manual/ecs' },
            { label: 'Worlds & Coordinates', slug: 'manual/worlds-and-coordinates' },
            { label: 'Prefabs', slug: 'manual/prefabs' },
            { label: 'Terrain', slug: 'manual/terrain' },
          ],
        },
        {
          label: 'Rendering',
          items: [
            { label: 'Overview', slug: 'manual/rendering' },
            { label: 'Cameras', slug: 'manual/cameras' },
            { label: 'Water', slug: 'manual/water' },
            { label: 'Particles', slug: 'manual/particles' },
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
            { label: 'Queries', slug: 'manual/physics/queries' },
            { label: 'Projectiles', slug: 'manual/physics/projectiles' },
            { label: 'Character Controller', slug: 'manual/physics/characters' },
            { label: 'Materials & Destruction', slug: 'manual/physics/materials-destruction' },
          ],
        },
        {
          label: 'Gameplay',
          items: [
            { label: 'Gameplay Tags', slug: 'manual/gameplay-tags' },
            { label: 'Animation', slug: 'manual/animation' },
            { label: 'Navigation', slug: 'manual/navigation' },
            { label: 'Networking', slug: 'manual/networking' },
          ],
        },
        {
          label: 'Audio',
          items: [
            { label: 'Overview', slug: 'manual/audio' },
            { label: 'Mixing & Buses', slug: 'manual/audio/mixing' },
            { label: 'Audio Settings', slug: 'manual/audio/settings' },
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
            { label: 'Audio', slug: 'manual/scripting/audio' },
            { label: 'Animation', slug: 'manual/scripting/animation' },
            { label: 'Blackboards', slug: 'manual/scripting/blackboard' },
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
          label: 'Engine Internals',
          items: [
            { label: 'Overview', slug: 'internals' },
            { label: 'Application Lifecycle', slug: 'internals/application-lifecycle' },
            { label: 'Modules & Plugins', slug: 'internals/modules-and-plugins' },
            { label: 'Threading Model', slug: 'internals/threading-model' },
            { label: 'Task System', slug: 'internals/task-system' },
            { label: 'Memory', slug: 'internals/memory' },
            { label: 'Math & Containers', slug: 'internals/math-and-containers' },
            { label: 'Delegates & Events', slug: 'internals/delegates-and-events' },
            { label: 'Config & Settings', slug: 'internals/config-and-settings' },
            { label: 'The Object System', slug: 'internals/cobject' },
            { label: 'Reflection & Codegen', slug: 'internals/reflection-codegen' },
            { label: 'Serialization', slug: 'internals/serialization' },
            { label: 'Assets', slug: 'internals/assets' },
            { label: 'ECS Internals', slug: 'internals/ecs-internals' },
            { label: 'Physics Internals', slug: 'internals/physics-internals' },
            { label: 'Animation Internals', slug: 'internals/animation-internals' },
            { label: 'Networking Internals', slug: 'internals/networking-internals' },
            { label: 'Audio Internals', slug: 'internals/audio-internals' },
            { label: 'RHI', slug: 'internals/rhi' },
            { label: 'Vulkan Backend', slug: 'internals/vulkan-backend' },
            { label: 'Frame Pipeline', slug: 'internals/frame-pipeline' },
            { label: 'Render Passes', slug: 'internals/render-passes' },
            { label: 'Shaders', slug: 'internals/shaders' },
            { label: 'Scripting Host', slug: 'internals/scripting-host' },
            { label: 'Editor Architecture', slug: 'internals/editor-architecture' },
            { label: 'Platform Layer', slug: 'internals/platform' },
            { label: 'Diagnostics', slug: 'internals/diagnostics' },
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
