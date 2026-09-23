import { describe, it, expect } from 'vitest';
import { getT } from '../../i18n/runtime';
import type { MediaCatalogEntry } from '../tauri/catalog';
import type { MediaPageData } from '../media/types';
import type { ProposalBundle, CharacterProposalBundle, CharacterProposalActor } from './submit-collaborative-proposal';
import {
  buildCharacterChangeSummary,
  buildMediaChangeSummary,
  compareList,
  compareRelationChanges,
  mergeCharacterPreviewActors,
  mergeCharacterPreviewAppearances,
  mergeCharacterPreviewEntry,
  normalizeAliases,
  normalizedRelationType,
  type CharacterProviderData,
} from './proposal-diff';

// Labels come from the real translations (node has no window, so the
// fallback locale is used) — the tests never hardcode UI strings.
const i18n = getT();

type Relation = ProposalBundle['media_relations'][number];

function relation(id: string, type: string, extra: Partial<Relation> = {}): Relation {
  return { media_external_id: 'anime:1', related_media_external_id: id, relation_type: type, type_label: type, title: `Title ${id}`, ...extra };
}

function catalog(overrides: Partial<MediaCatalogEntry> = {}): MediaCatalogEntry {
  return { id: 'row-1', external_id: 'anime:1', type: 'anime', created_at: '2024-01-01', updated_at: '2024-01-01', ...overrides };
}

function mediaBundle(overrides: Partial<ProposalBundle> = {}, catalogOverrides: Partial<MediaCatalogEntry> = {}): ProposalBundle {
  return { media_catalog: catalog(catalogOverrides), media_relations: [], characters: [], media_authors: [], ...overrides };
}

function pageData(overrides: Partial<MediaPageData> = {}): MediaPageData {
  return {
    externalId: 'anime:1', type: 'anime', titleMain: 'Inazuma Eleven', bannerColor: '', metaLines: [], stats: [],
    characters: [], relations: [], progressStatus: 'watching', progressLabel: '', ...overrides,
  };
}

function group(summary: { groups: Array<{ label: string }> }, label: string) {
  return summary.groups.find(item => item.label === label);
}

describe('normalizedRelationType', () => {
  it('upper-cases and strips a REL_ prefix', () => {
    expect(normalizedRelationType('rel_sequel')).toBe('SEQUEL');
    expect(normalizedRelationType('Sequel')).toBe('SEQUEL');
  });

  it('keeps a type that merely starts with REL', () => {
    expect(normalizedRelationType('RELATED')).toBe('RELATED');
  });

  it('maps null and undefined to an empty string', () => {
    expect(normalizedRelationType(null)).toBe('');
    expect(normalizedRelationType(undefined)).toBe('');
  });
});

describe('normalizeAliases', () => {
  it('trims, lower-cases, dedupes and sorts', () => {
    expect(normalizeAliases(' Mark Evans , endou, Endou ,,')).toEqual(['endou', 'mark evans']);
  });

  it('returns an empty list for null, undefined or blank input', () => {
    expect(normalizeAliases(null)).toEqual([]);
    expect(normalizeAliases(undefined)).toEqual([]);
    expect(normalizeAliases('  ')).toEqual([]);
  });
});

describe('compareList', () => {
  const keyOf = (item: { id: string; v?: number }) => item.id;

  it('counts added, updated and removed by key with a JSON comparison', () => {
    expect(compareList(
      [{ id: 'a', v: 1 }, { id: 'b', v: 2 }, { id: 'd' }],
      [{ id: 'a', v: 1 }, { id: 'b', v: 1 }, { id: 'c' }],
      keyOf,
    )).toEqual({ added: 1, updated: 1, removed: 1 });
  });

  it('ignores a new or changed item that already matches provider data', () => {
    expect(compareList([{ id: 'a', v: 2 }, { id: 'b' }], [{ id: 'a', v: 1 }], keyOf, () => true))
      .toEqual({ added: 0, updated: 0, removed: 0 });
  });

  it('reports a new item as updated when the provider already has that entity', () => {
    expect(compareList([{ id: 'a' }], [], keyOf, () => false, () => true))
      .toEqual({ added: 0, updated: 1, removed: 0 });
  });

  it('uses the custom change predicate for items present on both sides', () => {
    expect(compareList([{ id: 'a', v: 2 }], [{ id: 'a', v: 1 }], keyOf, () => false, () => false, () => false))
      .toEqual({ added: 0, updated: 0, removed: 0 });
  });

  it('returns zero counts for two empty lists', () => {
    expect(compareList([], [], keyOf)).toEqual({ added: 0, updated: 0, removed: 0 });
  });
});

describe('compareRelationChanges', () => {
  it('reports a relation that is new on both the branch and the provider', () => {
    const result = compareRelationChanges([relation('anime:2', 'SEQUEL')], [], null);
    expect(result.counts).toEqual({ added: 1, updated: 0, removed: 0 });
    expect(result.newIds).toEqual(['anime:2']);
    expect(result.updatedIds).toEqual([]);
    expect(result.removedRelations).toEqual([]);
  });

  it('reports a relation dropped from the branch, titled from the upstream row', () => {
    const result = compareRelationChanges([], [relation('anime:2', 'SEQUEL', { title: 'IE 2' })], null);
    expect(result.counts).toEqual({ added: 0, updated: 0, removed: 1 });
    expect(result.removedRelations).toEqual([{ id: 'anime:2', title: 'IE 2' }]);
  });

  it('falls back to the id when the removed upstream relation has no title', () => {
    const result = compareRelationChanges([], [relation('anime:2', 'SEQUEL', { title: '' })], null);
    expect(result.removedRelations).toEqual([{ id: 'anime:2', title: 'anime:2' }]);
  });

  it('reports a type change as an update', () => {
    const result = compareRelationChanges([relation('anime:2', 'PREQUEL')], [relation('anime:2', 'SEQUEL')], null);
    expect(result.counts).toEqual({ added: 0, updated: 1, removed: 0 });
    expect(result.updatedIds).toEqual(['anime:2']);
  });

  it('treats REL_ prefixed and lower-case types as the same type', () => {
    const result = compareRelationChanges([relation('anime:2', 'sequel')], [relation('anime:2', 'REL_SEQUEL')], null);
    expect(result.counts).toEqual({ added: 0, updated: 0, removed: 0 });
  });

  it('ignores recommendations on both sides', () => {
    expect(compareRelationChanges([relation('anime:9', 'RECOMMENDATION')], [], null).counts)
      .toEqual({ added: 0, updated: 0, removed: 0 });
    expect(compareRelationChanges([], [relation('anime:9', 'RECOMMENDATION')], null).counts)
      .toEqual({ added: 0, updated: 0, removed: 0 });
  });

  it('highlights a recommendation promoted to a real relation as new', () => {
    const result = compareRelationChanges([relation('anime:9', 'SEQUEL')], [relation('anime:9', 'RECOMMENDATION')], null);
    expect(result.counts).toEqual({ added: 1, updated: 0, removed: 0 });
    expect(result.newIds).toEqual(['anime:9']);
  });

  it('does not highlight a new branch relation the provider already shows with the same type', () => {
    const source = pageData({ relations: [{ typeLabel: 'Sequel', relationType: 'SEQUEL', title: 'IE 2', relatedExternalId: 'anime:2' }] });
    const result = compareRelationChanges([relation('anime:2', 'SEQUEL')], [], source);
    expect(result.counts).toEqual({ added: 0, updated: 0, removed: 0 });
    expect(result.newIds).toEqual([]);
  });

  it('reports a new branch relation whose type differs from the provider as an update', () => {
    const source = pageData({ relations: [{ typeLabel: 'Prequel', relationType: 'PREQUEL', title: 'IE 2', relatedExternalId: 'anime:2' }] });
    const result = compareRelationChanges([relation('anime:2', 'SEQUEL')], [], source);
    expect(result.counts).toEqual({ added: 0, updated: 1, removed: 0 });
    expect(result.updatedIds).toEqual(['anime:2']);
  });

  it('treats a provider recommendation as no existing relation', () => {
    const source = pageData({ relations: [{ typeLabel: 'Rec', relationType: 'RECOMMENDATION', title: 'IE 2', relatedExternalId: 'anime:2' }] });
    const result = compareRelationChanges([relation('anime:2', 'SEQUEL')], [], source);
    expect(result.counts).toEqual({ added: 1, updated: 0, removed: 0 });
  });

  it('prefers a real provider relation over a recommendation for the same target, in either order', () => {
    const real = { typeLabel: 'Sequel', relationType: 'SEQUEL', title: 'IE 2', relatedExternalId: 'anime:2' };
    const rec = { typeLabel: 'Rec', relationType: 'RECOMMENDATION', title: 'IE 2', relatedExternalId: 'anime:2' };
    for (const relations of [[rec, real], [real, rec]]) {
      const result = compareRelationChanges([relation('anime:2', 'SEQUEL')], [], pageData({ relations }));
      expect(result.counts).toEqual({ added: 0, updated: 0, removed: 0 });
    }
  });

  it('ignores provider relations without a related external id', () => {
    const source = pageData({ relations: [{ typeLabel: 'Sequel', relationType: 'SEQUEL', title: 'IE 2' }] });
    expect(compareRelationChanges([relation('anime:2', 'SEQUEL')], [], source).counts)
      .toEqual({ added: 1, updated: 0, removed: 0 });
  });

  it('does not report a type change that just realigns the branch with the provider', () => {
    const source = pageData({ relations: [{ typeLabel: 'Sequel', relationType: 'SEQUEL', title: 'IE 2', relatedExternalId: 'anime:2' }] });
    const result = compareRelationChanges([relation('anime:2', 'SEQUEL')], [relation('anime:2', 'PREQUEL')], source);
    expect(result.counts).toEqual({ added: 0, updated: 0, removed: 0 });
  });

  it('does not report a branch removal when the provider still shows the same relation', () => {
    const source = pageData({ relations: [{ typeLabel: 'Sequel', relationType: 'SEQUEL', title: 'IE 2', relatedExternalId: 'anime:2' }] });
    const result = compareRelationChanges([], [relation('anime:2', 'SEQUEL')], source);
    expect(result.counts).toEqual({ added: 0, updated: 0, removed: 0 });
    expect(result.removedRelations).toEqual([]);
  });

  // Characterization: the count is bumped but the id is not added to
  // updatedIds, so this update is never highlighted on the page.
  it('counts a branch removal that reverts to a different provider type as an update without an id', () => {
    const source = pageData({ relations: [{ typeLabel: 'Prequel', relationType: 'PREQUEL', title: 'IE 2', relatedExternalId: 'anime:2' }] });
    const result = compareRelationChanges([], [relation('anime:2', 'SEQUEL')], source);
    expect(result.counts).toEqual({ added: 0, updated: 1, removed: 0 });
    expect(result.updatedIds).toEqual([]);
    expect(result.removedRelations).toEqual([]);
  });
});

describe('buildMediaChangeSummary', () => {
  it('reports every populated catalog field as added when there is no upstream file', () => {
    const current = mediaBundle({}, { title_main: 'Inazuma Eleven', synopsis: 'Football', cover_url: 'cover.png', release_year: 2008, score_global: null });
    const summary = buildMediaChangeSummary(current, null, null, i18n);
    expect(summary.groups).toEqual([
      { label: i18n.notifications.preview_other_data, added: 1, updated: 0, removed: 0 },
      { label: i18n.notifications.preview_titles, added: 1, updated: 0, removed: 0 },
      { label: i18n.media.section_synopsis, added: 1, updated: 0, removed: 0 },
      { label: i18n.notifications.preview_images, added: 1, updated: 0, removed: 0 },
      { label: i18n.notifications.preview_dates, added: 1, updated: 0, removed: 0 },
    ]);
    expect(summary.newRelationIds).toEqual([]);
    expect(summary.updatedRelationIds).toEqual([]);
    expect(summary.removedItems).toEqual([]);
    expect(summary.characterChanges).toEqual({ fields: {}, appearances: {}, actors: {}, merges: {} });
  });

  it('groups sibling fields under one label', () => {
    const current = mediaBundle({}, { title_main: 'A', title_romaji: 'B', title_english: 'C', title_native: 'D' });
    const summary = buildMediaChangeSummary(current, null, null, i18n);
    expect(group(summary, i18n.notifications.preview_titles)).toEqual({ label: i18n.notifications.preview_titles, added: 4, updated: 0, removed: 0 });
  });

  it('ignores id, external_id and timestamps', () => {
    const current = mediaBundle({}, { id: 'x', external_id: 'anime:1', created_at: 'now', updated_at: 'now' });
    const summary = buildMediaChangeSummary(current, null, null, i18n);
    expect(summary.groups).toEqual([{ label: i18n.notifications.preview_other_data, added: 1, updated: 0, removed: 0 }]);
  });

  it('labels count fields by media type', () => {
    expect(group(buildMediaChangeSummary(mediaBundle({}, { total_count: 26, total_count_2: 1 }), null, null, i18n), i18n.media.stat_episodes)).toBeDefined();
    expect(group(buildMediaChangeSummary(mediaBundle({}, { total_count: 26, total_count_2: 1 }), null, null, i18n), i18n.media.stat_seasons)).toBeDefined();
    const manga = buildMediaChangeSummary(mediaBundle({}, { type: 'manga', total_count: 26, total_count_2: 3 }), null, null, i18n);
    expect(group(manga, i18n.media.stat_chapters)).toBeDefined();
    expect(group(manga, i18n.media.stat_volumes)).toBeDefined();
  });

  it('reports only the fields that differ from upstream as updated', () => {
    const previous = mediaBundle({}, { title_main: 'Inazuma Eleven', synopsis: 'Old', release_year: 2008 });
    const current = mediaBundle({}, { title_main: 'Inazuma Eleven', synopsis: 'New', release_year: 2008, cover_url: 'c.png' });
    const summary = buildMediaChangeSummary(current, previous, null, i18n);
    expect(summary.groups).toEqual([
      { label: i18n.media.section_synopsis, added: 0, updated: 1, removed: 0 },
      { label: i18n.notifications.preview_images, added: 0, updated: 1, removed: 0 },
    ]);
  });

  it('treats an undefined branch value and a null upstream value as equal', () => {
    const previous = mediaBundle({}, { synopsis: null });
    const current = mediaBundle({}, { synopsis: undefined });
    expect(buildMediaChangeSummary(current, previous, null, i18n).groups).toEqual([]);
  });

  it('skips fields that already match the provider', () => {
    const current = mediaBundle({}, { title_main: 'Inazuma Eleven', synopsis: 'Branch synopsis' });
    const summary = buildMediaChangeSummary(current, null, pageData({ titleMain: 'Inazuma Eleven', description: 'Provider synopsis' }), i18n);
    expect(summary.groups).toEqual([{ label: i18n.media.section_synopsis, added: 1, updated: 0, removed: 0 }]);
  });

  it('only compares relations owned by this entry', () => {
    const current = mediaBundle({ media_relations: [
      relation('anime:2', 'SEQUEL'),
      relation('anime:3', 'SEQUEL', { media_external_id: 'anime:2' }),
      relation('anime:4', 'SEQUEL', { media_external_id: undefined }),
    ] });
    const summary = buildMediaChangeSummary(current, null, null, i18n);
    expect(group(summary, i18n.media.section_related)).toEqual({ label: i18n.media.section_related, added: 2, updated: 0, removed: 0 });
    expect(summary.newRelationIds).toEqual(['anime:2', 'anime:4']);
  });

  it('surfaces removed relations for the removed-items strip', () => {
    const previous = mediaBundle({ media_relations: [relation('anime:2', 'SEQUEL', { title: 'IE 2' })] });
    const summary = buildMediaChangeSummary(mediaBundle(), previous, null, i18n);
    expect(group(summary, i18n.media.section_related)).toEqual({ label: i18n.media.section_related, added: 0, updated: 0, removed: 1 });
    expect(summary.removedItems).toEqual([{ id: 'anime:2', title: 'IE 2' }]);
  });

  it('compares characters against the provider cast by id', () => {
    const source = pageData({ characters: [
      { id: 'character:a1', name: 'Endou', image: 'endou.png', role: 'MAIN' },
      { id: 'character:a2', name: 'Gouenji', image: 'gouenji.png', role: 'MAIN' },
    ] });
    const current = mediaBundle({ characters: [
      { external_id: 'character:a1', name: 'Endou', image_url: 'endou.png', relation_type: 'MAIN' },
      { external_id: 'character:a2', name: 'Gouenji Shuuya', image_url: 'gouenji.png', relation_type: 'MAIN' },
      { external_id: 'character:a3', name: 'Kidou' },
    ] });
    const summary = buildMediaChangeSummary(current, null, source, i18n);
    expect(group(summary, i18n.media.section_characters)).toEqual({ label: i18n.media.section_characters, added: 1, updated: 1, removed: 0 });
  });

  it('compares authors against the provider credits by id', () => {
    const source = pageData({ authors: [{ external_id: 'person:1', name: 'Level-5', role: 'Original Creator' }] });
    const current = mediaBundle({ media_authors: [
      { external_id: 'person:1', name: 'Level-5', role: 'Original Creator' },
      { external_id: 'person:2', name: 'Someone', role: 'Director' },
    ] });
    const summary = buildMediaChangeSummary(current, null, source, i18n);
    expect(group(summary, i18n.media.stat_authors)).toEqual({ label: i18n.media.stat_authors, added: 1, updated: 0, removed: 0 });
  });

  it('counts story arcs by id', () => {
    const arc = (id: string, name: string) => ({ id, name, image_base64: null, items: [], sort_order: 0 });
    const previous = mediaBundle({ story_arcs: [arc('arc-1', 'Football Frontier'), arc('arc-2', 'Aliea')] });
    const current = mediaBundle({ story_arcs: [arc('arc-1', 'Football Frontier International'), arc('arc-3', 'World')] });
    const summary = buildMediaChangeSummary(current, previous, null, i18n);
    expect(group(summary, i18n.notifications.preview_arcs)).toEqual({ label: i18n.notifications.preview_arcs, added: 1, updated: 1, removed: 1 });
  });
});

const providerActor: CharacterProposalActor = {
  external_id: 'person:a10', name: 'Takeuchi Junko', name_native: '竹内順子', image_url: 'actor.png', role: 'voice', language: 'Japanese',
};

const provider: CharacterProviderData = {
  aliases: ['Mark Evans'],
  entry: {
    id: '', external_id: 'character:a1', name: 'Endou Mamoru', name_native: '円堂守', aliases_csv: 'Mark Evans', biography: 'Goalkeeper',
    image_url: 'https://s4.anilist.co/file/anilistcdn/character/large/b1-abc.png', gender: 'Male', age: '13', blood_type: null,
    dob_year: null, dob_month: 8, dob_day: 22, created_at: '', updated_at: '',
  },
  appearances: [{ media_external_id: 'anime:1', relation_type: 'MAIN', title: 'Inazuma Eleven', cover: 'cover1.png' }],
  actors: [providerActor],
};

function characterBundle(overrides: Partial<CharacterProposalBundle> = {}): CharacterProposalBundle {
  return { character: { external_id: 'character:a1' }, appearances: [], actors: [], ...overrides };
}

describe('mergeCharacterPreviewEntry', () => {
  const local = {
    id: 'row-9', external_id: 'character:a1', name: 'Local Endou', name_native: null, aliases_csv: 'Endou', biography: 'Local bio',
    image_url: 'https://s4.anilist.co/file/anilistcdn/character/medium/b1-abc.png', reaction: 'love', gender: null, age: '14',
    created_at: '2024-01-01', updated_at: '2024-02-02',
  };

  it('lets a proposed field win over local and provider values', () => {
    const merged = mergeCharacterPreviewEntry('character:a1', characterBundle({ character: { external_id: 'character:a1', name: 'Mark Evans' } }), provider, local);
    expect(merged.name).toBe('Mark Evans');
  });

  // Characterization: an explicitly blanked proposal field shows the
  // provider value, skipping the local one entirely.
  it('falls back from a blank proposed field to the provider, not the local value', () => {
    const merged = mergeCharacterPreviewEntry('character:a1', characterBundle({ character: { external_id: 'character:a1', name: '', biography: null } }), provider, local);
    expect(merged.name).toBe('Endou Mamoru');
    expect(merged.biography).toBe('Goalkeeper');
  });

  it('uses the local value, then the provider, for fields the proposal does not touch', () => {
    const merged = mergeCharacterPreviewEntry('character:a1', characterBundle(), provider, local);
    expect(merged.biography).toBe('Local bio');
    expect(merged.name_native).toBe('円堂守');
  });

  it('falls back to the external id as name when nothing knows the character', () => {
    const merged = mergeCharacterPreviewEntry('character:a1', characterBundle(), null, null);
    expect(merged).toEqual({
      id: '', external_id: 'character:a1', name: 'character:a1', name_native: null, aliases_csv: '', biography: null, image_url: null,
      reaction: null, gender: null, age: null, blood_type: null, dob_year: null, dob_month: null, dob_day: null, created_at: '', updated_at: '',
    });
  });

  // Characterization: provider aliases come first and the union is exact,
  // so a case-different duplicate is kept.
  it('unions provider aliases with the proposed ones, exact-match deduped', () => {
    const bundle = characterBundle({ character: { external_id: 'character:a1', aliases_csv: ' mark evans , Endou, Mark Evans ' } });
    expect(mergeCharacterPreviewEntry('character:a1', bundle, provider, local).aliases_csv).toBe('Mark Evans, mark evans, Endou');
  });

  it('uses the local aliases when the proposal does not touch them', () => {
    expect(mergeCharacterPreviewEntry('character:a1', characterBundle(), provider, local).aliases_csv).toBe('Mark Evans, Endou');
  });

  it('upgrades a local AniList medium image to the provider one when the proposal leaves the image alone', () => {
    expect(mergeCharacterPreviewEntry('character:a1', characterBundle(), provider, local).image_url).toBe(provider.entry.image_url);
    expect(mergeCharacterPreviewEntry('character:a1', characterBundle(), null, local).image_url).toBe(local.image_url);
  });

  it('keeps a proposed image over the AniList medium upgrade', () => {
    const bundle = characterBundle({ character: { external_id: 'character:a1', image_url: 'custom.png' } });
    expect(mergeCharacterPreviewEntry('character:a1', bundle, provider, local).image_url).toBe('custom.png');
  });

  it('takes identity and profile details from the local row, then the provider', () => {
    const merged = mergeCharacterPreviewEntry('character:a1', characterBundle(), provider, local);
    expect(merged.id).toBe('row-9');
    expect(merged.reaction).toBe('love');
    expect(merged.age).toBe('14');
    expect(merged.gender).toBe('Male');
    expect(merged.dob_month).toBe(8);
    expect(merged.created_at).toBe('2024-01-01');
  });
});

describe('mergeCharacterPreviewAppearances', () => {
  it('overlays the proposal onto provider appearances, keeping provider title and cover', () => {
    const merged = mergeCharacterPreviewAppearances(
      [{ media_external_id: 'anime:1', relation_type: 'SUPPORTING' }, { media_external_id: 'anime:2', relation_type: 'MAIN' }],
      provider.appearances,
    );
    expect(merged).toEqual([
      { media_external_id: 'anime:1', relation_type: 'SUPPORTING', title: 'Inazuma Eleven', cover: 'cover1.png' },
      { media_external_id: 'anime:2', relation_type: 'MAIN' },
    ]);
  });

  // Characterization: unlike actors, a null relation_type in the proposal
  // does overwrite the provider's value.
  it('lets a null proposed relation type overwrite the provider one', () => {
    const merged = mergeCharacterPreviewAppearances([{ media_external_id: 'anime:1', relation_type: null }], provider.appearances);
    expect(merged[0].relation_type).toBeNull();
  });

  it('returns provider appearances untouched when the proposal has none', () => {
    expect(mergeCharacterPreviewAppearances([], provider.appearances)).toEqual(provider.appearances);
  });
});

describe('mergeCharacterPreviewActors', () => {
  it('fills a sparse proposed actor from the provider without letting nulls clobber it', () => {
    const merged = mergeCharacterPreviewActors(
      [{ external_id: 'person:a10', name: undefined, name_native: null, language: 'Japanese (dub)' }],
      provider.actors,
    );
    expect(merged).toEqual([{ ...providerActor, language: 'Japanese (dub)' }]);
  });

  it('keeps only the defined fields of an actor the provider does not know', () => {
    const merged = mergeCharacterPreviewActors([{ external_id: 'person:a11', name: 'New Actor', image_url: null }], provider.actors);
    expect(merged).toEqual([providerActor, { external_id: 'person:a11', name: 'New Actor' }]);
  });
});

describe('buildCharacterChangeSummary', () => {
  it('summarises a realistic proposal on top of provider data', () => {
    const current = characterBundle({
      character: { external_id: 'character:a1', name: 'Endou Mamoru', aliases_csv: 'Mark Evans, Endou' },
      appearances: [{ media_external_id: 'anime:1', relation_type: 'MAIN' }, { media_external_id: 'anime:2', relation_type: 'SUPPORTING' }],
      actors: [{ external_id: 'person:a10' }, { external_id: 'person:a11', name: 'New Actor' }],
      merged_character_external_ids: ['character:a99'],
    });
    const summary = buildCharacterChangeSummary(current, null, provider, i18n);
    expect(summary.groups).toEqual([
      { label: i18n.notifications.preview_character_data, added: 1, updated: 0, removed: 0 },
      { label: i18n.notifications.preview_appearances, added: 1, updated: 0, removed: 0 },
      { label: i18n.character_editor.merges, added: 1, updated: 0, removed: 0 },
      { label: i18n.notifications.preview_voice_actors, added: 1, updated: 0, removed: 0 },
    ]);
    expect(summary.characterChanges).toEqual({
      fields: { aliases_csv: 'added' },
      appearances: { 'anime:2': 'added' },
      actors: { 'person:a11': 'added' },
      merges: { 'character:a99': 'added' },
    });
    expect(summary.removedItems).toEqual([]);
    expect(summary.newRelationIds).toEqual([]);
  });

  it('reports a field blanked against upstream as removed when the provider has nothing either', () => {
    const previous = characterBundle({ character: { external_id: 'character:a1', name_native: 'X' } });
    const current = characterBundle({ character: { external_id: 'character:a1', name_native: null } });
    const summary = buildCharacterChangeSummary(current, previous, null, i18n);
    expect(summary.groups).toEqual([{ label: i18n.notifications.preview_character_data, added: 0, updated: 0, removed: 1 }]);
    expect(summary.characterChanges.fields).toEqual({ name_native: 'removed' });
  });

  it('treats AniList image size variants as the same image', () => {
    const previous = characterBundle({ character: { external_id: 'character:a1', image_url: 'https://s4.anilist.co/file/anilistcdn/character/large/b1-abc.png' } });
    const current = characterBundle({ character: { external_id: 'character:a1', image_url: 'https://s4.anilist.co/file/anilistcdn/character/medium/b1-abc.png' } });
    expect(buildCharacterChangeSummary(current, previous, null, i18n).groups).toEqual([]);
  });

  it('lists removed appearances, merges and actors for the removed-items strip', () => {
    const previous = characterBundle({
      appearances: [{ media_external_id: 'anime:2', relation_type: 'MAIN' }],
      actors: [{ external_id: 'person:a11', name: 'Old Actor' }],
      merged_character_external_ids: ['character:a99'],
    });
    const summary = buildCharacterChangeSummary(characterBundle(), previous, null, i18n);
    expect(summary.removedItems).toEqual([
      { id: 'anime:2', title: 'anime:2' },
      { id: 'character:a99', title: 'character:a99' },
      { id: 'person:a11', title: 'Old Actor' },
    ]);
    expect(summary.characterChanges.merges).toEqual({ 'character:a99': 'removed' });
  });

  it('reports an actor whose fields drift from the provider as updated', () => {
    const current = characterBundle({ actors: [{ external_id: 'person:a10', language: 'English' }] });
    const summary = buildCharacterChangeSummary(current, null, provider, i18n);
    expect(summary.groups).toEqual([{ label: i18n.notifications.preview_voice_actors, added: 0, updated: 1, removed: 0 }]);
    expect(summary.characterChanges.actors).toEqual({ 'person:a10': 'updated' });
  });
});
