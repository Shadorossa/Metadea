import { describe, expect, it } from 'vitest';
import { nameToKeep } from './keep-chosen-name';

describe('nameToKeep', () => {
  it('keeps the name picked before linking Google', () => {
    expect(nameToKeep('Nacho', 'nachogalan', '')).toBe('Nacho');
    expect(nameToKeep('  Nacho ', 'nachogalan', undefined)).toBe('Nacho');
  });

  it('never overrides a custom display name', () => {
    expect(nameToKeep('Nacho', 'nachogalan', 'Shadorossa')).toBeNull();
  });

  it('does nothing without a previous name or when it is unchanged', () => {
    expect(nameToKeep(null, 'nachogalan', '')).toBeNull();
    expect(nameToKeep('', 'nachogalan', '')).toBeNull();
    expect(nameToKeep('nachogalan', 'nachogalan', '')).toBeNull();
  });
});
