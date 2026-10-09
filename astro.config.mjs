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
      description: 'A modern C++ game engine with a data-driven editor, C# scripting, and a bindless, GPU-driven renderer.',
      favicon: '/favicon.png',
      head: [
        {
          tag: 'link',
          attrs: {
            rel: 'alternate',
            type: 'application/rss+xml',
            title: 'Lumina Devlog',
            href: '/blog/rss.xml',
          },
        },
      ],
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
        { label: 'Devlog', link: '/blog/' },
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: 'getting-started/introduction' },
            { label: 'Installation', slug: 'getting-started/installation' },
            { label: 'Your First Project', slug: 'getting-started/first-project' },
          ],
        },
        {
          label: 'Engine',
          items: [
            { label: 'Manual (Coming Soon)', slug: 'manual/overview' },
            { label: 'Building & Modules', slug: 'internals/build-system' },
            { label: 'Reflection', slug: 'manual/reflection' },
            { label: 'Logging', slug: 'manual/logging' },
          ],
        },
        {
          label: 'Engine Internals',
          items: [
            { label: 'Overview', slug: 'internals' },
            { label: 'Meshlet Pipeline', slug: 'internals/meshlet-pipeline' },
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
            { label: 'Animation Task System', slug: 'internals/animation-task-system' },
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
