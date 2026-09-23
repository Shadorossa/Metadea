import { describe, it, expect } from 'vitest';
import type { LocalGame, LibraryEntry, MediaCatalogEntry, MetaEntry, DbMediaRelation } from '../tauri';
import type { LocalMediaItem } from './local-media-item';
import {
  computeBundleCompletionStatus,
  candidateExternalIdsForGame,
  sourceCatalogOf,
  findEditionPrefixMatch,
  displayNameFor,
  entryDisplayName,
  entryLastPlayedMs,
  entryPlaytimeMinutes,
  sortEntries,
  entryKey,
  buildLibraryStatusEntries,
  matchGameStatusByName,
  type StatusEntry,
} from './catalog-game-linking';

function game(name: string, extra: Partial<LocalGame> = {}): LocalGame {
  return { name, launcher: 'steam', ...extra };
}

function libraryEntry(externalId: string, extra: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    id: `lib-${externalId}`, user_id: 'u', external_id: externalId, type: 'game', status: 'planning',
    rating: null, rating_2: null, progress: 0, progress_2: 0, minutes_spent: 0, is_favorite: 0, is_platinum: 0,
    tags: null, notes: null, added_at: null, updated_at: null, selected_platform: null, selected_version: null,
    started_at: null, finished_at: null, ...extra,
  };
}

function catalog(externalId: string, title: string, extra: Partial<MediaCatalogEntry> = {}): MediaCatalogEntry {
  return { id: `cat-${externalId}`, external_id: externalId, title_main: title, ...extra } as MediaCatalogEntry;
}

function item(externalId: string, title: string, extra: Partial<LocalMediaItem> = {}): LocalMediaItem {
  return {
    externalId, title, titleRomaji: null, titleNative: null, cover: null, status: 'planning', progress: 0,
    libraryEntry: libraryEntry(externalId), catalogEntry: undefined, ...extra,
  };
}

function relation(mediaId: string, type: string, relatedId: string): DbMediaRelation {
  return { media_external_id: mediaId, related_media_external_id: relatedId, relation_type: type, type_label: type, title: relatedId };
}

describe('computeBundleCompletionStatus', () => {
  const byId = (statuses: Record<string, string | null>) =>
    new Map(Object.entries(statuses).map(([id, status]) => [id, libraryEntry(id, { status })]));

  it('returns undefined for a bundle with no children', () => {
    expect(computeBundleCompletionStatus('game:1', [], byId({}))).toBeUndefined();
  });

  it('is completed only when every child is completed', () => {
    const relations = [relation('game:1', 'EPISODE', 'game:2'), relation('game:1', 'CONTAINS', 'game:3')];
    expect(computeBundleCompletionStatus('game:1', relations, byId({ 'game:2': 'completed', 'game:3': 'completed' }))).toBe('completed');
    expect(computeBundleCompletionStatus('game:1', relations, byId({ 'game:2': 'completed', 'game:3': 'playing' }))).toBeUndefined();
    expect(computeBundleCompletionStatus('game:1', relations, byId({ 'game:2': 'completed' }))).toBeUndefined();
  });

  it('also collects children that point at the bundle with PART_OF or UPDATE', () => {
    const relations = [relation('game:2', 'PART_OF', 'game:1'), relation('game:3', 'UPDATE', 'game:1')];
    expect(computeBundleCompletionStatus('game:1', relations, byId({ 'game:2': 'completed', 'game:3': 'completed' }))).toBe('completed');
  });

  it('ignores a self-reference and unrelated relation types', () => {
    const relations = [relation('game:1', 'EPISODE', 'game:1'), relation('game:1', 'SEQUEL', 'game:2')];
    expect(computeBundleCompletionStatus('game:1', relations, byId({ 'game:2': 'planning' }))).toBeUndefined();
  });
});

describe('candidateExternalIdsForGame', () => {
  const pathCache: Record<string, MetaEntry> = { '123': { igdb_id: 99 } };

  it('lists the scanned id plus both catalog prefixes of the cached IGDB id', () => {
    expect(candidateExternalIdsForGame(game('G', { external_id: 'game:1', app_id: '123' }), pathCache))
      .toEqual(['game:1', 'vnovel:99', 'game:99']);
  });

  it('returns only the scanned id when the cache has nothing for the app', () => {
    expect(candidateExternalIdsForGame(game('G', { external_id: 'game:1', app_id: '456' }), pathCache)).toEqual(['game:1']);
    expect(candidateExternalIdsForGame(game('G', { external_id: 'game:1' }), pathCache)).toEqual(['game:1']);
  });

  it('returns an empty list for a game with no identity at all', () => {
    expect(candidateExternalIdsForGame(game('G', { external_id: '' }), pathCache)).toEqual([]);
    expect(candidateExternalIdsForGame(game('G'), {})).toEqual([]);
  });
});

describe('sourceCatalogOf', () => {
  const parent = catalog('game:1', 'Overwatch');
  const bundle = catalog('game:10', 'Umineko');
  const byId = new Map([[parent.external_id, parent], [bundle.external_id, bundle]]);

  it('redirects a sub-work format with a parent to that parent', () => {
    const season = item('game:2', 'Season 1', { catalogEntry: catalog('game:2', 'Season 1', { format: 'SEASON', parent_id: 'game:1' }) });
    expect(sourceCatalogOf(season, byId)).toBe(parent);
  });

  it('keeps a full edition with a parent as its own work', () => {
    const edition = item('game:2', 'Director\'s Cut', { catalogEntry: catalog('game:2', 'DC', { format: 'GAME', parent_id: 'game:1' }) });
    expect(sourceCatalogOf(edition, byId)).toBeUndefined();
  });

  it('resolves a bundle child through an EPISODE relation', () => {
    const chapter = item('game:11', 'Chapter 1');
    expect(sourceCatalogOf(chapter, byId, [relation('game:10', 'EPISODE', 'game:11')])).toBe(bundle);
    expect(sourceCatalogOf(chapter, byId, [relation('game:10', 'SEQUEL', 'game:11')])).toBeUndefined();
  });

  it('returns undefined when the parent is not in the catalog map', () => {
    const season = item('game:2', 'S', { catalogEntry: catalog('game:2', 'S', { format: 'SEASON', parent_id: 'game:404' }) });
    expect(sourceCatalogOf(season, byId)).toBeUndefined();
  });
});

describe('findEditionPrefixMatch', () => {
  it('matches a title followed only by edition keywords', () => {
    const dc = game('Death Stranding Directors Cut');
    expect(findEditionPrefixMatch('Death Stranding', [dc])).toBe(dc);
    const goty = game('The Witcher 3 Game of the Year Edition');
    expect(findEditionPrefixMatch('The Witcher 3', [goty])).toBeUndefined();
    const hd = game('Okami HD');
    expect(findEditionPrefixMatch('Okami HD', [hd])).toBeUndefined();
    expect(findEditionPrefixMatch('Okami', [hd])).toBeUndefined();
    const hd2 = game('Ico Okami HD');
    expect(findEditionPrefixMatch('Ico Okami', [hd2])).toBe(hd2);
  });

  // Suspected bug: normalizeForMatch splits "Director's" into "director s",
  // so the apostrophe spelling never hits the "directors" keyword.
  it('does not match the apostrophe spelling of Director\'s Cut', () => {
    expect(findEditionPrefixMatch('Death Stranding', [game("Death Stranding Director's Cut")])).toBeUndefined();
  });

  it('rejects trailing words that are not edition keywords', () => {
    expect(findEditionPrefixMatch('Silent Hill 2', [game('Silent Hill 2 Remake')])).toBeUndefined();
    expect(findEditionPrefixMatch('Dark Souls', [game('Dark Souls Prepare to Die Edition')])).toBeUndefined();
  });

  it('never fuzzy-matches unrelated titles sharing a numeric suffix', () => {
    expect(findEditionPrefixMatch('Bayonetta 3', [game('Yakuza 3 Remastered')])).toBeUndefined();
  });

  it('refuses a single-token title', () => {
    expect(findEditionPrefixMatch('Doom', [game('Doom Eternal')])).toBeUndefined();
    expect(findEditionPrefixMatch('Okami', [game('Okami HD')])).toBeUndefined();
  });

  // Exact equality is not a prefix match here; callers check equality first.
  it('does not return an exactly-equal name', () => {
    expect(findEditionPrefixMatch('Death Stranding', [game('Death Stranding')])).toBeUndefined();
  });

  it('returns the first matching game in list order', () => {
    const a = game('Half Life Deluxe');
    const b = game('Half Life Remastered');
    expect(findEditionPrefixMatch('Half-Life', [b, a])).toBe(b);
  });
});

describe('display / sort helpers', () => {
  const g = game('Overwatch 2', { external_id: 'game:1', app_id: '55', last_played: 1_700_000_000, playtime_minutes: 90 });
  const byId = new Map([['game:1', catalog('game:1', 'Overwatch')]]);
  const gameEntry: StatusEntry = { kind: 'game', game: g };
  const catalogEntry: StatusEntry = {
    kind: 'catalog',
    item: item('game:2', 'Bayonetta', { libraryEntry: libraryEntry('game:2', { updated_at: '2023-01-02T00:00:00Z', minutes_spent: 30 }) }),
  };

  it('displayNameFor reads the catalog title for a linked game only', () => {
    expect(displayNameFor(g, byId)).toBe('Overwatch');
    expect(displayNameFor(game('X', { external_id: 'game:9' }), byId)).toBeUndefined();
    expect(displayNameFor(game('X'), byId)).toBeUndefined();
    expect(displayNameFor(g)).toBeUndefined();
  });

  it('entryDisplayName falls back to the scanned name', () => {
    expect(entryDisplayName(gameEntry, () => 'Overwatch')).toBe('Overwatch');
    expect(entryDisplayName(gameEntry, () => undefined)).toBe('Overwatch 2');
    expect(entryDisplayName(catalogEntry, () => 'ignored')).toBe('Bayonetta');
  });

  it('entryLastPlayedMs converts seconds for games and parses updated_at for catalog items', () => {
    expect(entryLastPlayedMs(gameEntry)).toBe(1_700_000_000_000);
    expect(entryLastPlayedMs({ kind: 'game', game: game('X') })).toBe(0);
    expect(entryLastPlayedMs(catalogEntry)).toBe(Date.parse('2023-01-02T00:00:00Z'));
    expect(entryLastPlayedMs({ kind: 'catalog', item: item('game:3', 'Y') })).toBe(0);
  });

  it('entryPlaytimeMinutes reads whichever side has minutes', () => {
    expect(entryPlaytimeMinutes(gameEntry)).toBe(90);
    expect(entryPlaytimeMinutes({ kind: 'game', game: game('X') })).toBe(0);
    expect(entryPlaytimeMinutes(catalogEntry)).toBe(30);
  });

  it('sortEntries orders by name, recency or playtime without mutating the input', () => {
    const entries = [gameEntry, catalogEntry];
    expect(sortEntries(entries, 'alpha', () => undefined)).toEqual([catalogEntry, gameEntry]);
    expect(sortEntries(entries, 'alpha', () => 'Aardvark')).toEqual([gameEntry, catalogEntry]);
    expect(sortEntries(entries, 'lastPlayed', () => undefined)).toEqual([gameEntry, catalogEntry]);
    expect(sortEntries(entries, 'playtime', () => undefined)).toEqual([gameEntry, catalogEntry]);
    expect(entries).toEqual([gameEntry, catalogEntry]);
  });

  it('entryKey is stable per item, preferring app_id then install_path then name', () => {
    expect(entryKey(gameEntry)).toBe('g-55');
    expect(entryKey({ kind: 'game', game: game('X', { install_path: 'C:/x' }) })).toBe('g-C:/x');
    expect(entryKey({ kind: 'game', game: game('X') })).toBe('g-X');
    expect(entryKey(catalogEntry)).toBe('c-game:2');
  });
});

describe('buildLibraryStatusEntries', () => {
  it('turns an exact title match into a game entry carrying the library status', () => {
    const g = game('Hollow Knight');
    const entries = buildLibraryStatusEntries([item('game:1', 'Hollow Knight', { status: 'playing' })], [g], new Map());
    expect(entries).toEqual([{ kind: 'game', game: g, libraryStatus: 'playing' }]);
  });

  it('leaves an unmatched item as a catalog entry', () => {
    const it1 = item('game:1', 'Hollow Knight');
    expect(buildLibraryStatusEntries([it1], [game('Celeste')], new Map())).toEqual([{ kind: 'catalog', item: it1 }]);
  });

  it('matches through romaji and native titles', () => {
    const g = game('Shin Megami Tensei');
    const entries = buildLibraryStatusEntries([item('game:1', 'SMT', { titleRomaji: 'Shin Megami Tensei' })], [g], new Map());
    expect(entries[0]).toMatchObject({ kind: 'game', game: g });
  });

  it('matches an edition by prefix', () => {
    const g = game('Death Stranding Remastered');
    const entries = buildLibraryStatusEntries([item('game:1', 'Death Stranding')], [g], new Map());
    expect(entries[0]).toMatchObject({ kind: 'game', game: g });
  });

  it('matches a bundle chapter to the bare bundle title by stripping the chapter suffix', () => {
    const g = game('Higurashi When They Cry Hou');
    const entries = buildLibraryStatusEntries([item('game:1', 'Higurashi When They Cry Hou - Ch.1 Onikakushi')], [g], new Map());
    expect(entries[0]).toMatchObject({ kind: 'game', game: g });
  });

  it('collapses several chapters resolving to the same game into one entry', () => {
    const g = game('Higurashi When They Cry Hou');
    const items = [
      item('game:1', 'Higurashi When They Cry Hou - Ch.1 Onikakushi'),
      item('game:2', 'Higurashi When They Cry Hou - Chapter 2 Watanagashi'),
    ];
    expect(buildLibraryStatusEntries(items, [g], new Map())).toHaveLength(1);
  });

  it('dedupes repeated items by external id', () => {
    const items = [item('game:1', 'A'), item('game:1', 'A')];
    expect(buildLibraryStatusEntries(items, [], new Map())).toHaveLength(1);
  });

  it('redirects a season to its source work and links the launch game by id first', () => {
    const parent = catalog('game:1', 'Overwatch');
    const byId = new Map([[parent.external_id, parent]]);
    const ow2 = game('Overwatch 2', { app_id: '2357570' });
    const season = item('game:2', 'Season 9', { catalogEntry: catalog('game:2', 'Season 9', { format: 'SEASON', parent_id: 'game:1' }) });
    const entries = buildLibraryStatusEntries([season], [ow2], byId, { '2357570': { igdb_id: 1 } });
    expect(entries).toEqual([{ kind: 'catalog', item: season, launchGame: ow2 }]);
  });

  it('falls back to the source title for the launch game', () => {
    const parent = catalog('game:1', 'Team Fortress', { title_native: 'チームフォートレス' });
    const byId = new Map([[parent.external_id, parent]]);
    const tf = game('Team Fortress');
    const season = item('game:2', 'Season 9', { catalogEntry: catalog('game:2', 'S9', { format: 'SEASON', parent_id: 'game:1' }) });
    expect(buildLibraryStatusEntries([season], [tf], byId)[0]).toMatchObject({ launchGame: tf });

    const tfUltimate = game('Team Fortress Ultimate Edition');
    expect(buildLibraryStatusEntries([season], [tfUltimate], byId)[0]).toMatchObject({ launchGame: tfUltimate });

    expect(buildLibraryStatusEntries([season], [game('Other')], byId)[0]).toEqual({ kind: 'catalog', item: season, launchGame: undefined });
  });

  // findEditionPrefixMatch refuses single-token titles, so a one-word
  // source only ever links by id or exact name.
  it('never prefix-matches a launch game for a one-word source title', () => {
    const parent = catalog('game:1', 'Overwatch');
    const byId = new Map([[parent.external_id, parent]]);
    const season = item('game:2', 'Season 9', { catalogEntry: catalog('game:2', 'S9', { format: 'SEASON', parent_id: 'game:1' }) });
    expect(buildLibraryStatusEntries([season], [game('Overwatch Ultimate Edition')], byId)[0]).toMatchObject({ launchGame: undefined });
  });

  it('shows one card per source when several seasons share it', () => {
    const parent = catalog('game:1', 'Overwatch');
    const byId = new Map([[parent.external_id, parent]]);
    const seasons = [8, 9].map(n => item(`game:${n}`, `Season ${n}`, { catalogEntry: catalog(`game:${n}`, `S${n}`, { format: 'SEASON', parent_id: 'game:1' }) }));
    const entries = buildLibraryStatusEntries(seasons, [], byId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ item: seasons[0] });
  });

  it('resolves a bundle child via relations even when no format/parent is set', () => {
    const bundle = catalog('game:10', 'Umineko');
    const byId = new Map([[bundle.external_id, bundle]]);
    const chapter = item('game:11', 'Umineko Episode 1');
    const g = game('Umineko');
    const entries = buildLibraryStatusEntries([chapter], [g], byId, {}, [relation('game:10', 'EPISODE', 'game:11')]);
    expect(entries).toEqual([{ kind: 'catalog', item: chapter, launchGame: g }]);
  });

  it('reports an empty library status as undefined', () => {
    const g = game('A');
    expect(buildLibraryStatusEntries([item('game:1', 'A', { status: '' })], [g], new Map())[0]).toEqual({ kind: 'game', game: g, libraryStatus: undefined });
  });
});

describe('matchGameStatusByName', () => {
  const titled = (titles: string[], status: string | null) => ({ titles, entry: libraryEntry('x', { status }) });

  it('returns the status of an exact normalized title match', () => {
    const entries = [titled(['Silent Hill 4: The Room'], 'completed')];
    expect(matchGameStatusByName(game('silent hill 4 - the room'), entries)).toBe('completed');
  });

  it('falls back to an edition prefix match after trying every exact one', () => {
    const entries = [titled(['Okami Amaterasu'], 'planning'), titled(['Okami'], 'dropped')];
    expect(matchGameStatusByName(game('Okami Amaterasu HD'), entries)).toBe('planning');
  });

  it('prefers an exact match over an earlier prefix match', () => {
    const entries = [titled(['Death Stranding'], 'paused'), titled(["Death Stranding Director's Cut"], 'completed')];
    expect(matchGameStatusByName(game("Death Stranding Director's Cut"), entries)).toBe('completed');
  });

  it('returns undefined with no match or a null status', () => {
    expect(matchGameStatusByName(game('Celeste'), [titled(['Hades'], 'completed')])).toBeUndefined();
    expect(matchGameStatusByName(game('Hades'), [titled(['Hades'], null)])).toBeUndefined();
  });
});
