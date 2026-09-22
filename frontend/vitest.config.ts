import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Only the pure modules under test are measured; pulling untested UI
      // into the denominator would make the number meaningless.
      include: [
        'src/components/media/hooks/useListReorder.ts',
        'src/components/media/media-page/media-page-format.tsx',
        'src/components/media/media-page/proposal-session-merge.ts',
        'src/components/media/media-editor/media-editor-helpers.ts',
        'src/components/media/media-editor/media-editor-derived.ts',
        'src/lib/media/sagaGrouping.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 70,
      },
    },
  },
});
