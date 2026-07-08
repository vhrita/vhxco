// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import glsl from 'vite-plugin-glsl';

// Dev HMR config — activated when DEV_HMR_HOST env var is set.
// Only affects `astro dev` (Vite dev server). Has zero impact on `astro build`.
// Usage: DEV_HMR_HOST=vhxco-website-dev.138-2-243-181.sslip.io pnpm dev --host --port 4326
const devHmrHost = process.env.DEV_HMR_HOST;

/** @type {import('vite').ServerOptions | undefined} */
const viteServer = devHmrHost
  ? {
      host: true,
      port: 4326,
      strictPort: true,
      allowedHosts: [devHmrHost, '.sslip.io'],
      hmr: {
        host: devHmrHost,
        protocol: 'wss',
        clientPort: 443,
      },
    }
  : undefined;

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
    ...(viteServer ? { server: viteServer } : {}),
  },
});
