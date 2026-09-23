import { describe, it, expect } from 'vitest';
import type { MediaCatalogEntry } from '../../../lib/tauri/catalog';
import {
  affectedExternalIds, charactersChanged, createInitialPrEditorState, getPrEditorDiff, hasChanges,
  originalBundledIds, originalEditableRelationTypes, originalRecommendationIds, prEditorReducer,
  type PrEditorDraft, type PrEditorState,
} from './pr-editor-state';
import { buildPrEditorChangeSummary } from './pr-editor-change-summary';

const ID = 'anime:1';
const CTX = { externalId: ID, recommendationLabel: 'Recommendation' };

function catalog(overrides: Partial<MediaCatalogEntry> = {}): MediaCatalogEntry {
  return { id: 'row-1', external_id: ID, type: 'anime', title_main: 'Inazuma Eleven', created_at: '', updated_at: '', ...overrides };
}

// What a real load dispatches: the entry, every relation list, the saga
// chain (this entry plus one sequel, one 'source' member), cast and staff.
function loadedFixture(): Partial<PrEditorDraft> {
  return {
    entry: catalog({ synopsis: 'Old synopsis', release_year: 2008 }),
    bundledRelations: [{ external_id: 'anime:5', title: 'Movie', cover: null }],
    containedRelations: [],
    editableRelations: [
      { related_media_external_id: 'manga:3', relation_type: 'ADAPTATION', type_label: 'Adaptation', title: 'IE Manga', cover: null },
      { related_media_external_id: 'game:4', relation_type: 'SOURCE', type_label: 'Source', title: 'IE Game', cover: null },
    ],
    recommendations: [{ external_id: 'anime:6', title: 'Rec', cover: null }],
    issueRelations: [],
    sagaOrder: [ID, 'anime:2', 'anime:8'],
    sagaRelationTypes: { 'anime:8': 'source' },
    sagaGroups: {},
    sagaName: 'Inazuma',
    characters: [{ external_id: 'char:1', name: 'Endou', image_url: null, relation_type: 'MAIN', character_name: null }],
    mediaAuthors: [{ external_id: 'author:1', name: 'Level-5' }],
  };
}

function loaded(): PrEditorState {
  return prEditorReducer(createInitialPrEditorState(ID), { type: 'load', patch: loadedFixture() });
}

describe('prEditorReducer', () => {
  it('starts with this entry as the only saga member and no changes', () => {
    const state = createInitialPrEditorState(ID);
    expect(state.draft.sagaOrder).toEqual([ID]);
    expect(state.baseline.sagaOrder).toEqual([ID]);
    // No entry loaded yet — nothing to compare, so never dirty.
    expect(hasChanges(state, CTX)).toBe(false);
  });

  it('load sets baseline and draft alike, so a fresh load has no changes', () => {
    const state = loaded();
    expect(state.draft).toEqual(state.baseline);
    expect(hasChanges(state, CTX)).toBe(false);
    expect(charactersChanged(state)).toBe(false);
    expect(affectedExternalIds(state, CTX)).toEqual([]);
  });

  it('load keeps the baseline entry as stored but forces a movie to one episode in the draft', () => {
    const state = prEditorReducer(createInitialPrEditorState('movie:9'), {
      type: 'load', patch: { entry: catalog({ external_id: 'movie:9', type: 'movie', total_count: 3 }) },
    });
    expect(state.baseline.entry?.total_count).toBe(3);
    expect(state.draft.entry?.total_count).toBe(1);
    expect(hasChanges(state, { ...CTX, externalId: 'movie:9' })).toBe(true);
  });

  it('a later partial load (e.g. bundle children) leaves the rest untouched on both sides', () => {
    const state = prEditorReducer(loaded(), { type: 'load', patch: { bundleChildren: [{ external_id: 'game:7' }] } });
    expect(state.baseline.bundleChildren).toEqual([{ external_id: 'game:7' }]);
    expect(state.draft.bundleChildren).toEqual([{ external_id: 'game:7' }]);
    expect(state.draft.entry).toEqual(loadedFixture().entry);
    expect(hasChanges(state, CTX)).toBe(false);
  });

  it('edit changes the draft only and marks the state dirty', () => {
    const state = prEditorReducer(loaded(), { type: 'edit', patch: { sagaName: 'Renamed' } });
    expect(state.draft.sagaName).toBe('Renamed');
    expect(state.baseline.sagaName).toBe('Inazuma');
    expect(hasChanges(state, CTX)).toBe(true);
  });

  it('a function patch reads the latest draft', () => {
    const state = prEditorReducer(loaded(), { type: 'edit', patch: d => ({ sagaOrder: [...d.sagaOrder, 'anime:9'] }) });
    expect(state.draft.sagaOrder).toEqual([ID, 'anime:2', 'anime:8', 'anime:9']);
  });

  it('an edit that changes nothing returns the same state object', () => {
    const before = loaded();
    expect(prEditorReducer(before, { type: 'edit', patch: {} })).toBe(before);
    expect(prEditorReducer(before, { type: 'edit', patch: d => ({ characters: d.characters }) })).toBe(before);
  });

  it('reset restores the draft to the baseline', () => {
    const edited = prEditorReducer(loaded(), { type: 'edit', patch: { sagaName: 'Renamed', characters: [] } });
    expect(hasChanges(edited, CTX)).toBe(true);
    const state = prEditorReducer(edited, { type: 'reset' });
    expect(state.draft).toEqual(state.baseline);
    expect(hasChanges(state, CTX)).toBe(false);
  });

  it('flags every kind of change the old inline check did', () => {
    const base = loaded();
    const dirty = (patch: Partial<PrEditorDraft>) => hasChanges(prEditorReducer(base, { type: 'edit', patch }), CTX);
    expect(dirty({ entry: catalog({ ...base.draft.entry, blocked_at: '2024-01-01' }) })).toBe(true);
    expect(dirty({ entry: catalog({ ...base.draft.entry, synopsis: 'New' }) })).toBe(true);
    expect(dirty({ characters: [{ ...base.draft.characters[0], relation_type: 'SUPPORTING' }] })).toBe(true);
    expect(dirty({ bundledRelations: [] })).toBe(true);
    expect(dirty({ containedRelations: [{ external_id: 'anime:10' }] })).toBe(true);
    expect(dirty({ editableRelations: base.draft.editableRelations.slice(1) })).toBe(true);
    expect(dirty({ recommendations: [] })).toBe(true);
    expect(dirty({ issueRelations: [{ external_id: 'comic:issue-1' }] })).toBe(true);
    expect(dirty({ sagaOrder: [ID, 'anime:8', 'anime:2'] })).toBe(true);
    expect(dirty({ sagaRelationTypes: { 'anime:8': 'episode' } })).toBe(true);
    expect(dirty({ sagaGroups: { [ID]: 'Group 1', 'anime:2': 'Group 1' } })).toBe(true);
    // Normalized comparisons: 'main' is the implicit type, whitespace-only
    // group names are no group.
    expect(dirty({ sagaRelationTypes: { 'anime:8': 'source', 'anime:2': 'main' } })).toBe(false);
    expect(dirty({ sagaGroups: { [ID]: '  ' } })).toBe(false);
  });
});

describe('derived baseline ids', () => {
  it('rebuilds the original id sets and type map exactly as the loader used to', () => {
    const state = loaded();
    expect(originalBundledIds(state)).toEqual(new Set(['anime:5']));
    expect(originalRecommendationIds(state)).toEqual(new Set(['anime:6']));
    expect(originalEditableRelationTypes(state)).toEqual(new Map([['manga:3', 'ADAPTATION'], ['game:4', 'SOURCE']]));
  });
});

describe('getPrEditorDiff', () => {
  it('reports nothing for a fresh load', () => {
    const d = getPrEditorDiff(loaded(), CTX);
    expect(Object.values(d).every(v => Array.isArray(v) ? v.length === 0 : v === false)).toBe(true);
  });

  it('computes every added/removed/changed list the submit path relies on', () => {
    // One realistic session: swap the bundle, retype one relation and drop
    // the other, drop the recommendation and add a new one, add an issue,
    // add a saga member and reorder, drop the character and the author.
    const state = prEditorReducer(loaded(), { type: 'edit', patch: {
      bundledRelations: [{ external_id: 'anime:7', title: 'Special', cover: null }],
      editableRelations: [{ related_media_external_id: 'manga:3', relation_type: 'SPIN_OFF', type_label: 'Spin-off', title: 'IE Manga', cover: null }],
      recommendations: [{ external_id: 'anime:11', title: 'New rec', cover: null }],
      issueRelations: [{ external_id: 'anime:issue-1', title: '#1', cover: 'c.png' }],
      sagaOrder: [ID, 'anime:9', 'anime:2', 'anime:8'],
      characters: [],
      mediaAuthors: [],
    } });
    const d = getPrEditorDiff(state, CTX);

    expect(d.addedBundled).toEqual([{ external_id: 'anime:7', title: 'Special', cover: null }]);
    expect(d.removedBundledIds).toEqual(['anime:5']);
    expect(d.addedContained).toEqual([]);
    expect(d.removedContainedIds).toEqual([]);
    expect(d.addedBundleChildren).toEqual([]);
    expect(d.removedBundleChildIds).toEqual([]);
    // Recommendations ride along as RECOMMENDATION-typed editable relations,
    // labelled with the caller's recommendation label.
    expect(d.addedEditableRelations).toEqual([
      { related_media_external_id: 'anime:11', relation_type: 'RECOMMENDATION', type_label: 'Recommendation', title: 'New rec', cover: null },
    ]);
    expect(d.removedEditableRelationIds).toEqual(['game:4', 'anime:6']);
    expect(d.changedEditableRelations.map(r => r.related_media_external_id)).toEqual(['manga:3']);
    expect(d.addedIssues).toEqual([{ external_id: 'anime:issue-1', title: '#1', cover: 'c.png' }]);
    expect(d.removedIssueIds).toEqual([]);
    expect(d.addedSaga).toEqual(['anime:9']);
    expect(d.removedSaga).toEqual([]);
    expect(d.sagaOrderChanged).toBe(true);
    expect(d.relTypesChanged).toBe(false);
    expect(d.groupsChanged).toBe(false);
    expect(d.sagaNameChanged).toBe(false);
    expect(d.removedCharacterIds).toEqual(['char:1']);
    expect(d.removedAuthorIds).toEqual(['author:1']);

    // This entry itself never counts as added/removed, but the reorder
    // touches every other member.
    expect(affectedExternalIds(state, CTX)).toEqual([
      'anime:7', 'anime:5', 'anime:11', 'game:4', 'anime:6', 'manga:3', 'anime:issue-1', 'anime:9', 'anime:2', 'anime:8',
    ]);
  });

  it('a removed saga member is reported without this entry and never as added', () => {
    const state = prEditorReducer(loaded(), { type: 'edit', patch: { sagaOrder: [ID, 'anime:2'] } });
    const d = getPrEditorDiff(state, CTX);
    expect(d.removedSaga).toEqual(['anime:8']);
    expect(d.addedSaga).toEqual([]);
    expect(d.sagaOrderChanged).toBe(true);
  });
});

describe('buildPrEditorChangeSummary (state-derived)', () => {
  it('is empty without an entry and derives field/relation/character lines from the state pair', () => {
    expect(buildPrEditorChangeSummary(createInitialPrEditorState(ID), CTX, () => ({ title: null, cover: null }))).toBe('');

    const base = loaded();
    const state = prEditorReducer(base, { type: 'edit', patch: {
      entry: catalog({ ...base.draft.entry, synopsis: 'New synopsis' }),
      bundledRelations: [],
      characters: [],
    } });
    const summary = buildPrEditorChangeSummary(state, CTX, id => ({ title: id === 'anime:5' ? 'Movie' : null, cover: null }));
    expect(summary).toBe([
      '- Changed Synopsis: "Old synopsis" → "New synopsis"',
      '- Removed Bundled In: Movie (anime:5)',
      '- Characters: 0 character(s)',
      '- Includes 1 cached author/staff credit(s)',
    ].join('\n'));
  });
});
