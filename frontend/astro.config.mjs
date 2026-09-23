// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  // Astro's dev toolbar is useless inside the Tauri window, and its own
  // client deps are discovered late, which re-triggers Vite's dep
  // optimization ("504 Outdated Optimize Dep") on the first page load.
  devToolbar: { enabled: false },
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
      // Pre-bundled up front: otherwise the first page that imports one of
      // these mid-session makes Vite re-optimize, the already-loaded page
      // gets "504 Outdated Optimize Dep" and a second React copy (hooks read
      // a null dispatcher and every island fails to hydrate).
      include: [
        'react',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'react-dom',
        'react-dom/client',
        'lucide-react',
        'motion/react',
        '@dnd-kit/core',
        '@dnd-kit/sortable',
        '@dnd-kit/utilities',
        '@floating-ui/react',
        '@tanstack/react-virtual',
        'dompurify',
      ],
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
      // The "What's new" modal bundles the repo-root CHANGELOG.md
      // (lib/changelog/changelog-source.ts), one level above the Vite root.
      fs: {
        allow: ['.', '../CHANGELOG.md'],
      },
    },
  },
});
