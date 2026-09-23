import { describe, it, expect, vi } from 'vitest';

vi.mock('../tauri', () => ({
  getCatalogEntryForEditor: vi.fn(async () => null),
  getBaseEditionCandidatesForRedirect: vi.fn(async () => []),
  getCatalogEntry: vi.fn(async () => null),
}));

import { resolvePortRedirect, getLocalCatalogEntry, type PortRedirectReads } from './port-redirect';
import type { MediaCatalogEntry } from '../tauri';

type Row = Pick<MediaCatalogEntry, 'external_id' | 'format' | 'blocked_at'>;

function readsFor(rows: Record<string, Row>, edges: Record<string, string[]>): PortRedirectReads & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    getCatalogEntryForEditor: async id => { calls.push(`editor:${id}`); return (rows[id] as MediaCatalogEntry | undefined) ?? null; },
    getBaseEditionCandidatesForRedirect: async id => { calls.push(`candidates:${id}`); return edges[id] ?? []; },
    getCatalogEntry: async id => { calls.push(`catalog:${id}`); return (rows[id] as MediaCatalogEntry | undefined) ?? null; },
  };
}

describe('port-redirect with injected reads', () => {
  it('follows a PORT to its base and a blocked edition to its first visible ancestor', async () => {
    const reads = readsFor({
      'game:1': { external_id: 'game:1', format: 'PORT', blocked_at: null },
      'game:2': { external_id: 'game:2', format: 'REMASTER', blocked_at: '2024-01-01' },
      'game:3': { external_id: 'game:3', format: 'MAIN_GAME', blocked_at: null },
    }, { 'game:1': ['game:2'], 'game:2': ['game:3'] });
    expect(await resolvePortRedirect('game:1', reads)).toBe('game:3');
    expect(reads.calls).toEqual(['editor:game:1', 'candidates:game:1', 'editor:game:2', 'candidates:game:2', 'editor:game:3']);
  });

  it('keeps a plain unblocked entry as itself and answers null for an unknown id', async () => {
    const reads = readsFor({ 'game:5': { external_id: 'game:5', format: 'MAIN_GAME', blocked_at: null } }, {});
    expect(await resolvePortRedirect('game:5', reads)).toBe('game:5');
    expect(await resolvePortRedirect('game:9', reads)).toBeNull();
  });

  it('getLocalCatalogEntry shows the visible ancestor of a blocked identity and falls back to get_catalog_entry', async () => {
    const reads = readsFor({
      'game:2': { external_id: 'game:2', format: 'REMASTER', blocked_at: '2024-01-01' },
      'game:3': { external_id: 'game:3', format: 'MAIN_GAME', blocked_at: null },
    }, { 'game:2': ['game:3'] });
    expect((await getLocalCatalogEntry('game:2', reads))?.external_id).toBe('game:3');
    expect(await getLocalCatalogEntry('game:7', reads)).toBeNull();
    expect(reads.calls.at(-1)).toBe('catalog:game:7');
  });
});
