import { describe, it, expect } from 'vitest';
import { buildThemeSourceChain, nextThemeSourceStep, parseThemeVersions, THEME_REMOTE_RETRY_DELAYS_MS } from './theme-source-chain';

const V1 = 'https://v.animethemes.moe/Bleach2026-OP1.webm';
const V2 = 'https://v.animethemes.moe/Bleach2026-OP1v2.webm';
const CACHED = 'http://asset.localhost/cache/anime_185874_OP1.webm';

const single = { versions: null, episodes: '1-13', video_url: V1 };
const twoVersions = {
  versions: JSON.stringify([
    { version: 1, episodes: '1-6', videoUrl: V1 },
    { version: 2, episodes: '7-13', videoUrl: V2 },
  ]),
  episodes: null,
  video_url: V1,
};

describe('parseThemeVersions', () => {
  it('falls back to the theme itself as v1 without a (valid) versions blob', () => {
    expect(parseThemeVersions(single)).toEqual([{ version: 1, episodes: '1-13', videoUrl: V1 }]);
    expect(parseThemeVersions({ ...single, versions: '{broken' })).toHaveLength(1);
    expect(parseThemeVersions({ ...single, versions: '[]' })).toHaveLength(1);
    expect(parseThemeVersions(twoVersions).map(v => v.version)).toEqual([1, 2]);
  });
});

describe('buildThemeSourceChain', () => {
  it('plays the disk cache first, then the remote URL', () => {
    expect(buildThemeSourceChain(single, 1, CACHED)).toEqual([
      { kind: 'cache', url: CACHED, version: 1 },
      { kind: 'remote', url: V1, version: 1 },
    ]);
    expect(buildThemeSourceChain(single, 1, null)).toEqual([{ kind: 'remote', url: V1, version: 1 }]);
  });

  it('falls back to the other versions after the selected one', () => {
    expect(buildThemeSourceChain(twoVersions, 1, CACHED).map(s => `${s.kind}:v${s.version}`))
      .toEqual(['cache:v1', 'remote:v1', 'remote:v2']);
  });

  it('skips the cache for a version the cache does not hold', () => {
    expect(buildThemeSourceChain(twoVersions, 2, CACHED)).toEqual([
      { kind: 'remote', url: V2, version: 2 },
      { kind: 'remote', url: V1, version: 1 },
    ]);
  });

  it('is empty for a theme with no video at all', () => {
    expect(buildThemeSourceChain({ versions: null, episodes: null, video_url: null }, 1, null)).toEqual([]);
  });
});

describe('nextThemeSourceStep', () => {
  const chain = buildThemeSourceChain(twoVersions, 1, CACHED);

  it('moves off a failed cache file without retrying it', () => {
    expect(nextThemeSourceStep(chain, { index: 0, retries: 0 })).toEqual({ type: 'next', cursor: { index: 1, retries: 0 } });
  });

  it('retries a remote source with growing backoff before moving on', () => {
    expect(THEME_REMOTE_RETRY_DELAYS_MS).toEqual([1000, 3000]);
    expect(nextThemeSourceStep(chain, { index: 1, retries: 0 })).toEqual({ type: 'retry', cursor: { index: 1, retries: 1 }, delayMs: 1000 });
    expect(nextThemeSourceStep(chain, { index: 1, retries: 1 })).toEqual({ type: 'retry', cursor: { index: 1, retries: 2 }, delayMs: 3000 });
    expect(nextThemeSourceStep(chain, { index: 1, retries: 2 })).toEqual({ type: 'next', cursor: { index: 2, retries: 0 } });
  });

  it('is exhausted only after the last source spent its retries', () => {
    expect(nextThemeSourceStep(chain, { index: 2, retries: 1 }).type).toBe('retry');
    expect(nextThemeSourceStep(chain, { index: 2, retries: 2 })).toEqual({ type: 'exhausted' });
  });
});
