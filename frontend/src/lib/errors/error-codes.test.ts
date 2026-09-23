import { describe, it, expect } from 'vitest';
import { ERROR_CODES } from './error-codes';
import { es } from '../../i18n/es';
// Vite's ?raw import keeps this free of node typings (the project has none).
import rustSource from '../../../src-tauri/src/error_codes.rs?raw';

// The Rust side is the source of the codes; this file's list and the i18n
// `errors` namespace must match it exactly, or a command's error would reach
// the user as a bare "E_..." string.
function rustCodes(): string[] {
  const codes = new Set<string>();
  for (const match of rustSource.matchAll(/"(E_[A-Z0-9_]+)"/g)) codes.add(match[1]);
  return [...codes].sort();
}

describe('error code parity', () => {
  it('lists exactly the codes declared in src-tauri/src/error_codes.rs', () => {
    expect([...ERROR_CODES].sort()).toEqual(rustCodes());
  });

  it('has no duplicates', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  it('has one errors.* i18n key per code and nothing else', () => {
    expect(Object.keys(es.errors).sort()).toEqual([...ERROR_CODES].sort());
  });
});
