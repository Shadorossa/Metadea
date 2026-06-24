// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  integrations: [react()],

  i18n: {
    defaultLocale: 'es',
    locales: ['es', 'en'],
    routing: {
      prefixDefaultLocale: false,
    },
  },

  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      exclude: ['@tauri-apps/api', '@tauri-apps/api/core', '@tauri-apps/api/path'],
    },
    server: {
      watch: {
        ignored: ['**/src-tauri/target/**'],
      },
    },
  },
});
