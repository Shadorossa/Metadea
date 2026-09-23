import { describe, it, expect } from 'vitest';
import type { MediaCatalogEntry } from '../tauri/catalog';
import type { ProposalBundle } from '../github/submit-collaborative-proposal';
import type { MediaPageData } from './types';
import { buildPreviewMediaPageData } from './media-page-preview';

const catalogEntry = (overrides: Partial<MediaCatalogEntry> = {}): MediaCatalogEntry => ({
  id: '', external_id: 'anime:1', type: 'anime', title_main: 'Proposal Title',
  created_at: '', updated_at: '', ...overrides,
} as MediaCatalogEntry);

const sourceData: MediaPageData = {
  externalId: 'anime:1', type: 'anime', titleMain: 'Source Title', description: 'Source synopsis',
  cover: 'source.jpg', bannerColor: 'linear-gradient(red)', metaLines: ['Studio X'],
  stats: [], progressStatus: 'watching', progressLabel: 'Viendo', source: 'anilist',
  characters: [{ id: 'char:1', name: 'Kept', image: 'kept.png' }, { id: 'char:2', name: 'Replaced' }],
  authors: [{ external_id: 'author:1', name: 'Author One' }],
  relations: [
    { typeLabel: 'Adaptación', relationType: 'ADAPTATION', title: 'Old', relatedExternalId: 'manga:1' },
    { typeLabel: 'Otro', relationType: 'OTHER', title: 'Untouched', relatedExternalId: 'anime:5' },
  ],
};

const bundle: ProposalBundle = {
  media_catalog: catalogEntry({ synopsis: null, cover_url: undefined, release_year: 2020 }),
  media_relations: [
    { media_external_id: 'anime:1', related_media_external_id: 'anime:2', relation_type: 'SEQUEL', type_label: 'Secuela', title: 'Sequel' },
    { media_external_id: 'anime:1', related_media_external_id: 'manga:1', relation_type: 'SOURCE', type_label: 'Origen', title: 'New' },
    // Belongs to another saga member's file — must not leak into this preview.
    { media_external_id: 'anime:2', related_media_external_id: 'anime:1', relation_type: 'PREQUEL', type_label: 'Precuela', title: 'Back' },
  ],
  characters: [{ external_id: 'char:2', name: 'Replaced (new)', image_url: 'new.png' }, { external_id: 'char:3', name: 'Added' }],
  media_authors: [{ external_id: 'author:2', name: 'Author Two' }],
};

describe('buildPreviewMediaPageData', () => {
  const preview = buildPreviewMediaPageData(bundle, null, sourceData);

  it('overlays only the proposal\'s non-null scalar fields on the provider data', () => {
    expect(preview.titleMain).toBe('Proposal Title');
    expect(preview.releaseYear).toBe(2020);
    expect(preview.description).toBe('Source synopsis');
    expect(preview.cover).toBe('source.jpg');
  });

  it('keeps provider-only presentation fields from the underlying work', () => {
    expect(preview.bannerColor).toBe('linear-gradient(red)');
    expect(preview.metaLines).toEqual(['Studio X']);
    expect(preview.source).toBe('anilist');
  });

  it('merges relations by target id, letting the proposal replace a same-target relation', () => {
    expect(preview.relations.map(r => [r.relatedExternalId, r.relationType, r.title])).toEqual([
      ['manga:1', 'SOURCE', 'New'],
      ['anime:5', 'OTHER', 'Untouched'],
      ['anime:2', 'SEQUEL', 'Sequel'],
    ]);
    expect(preview.hasSaga).toBe(true);
  });

  it('merges characters and authors by id, proposal wins', () => {
    expect(preview.characters).toEqual([
      { id: 'char:1', name: 'Kept', image: 'kept.png' },
      { id: 'char:2', hrefId: 'char:2', name: 'Replaced (new)', image: 'new.png', role: undefined },
      { id: 'char:3', hrefId: 'char:3', name: 'Added', image: undefined, role: undefined },
    ]);
    expect(preview.authors?.map(a => a.external_id)).toEqual(['author:1', 'author:2']);
    expect(preview.authors?.[1].url).toBe('/author?id=author:2');
  });

  it('falls back to the baseline catalog row (then the bundle itself) when there is no provider data', () => {
    const fromBaseline = buildPreviewMediaPageData(bundle, catalogEntry({ title_main: 'Baseline', synopsis: 'Baseline synopsis' }));
    expect(fromBaseline.titleMain).toBe('Proposal Title');
    expect(fromBaseline.description).toBe('Baseline synopsis');
    expect(fromBaseline.characters.map(c => c.id)).toEqual(['char:2', 'char:3']);

    const fromBundle = buildPreviewMediaPageData({ ...bundle, media_relations: [], characters: [], media_authors: [] }, null);
    expect(fromBundle.titleMain).toBe('Proposal Title');
    expect(fromBundle.relations).toEqual([]);
    expect(fromBundle.hasSaga).toBe(false);
  });
});
