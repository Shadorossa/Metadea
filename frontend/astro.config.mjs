// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  integrations: [react()],

  i18n: {
    defaultLocale: 'es',
    locales: ['es', 'en', 'de', 'ja', 'it', 'fr', 'ca', 'ru'],
    routing: {
      prefixDefaultLocale: false,
    },
  },

  vite: {
    optimizeDeps: {
      exclude: [
        '@tauri-apps/api',
        '@tauri-apps/api/core',
        '@tauri-apps/api/path',
        '@tauri-apps/plugin-updater',
        '@tauri-apps/plugin-process'
      ],
    },
    server: {
      watch: {
        ignored: ['**/src-tauri/target/**'],
      },
    },
  },
});
