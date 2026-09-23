import { describe, it, expect, vi } from 'vitest';
import { planMalImport, importMalList, type MalImportDeps } from './import';
import type { MalCatalogLink, MalListItem } from '../tauri/mal';
import type { AniListMediaByMalId } from '../search/providers/anilist/detail';

vi.mock('../../i18n/runtime', () => ({
  getT: () => ({
    mal: {
      import_fetching: 'fetching {kind}', import_matching: 'matching {count}', import_saving: 'saving {count}',
      kind_anime: 'anime', kind_manga: 'manga',
    },
  }),
}));

function row(mal_id: number, overrides: Partial<MalListItem> = {}): MalListItem {
  return {
    mal_id, title: `Title ${mal_id}`, status: 'completed', score: 8, progress: 12, progress_volumes: 0,
    is_repeating: false, start_date: null, finish_date: '2026-01-01', updated_at: null, ...overrides,
  };
}

function media(id: number, idMal: number, format = 'TV'): AniListMediaByMalId {
  return {
    id, idMal, type: format === 'NOVEL' || format === 'MANGA' ? 'MANGA' : 'ANIME', format,
    title: { romaji: `R${id}`, english: null, native: null }, coverImage: { large: null }, genres: ['Action'], status: 'FINISHED', studios: null,
  };
}

describe('planMalImport', () => {
  it('uses known catalog rows first, AniList matches second and lists the rest', () => {
    const known: MalCatalogLink[] = [{ mal_id: 21, external_id: 'anime:21', type: 'anime' }];
    const plan = planMalImport('anime', [row(21), row(5114), row(999)], known, [media(5114, 5114)]);
    expect(plan.items.map(i => i.mediaId)).toEqual([21, 5114]);
    expect(plan.items[0].media).toMatchObject({ id: 21, type: 'ANIME' });
    expect(plan.items[1].media).toMatchObject({ id: 5114, title: { romaji: 'R5114' } });
    expect(plan.unmatched.map(r => r.mal_id)).toEqual([999]);
    // Only what AniList taught us this run is written back; the known row already has it.
    expect(plan.newLinks).toEqual([{ mal_id: 5114, external_id: 'anime:5114', type: 'anime' }]);
  });

  it('files light novels under lnovel and keeps manga volumes', () => {
    const plan = planMalImport('manga', [row(2, { progress: 370, progress_volumes: 41 }), row(7)], [], [media(30002, 2, 'MANGA'), media(40, 7, 'NOVEL')]);
    expect(plan.newLinks).toEqual([
      { mal_id: 2, external_id: 'manga:30002', type: 'manga' },
      { mal_id: 7, external_id: 'lnovel:40', type: 'lnovel' },
    ]);
    expect(plan.items[0]).toMatchObject({ progress: 370, progressVolumes: 41 });
  });

  it('ignores duplicate MAL rows and AniList answers without an idMal', () => {
    const plan = planMalImport('anime', [row(1), row(1)], [], [{ ...media(10, 1), idMal: null }, media(11, 1)]);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].mediaId).toBe(11);
  });
});

function deps(overrides: Partial<MalImportDeps> = {}): MalImportDeps & { merged: unknown[] } {
  const merged: unknown[] = [];
  return {
    merged,
    fetchList: vi.fn(async (kind: 'anime' | 'manga') => (kind === 'anime' ? [row(21), row(999)] : [row(2)])),
    knownLinks: vi.fn(async (kind: 'anime' | 'manga') => (kind === 'anime' ? [{ mal_id: 21, external_id: 'anime:21', type: 'anime' }] : [])),
    lookupAniList: vi.fn(async (_ids: number[], type: 'ANIME' | 'MANGA') => (type === 'MANGA' ? [media(30002, 2, 'MANGA')] : [])),
    merge: vi.fn(async (items: unknown[]) => { merged.push(...items); return { updated: 1, added: 1, failed: 0 }; }),
    rememberLinks: vi.fn(async () => 1),
    ...overrides,
  };
}

describe('importMalList', () => {
  it('walks both lists, merges through the shared importer and persists new links after the merge', async () => {
    const d = deps();
    const progress: string[] = [];
    const result = await importMalList(['anime', 'manga'], p => progress.push(p.status), d);
    expect(result).toEqual({ ok: true, updated: 1, added: 1, failed: 0, unmatched: [expect.objectContaining({ mal_id: 999 })] });
    expect(d.merged.map(i => (i as { mediaId: number }).mediaId)).toEqual([21, 30002]);
    // Only the ids the catalog did not know go to AniList.
    expect(d.lookupAniList).toHaveBeenCalledWith([999], 'ANIME');
    expect(d.lookupAniList).toHaveBeenCalledWith([2], 'MANGA');
    expect(d.rememberLinks).toHaveBeenCalledWith([{ mal_id: 2, external_id: 'manga:30002', type: 'manga' }]);
    expect(progress.at(-1)).toBe('done');
  });

  it('is a no-op without kinds and reports a fetch failure instead of throwing', async () => {
    expect(await importMalList([], undefined, deps())).toEqual({ ok: true, updated: 0, added: 0, failed: 0, unmatched: [] });
    const d = deps({ fetchList: vi.fn(async () => { throw 'E_MAL_NOT_CONNECTED'; }) });
    const statuses: string[] = [];
    expect(await importMalList(['anime'], p => statuses.push(p.status), d)).toEqual({ ok: false, error: 'E_MAL_NOT_CONNECTED' });
    expect(statuses.at(-1)).toBe('error');
    expect(d.merge).not.toHaveBeenCalled();
  });

  it('still succeeds when persisting the links fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = deps({ rememberLinks: vi.fn(async () => { throw new Error('locked'); }) });
    expect((await importMalList(['manga'], undefined, d)).ok).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
