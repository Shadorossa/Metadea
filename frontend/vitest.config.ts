import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
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
        'src/components/media/pr-editor/pr-editor-change-summary.ts',
        'src/lib/github/proposal-diff.ts',
        'src/lib/media/saga/saga-grouping.ts',
        'src/lib/local/folder-match.ts',
        'src/lib/local/season-resolve.ts',
        'src/lib/local/catalog-game-linking.ts',
        'src/lib/local/formatters.ts',
        'src/lib/local/status-badge.ts',
        'src/lib/player/queue.ts',
        'src/lib/player/progress-rules.ts',
        'src/lib/player/keymap.ts',
        'src/lib/player/format-time.ts',
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
