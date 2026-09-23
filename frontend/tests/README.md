# tests/

Cross-cutting tests that do not belong to a single module. Unit tests stay
co-located with the module they cover (`foo.ts` + `foo.test.ts`), which is
what Vitest expects and what keeps them moving together on refactors.

- `i18n-parity.test.ts` — every locale carries every key `es.ts` has, with the
  same shape and the same `{placeholders}`.

Future end-to-end (Playwright) suites go here too, under `tests/e2e/`.
