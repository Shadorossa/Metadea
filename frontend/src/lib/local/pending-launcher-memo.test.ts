import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PENDING_LAUNCHER_TTL_MS, getLauncherFromShopLinks, launcherFromIgdbDetail, isPendingLauncherMemoFresh,
  prunePendingLauncherMemo, resolvePendingLauncher, readPendingLauncherMemo,
} from './pending-launcher-memo';

// A minimal localStorage for the node environment.
function installStorage() {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  };
  (globalThis as { localStorage?: unknown }).localStorage = storage;
  return storage;
}

beforeEach(() => { installStorage().clear(); });

describe('launcher derivation', () => {
  it('reads shop links and IGDB details the same way the hook did', () => {
    expect(getLauncherFromShopLinks('epic|u,steam|u')).toBe('steam');
    expect(getLauncherFromShopLinks('Nintendo eShop|u')).toBe('nintendo');
    expect(getLauncherFromShopLinks('itch|u')).toBeUndefined();
    expect(launcherFromIgdbDetail({ store_links: [{ platform: 'gog' }] })).toBe('gog');
    expect(launcherFromIgdbDetail({ involved_companies: [{ company: { name: 'Nintendo' }, publisher: true }] })).toBe('nintendo');
    expect(launcherFromIgdbDetail({ platforms: [{ name: 'PC (Microsoft Windows)' }] })).toBe('steam');
    expect(launcherFromIgdbDetail({ platforms: [{ name: 'Wii' }] })).toBeUndefined();
    expect(launcherFromIgdbDetail(null)).toBeUndefined();
  });
});

describe('pending launcher memo', () => {
  it('is fresh inside the TTL only', () => {
    const entry = { launcher: 'steam', checkedAt: 1_000 };
    expect(isPendingLauncherMemoFresh(entry, 1_000 + PENDING_LAUNCHER_TTL_MS - 1)).toBe(true);
    expect(isPendingLauncherMemoFresh(entry, 1_000 + PENDING_LAUNCHER_TTL_MS)).toBe(false);
    expect(isPendingLauncherMemoFresh(entry, 500)).toBe(false);
    expect(isPendingLauncherMemoFresh(undefined, 1_000)).toBe(false);
    const stale = { launcher: null, checkedAt: 1_000 - PENDING_LAUNCHER_TTL_MS };
    expect(prunePendingLauncherMemo({ a: entry, b: stale }, 2_000)).toEqual({ a: entry });
  });

  it('asks IGDB once, remembers the answer (found or not) and serves it until it expires', async () => {
    const fetchDetail = vi.fn().mockResolvedValue({ store_links: [{ platform: 'steam' }] });
    expect(await resolvePendingLauncher('game:7', fetchDetail, 1_000)).toBe('steam');
    expect(await resolvePendingLauncher('game:7', fetchDetail, 2_000)).toBe('steam');
    expect(fetchDetail).toHaveBeenCalledTimes(1);
    expect(readPendingLauncherMemo()['game:7']).toEqual({ launcher: 'steam', checkedAt: 1_000 });

    fetchDetail.mockResolvedValue({ platforms: [{ name: 'Wii' }] });
    expect(await resolvePendingLauncher('game:8', fetchDetail, 1_000)).toBeUndefined();
    expect(await resolvePendingLauncher('game:8', fetchDetail, 1_000 + 60_000)).toBeUndefined();
    expect(fetchDetail).toHaveBeenCalledTimes(2);

    expect(await resolvePendingLauncher('game:7', fetchDetail, 1_000 + PENDING_LAUNCHER_TTL_MS)).toBeUndefined();
    expect(fetchDetail).toHaveBeenCalledTimes(3);
  });

  it('does not remember a failed fetch or a non-IGDB id', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await resolvePendingLauncher('game:9', failing, 1_000)).toBeUndefined();
    expect(readPendingLauncherMemo()['game:9']).toBeUndefined();
    const never = vi.fn();
    expect(await resolvePendingLauncher('vnovel:abc', never, 1_000)).toBeUndefined();
    expect(never).not.toHaveBeenCalled();
  });
});
