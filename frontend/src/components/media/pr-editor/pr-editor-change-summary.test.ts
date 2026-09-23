import { describe, it, expect } from 'vitest';
import type { MediaCatalogEntry } from '../../../lib/tauri/catalog';
import { formatPrEditorChangeSummary as buildPrEditorChangeSummary, type BuildChangeSummaryParams, type PrEditorChangeSummaryDiff } from './pr-editor-change-summary';

const NO_CHANGES = '- No field changes detected (metadata refresh only)';

function catalog(overrides: Partial<MediaCatalogEntry> = {}): MediaCatalogEntry {
  return { id: 'row-1', external_id: 'anime:1', type: 'anime', title_main: 'Inazuma Eleven', created_at: '', updated_at: '', ...overrides };
}

function emptyDiff(overrides: Partial<PrEditorChangeSummaryDiff> = {}): PrEditorChangeSummaryDiff {
  return {
    addedBundled: [], removedBundledIds: [], addedContained: [], removedContainedIds: [],
    addedEditableRelations: [], removedEditableRelationIds: [], changedEditableRelations: [],
    addedSaga: [], removedSaga: [], sagaOrderChanged: false, relTypesChanged: false, groupsChanged: false, sagaNameChanged: false,
    ...overrides,
  };
}

function params(overrides: Partial<BuildChangeSummaryParams> = {}): BuildChangeSummaryParams {
  return {
    entry: catalog(), originalEntry: catalog(), isFieldChanged: () => false, diff: emptyDiff(),
    resolveMeta: () => ({ title: null, cover: null }), originalEditableRelationTypes: new Map(),
    sagaOrder: [], sagaRelationTypes: {}, sagaName: '', originalSagaName: '',
    charactersChanged: false, charactersCount: 0, mediaAuthorsCount: 0,
    ...overrides,
  };
}

const titled = (id: string) => ({ title: id === 'anime:2' ? 'Inazuma Eleven 2' : null, cover: null });

describe('buildPrEditorChangeSummary', () => {
  it('reports a metadata-only refresh when nothing changed', () => {
    expect(buildPrEditorChangeSummary(params())).toBe(NO_CHANGES);
  });

  it('reports blocking and unblocking', () => {
    expect(buildPrEditorChangeSummary(params({ entry: catalog({ blocked_at: '2024-01-01' }), originalEntry: catalog({ blocked_at: null }) })))
      .toBe('- Blocked (hidden from Metadea)');
    expect(buildPrEditorChangeSummary(params({ entry: catalog({ blocked_at: null }), originalEntry: catalog({ blocked_at: '2024-01-01' }) })))
      .toBe('- Unblocked (restored to Metadea)');
  });

  // Characterization: a brand-new entry (no original) whose blocked_at is
  // an explicit null reads as "unblocked" because null !== undefined.
  it('reports a new entry with an explicit null blocked_at as unblocked', () => {
    expect(buildPrEditorChangeSummary(params({ entry: catalog({ blocked_at: null }), originalEntry: null })))
      .toBe('- Unblocked (restored to Metadea)');
    expect(buildPrEditorChangeSummary(params({ entry: catalog(), originalEntry: null }))).toBe(NO_CHANGES);
  });

  it('formats an added, removed and changed field with its DIFF_FIELDS label', () => {
    const changed = new Set<keyof MediaCatalogEntry>(['synopsis', 'cover_url', 'release_year']);
    const summary = buildPrEditorChangeSummary(params({
      entry: catalog({ synopsis: 'New', cover_url: null, release_year: 2009 }),
      originalEntry: catalog({ synopsis: null, cover_url: 'old.png', release_year: 2008 }),
      isFieldChanged: field => changed.has(field),
    }));
    expect(summary).toBe([
      '- Added Synopsis: "New"',
      '- Removed Cover URL (was "old.png")',
      '- Changed Release Year: "2008" → "2009"',
    ].join('\n'));
  });

  it('treats an empty string like a missing value', () => {
    const summary = buildPrEditorChangeSummary(params({
      entry: catalog({ synopsis: '' }), originalEntry: catalog({ synopsis: 'Old' }), isFieldChanged: field => field === 'synopsis',
    }));
    expect(summary).toBe('- Removed Synopsis (was "Old")');
  });

  it('only reports fields the caller marks as changed, in DIFF_FIELDS order', () => {
    const summary = buildPrEditorChangeSummary(params({
      entry: catalog({ title_main: 'B', format: 'TV' }), originalEntry: catalog({ title_main: 'A', format: 'OVA' }),
      isFieldChanged: field => field === 'format' || field === 'title_main',
    }));
    expect(summary).toBe('- Changed Main Title: "A" → "B"\n- Changed Format: "OVA" → "TV"');
  });

  it('truncates long values and hides base64 images', () => {
    const long = 'x'.repeat(200);
    const summary = buildPrEditorChangeSummary(params({
      entry: catalog({ synopsis: long, cover_url: 'data:image/png;base64,AAAA' }), originalEntry: null,
      isFieldChanged: field => field === 'synopsis' || field === 'cover_url',
    }));
    expect(summary).toBe(`- Added Synopsis: "${'x'.repeat(150)}..."\n- Added Cover URL: "(imagen base64)"`);
  });

  it('formats a work with its title, a resolved title, or the bare id', () => {
    const summary = buildPrEditorChangeSummary(params({
      resolveMeta: titled,
      diff: emptyDiff({
        addedBundled: [{ external_id: 'anime:5', title: 'Movie' }],
        removedBundledIds: ['anime:2'],
        addedContained: [{ external_id: 'anime:7', title: null }],
        removedContainedIds: ['anime:8'],
      }),
    }));
    expect(summary).toBe([
      '- Added Bundled In: Movie (anime:5)',
      '- Removed Bundled In: Inazuma Eleven 2 (anime:2)',
      '- Added Contains: anime:7',
      '- Removed Contains: anime:8',
    ].join('\n'));
  });

  it('describes editable relation additions, removals and type changes', () => {
    const summary = buildPrEditorChangeSummary(params({
      originalEditableRelationTypes: new Map([['anime:2', 'ADAPTATION']]),
      diff: emptyDiff({
        addedEditableRelations: [{ related_media_external_id: 'manga:3', relation_type: 'ADAPTATION', type_label: 'Adaptation', title: 'IE Manga' }],
        removedEditableRelationIds: ['anime:4'],
        changedEditableRelations: [{ related_media_external_id: 'anime:2', relation_type: 'SPIN_OFF', type_label: 'Spin-off', title: 'IE 2' }],
      }),
    }));
    expect(summary).toBe([
      '- Added Relation: IE Manga (manga:3) (Adaptation)',
      '- Removed Relation: anime:4',
      '- Changed Relation Type: IE 2 (anime:2) (ADAPTATION → SPIN_OFF)',
    ].join('\n'));
  });

  it('shows an empty previous type when the changed relation was not in the original map', () => {
    const summary = buildPrEditorChangeSummary(params({
      diff: emptyDiff({ changedEditableRelations: [{ related_media_external_id: 'anime:2', relation_type: 'SPIN_OFF', type_label: 'Spin-off' }] }),
    }));
    expect(summary).toBe('- Changed Relation Type: anime:2 ( → SPIN_OFF)');
  });

  it('describes saga membership changes with each member type', () => {
    const summary = buildPrEditorChangeSummary(params({
      resolveMeta: titled,
      sagaRelationTypes: { 'anime:2': 'source', 'anime:3': 'main' },
      sagaName: 'Inazuma', originalSagaName: 'Old',
      diff: emptyDiff({ addedSaga: ['anime:2', 'anime:9'], removedSaga: ['anime:3'], sagaNameChanged: true }),
    }));
    expect(summary).toBe([
      '- Changed Saga Name: "Old" → "Inazuma"',
      '- Added to Saga: Inazuma Eleven 2 (anime:2) [type: source]',
      '- Added to Saga: anime:9 [type: main]',
      '- Removed from Saga: anime:3',
    ].join('\n'));
  });

  it('labels a pure reorder differently from an order that follows membership changes', () => {
    const base = { sagaOrder: ['anime:1', 'anime:2'], sagaRelationTypes: { 'anime:2': 'episode' as const } };
    expect(buildPrEditorChangeSummary(params({ ...base, diff: emptyDiff({ sagaOrderChanged: true }) })))
      .toBe('- Reordered Saga: anime:1 [type: main] → anime:2 [type: episode]');
    expect(buildPrEditorChangeSummary(params({ ...base, diff: emptyDiff({ sagaOrderChanged: true, addedSaga: ['anime:2'] }) })))
      .toBe('- Added to Saga: anime:2 [type: episode]\n- Saga order: anime:1 [type: main] → anime:2 [type: episode]');
  });

  it('collapses relation-type or group changes without a reorder into one line', () => {
    expect(buildPrEditorChangeSummary(params({ diff: emptyDiff({ relTypesChanged: true }) }))).toBe('- Updated Saga relations/groups');
    expect(buildPrEditorChangeSummary(params({ diff: emptyDiff({ groupsChanged: true }) }))).toBe('- Updated Saga relations/groups');
  });

  it('reports character and author counts', () => {
    expect(buildPrEditorChangeSummary(params({ charactersChanged: true, charactersCount: 3, mediaAuthorsCount: 2 })))
      .toBe('- Characters: 3 character(s)\n- Includes 2 cached author/staff credit(s)');
    expect(buildPrEditorChangeSummary(params({ charactersCount: 3 }))).toBe('- Includes 3 cached character(s)');
    expect(buildPrEditorChangeSummary(params({ charactersChanged: true, charactersCount: 0 }))).toBe('- Characters: 0 character(s)');
  });
});
