import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import astro from 'eslint-plugin-astro';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '.astro/**',
      'node_modules/**',
      'src-tauri/**',
      'scratch/**',
      'public/**',
      '*.config.js',
      '*.config.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs['flat/recommended'],

  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // A hook called conditionally is a real bug, never a style choice.
      'react-hooks/rules-of-hooks': 'error',
      // Warn, not error: the repo has pre-existing suppressions that were
      // written while no linter was installed and need reviewing one by one.
      'react-hooks/exhaustive-deps': 'warn',
      // The React Compiler rules land ~120 hits on this codebase. They are
      // worth adopting, but as their own piece of work — gating CI on them
      // today would mean never turning the linter on at all.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',

      // 51 pre-existing `as any` casts. Warn now, raise to error once the
      // typed window/event contract lands.
      '@typescript-eslint/no-explicit-any': 'warn',

      '@typescript-eslint/no-unused-vars': ['warn', {
        // `const { removed: _removed, ...rest }` is the established way this
        // codebase drops a key from a record.
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],

      // Non-null assertions are widespread over DOM lookups and remote JSON;
      // surfacing them without blocking the build.
      '@typescript-eslint/no-non-null-assertion': 'warn',

      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      // `try { ... } catch {}` around an optional parse is deliberate here.
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'warn',
    },
  },

  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
