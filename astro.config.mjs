import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightThemeRapide from 'starlight-theme-rapide';

export default defineConfig({
  site: 'https://luminagameengine.com',
  integrations: [
    starlight({
      title: 'Lumina Engine',
      description: 'An open-source C++ game engine.',
      favicon: '/favicon.png',
      pagefind: false,
      disable404Route: true,
      plugins: [starlightThemeRapide()],
      logo: {
        light: './src/assets/logo-light.png',
        dark: './src/assets/logo-dark.png',
        replacesTitle: false,
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/MrDrElliot/LuminaEngine' },
      ],
      sidebar: [
        { label: 'Documentation Coming Soon', slug: 'documentation' },
      ],
    }),
  ],
});
