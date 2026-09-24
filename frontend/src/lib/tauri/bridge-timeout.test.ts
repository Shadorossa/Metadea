import { describe, expect, it } from 'vitest';
import { isPackagedAppOrigin } from './bridge';

describe('isPackagedAppOrigin', () => {
  it('recognises the packaged app origin on every platform', () => {
    expect(isPackagedAppOrigin({ protocol: 'http:', hostname: 'tauri.localhost' })).toBe(true);
    expect(isPackagedAppOrigin({ protocol: 'https:', hostname: 'tauri.localhost' })).toBe(true);
    expect(isPackagedAppOrigin({ protocol: 'tauri:', hostname: 'localhost' })).toBe(true);
  });

  it('treats the dev server and other origins as a plain browser', () => {
    expect(isPackagedAppOrigin({ protocol: 'http:', hostname: 'localhost' })).toBe(false);
    expect(isPackagedAppOrigin(undefined)).toBe(false);
  });
});
