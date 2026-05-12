// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import glsl from 'vite-plugin-glsl';

// https://astro.build/config
export default defineConfig({
  site: 'https://vhxco.com',

  i18n: {
    locales: ['pt', 'en'],
    defaultLocale: 'pt',
    routing: {
      prefixDefaultLocale: false,
    },
  },

  integrations: [
    react(),
    sitemap({
      i18n: {
        defaultLocale: 'pt',
        locales: {
          pt: 'pt-BR',
          en: 'en',
        },
      },
    }),
  ],

  vite: {
    // glsl() typed as any: vite-plugin-glsl uses Vite 7 types internally
    // but is compatible at runtime with Vite 6 (Astro's bundled vite).
    plugins: [tailwindcss(), /** @type {any} */ (glsl())],
  },
});
