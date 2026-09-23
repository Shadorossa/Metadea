import { describe, expect, it, vi } from 'vitest';
import { createPublicCoverResolver } from './public-cover';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('createPublicCoverResolver', () => {
  it('keeps the cover as-is when the user has no custom cover', () => {
    const loadRaw = vi.fn();
    const r = createPublicCoverResolver({ loadRaw, hasCustomCover: () => false });
    expect(r.resolve('anime:1', 'https://img/main.jpg')).toBe('https://img/main.jpg');
    expect(loadRaw).not.toHaveBeenCalled();
  });

  it('swaps a custom cover for the main catalog cover once loaded', async () => {
    const onResolved = vi.fn();
    const loadRaw = vi.fn(async () => 'https://img/main.jpg');
    const r = createPublicCoverResolver({ loadRaw, hasCustomCover: () => true, onResolved });
    expect(r.resolve('anime:1', 'asset://custom.png')).toBeNull();
    expect(r.resolve('anime:1', 'asset://custom.png')).toBeNull();
    await flush();
    expect(loadRaw).toHaveBeenCalledTimes(1);
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(r.resolve('anime:1', 'asset://custom.png')).toBe('https://img/main.jpg');
  });

  it('never publishes a non-https main cover', async () => {
    const r = createPublicCoverResolver({ loadRaw: async () => 'asset://local.png', hasCustomCover: () => true });
    r.resolve('game:1', 'https://custom');
    await flush();
    expect(r.resolve('game:1', 'https://custom')).toBeNull();
  });
});
