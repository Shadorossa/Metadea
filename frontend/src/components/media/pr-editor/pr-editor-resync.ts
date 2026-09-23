// Pure merge helpers for handleResync, split out of PrEditorModal.tsx. The
// reducer's 'resync' action (pr-editor-state.ts) applies applyResyncToDraft
// to the latest draft, so a resync always merges against the current
// entry/editableRelations, never a stale closure snapshot.
import type { MediaCatalogEntry } from '../../../lib/tauri/catalog';
import type { DbMediaCharacter } from '../../../lib/tauri/characters';
import type { MediaPageData } from '../../../lib/media/types';
import { CANONICAL_RELATION_LABELS } from '../../../lib/media/saga/canonical-relations';
import { mapMediaDataToCatalogEntry } from '../../../lib/media/mappers/catalog-mapper';
import { setField } from '../../../lib/shared/collections/object-utils';
import type { BundledRelation, EditableRelation } from '../../../lib/media/editor/pr-editor-types';
import type { PrEditorDraft } from './pr-editor-state';

// Only fills fields currently empty — a live re-fetch must never overwrite a
// manual edit. Characters are taken from the live data only when the draft
// has none; relations/recommendations only gain ids not already present.
export function applyResyncToDraft(draft: PrEditorDraft, liveData: MediaPageData, externalId: string): PrEditorDraft {
  const partialFromLive = mapMediaDataToCatalogEntry(liveData, externalId);
  const newCharacters = buildResyncCharacters(liveData, draft.characters.length > 0);
  return {
    ...draft,
    entry: draft.entry ? mergeResyncFields(draft.entry, partialFromLive) : draft.entry,
    characters: newCharacters ?? draft.characters,
    editableRelations: appendResyncRelations(draft.editableRelations, liveData, externalId),
    recommendations: appendResyncRecommendations(draft.recommendations, liveData),
  };
}

// Only fills fields currently empty — a live re-fetch must never overwrite a manual edit.
export const RESYNC_FIELDS: (keyof MediaCatalogEntry)[] = [
  'title_main', 'title_romaji', 'title_native', 'title_english', 'synopsis',
  'cover_url', 'banners_csv', 'release_year', 'release_month', 'release_day',
  'release_end_year', 'release_end_month', 'release_end_day', 'status', 'format',
  'score_global', 'country_code', 'genres_csv', 'genres_tag_csv',
  'platforms_csv', 'shop_links_csv', 'source_url', 'time_length',
];

export function mergeResyncFields(prev: MediaCatalogEntry, partialFromLive: Partial<MediaCatalogEntry>): MediaCatalogEntry {
  const updated = { ...prev };
  for (const field of RESYNC_FIELDS) {
    const currentVal = prev[field];
    const liveVal = partialFromLive[field];
    const isCurrentEmpty = currentVal == null || currentVal === '';
    if (isCurrentEmpty && liveVal != null && liveVal !== '') {
      setField(updated, field, liveVal);
    }
  }
  return updated;
}

export function buildResyncCharacters(liveData: MediaPageData, hasExistingCharacters: boolean): DbMediaCharacter[] | null {
  if (hasExistingCharacters || !liveData.characters || liveData.characters.length === 0) return null;
  return liveData.characters
    .filter((c): c is typeof c & { id: string } => typeof c.id === 'string' && c.id.length > 0)
    .map(c => ({
    external_id: c.id,
    name: c.name,
    image_url: c.image || null,
    relation_type: c.role || null,
    }));
}

export function appendResyncRelations(prev: EditableRelation[], liveData: MediaPageData, externalId: string): EditableRelation[] {
  if (!liveData.relations || liveData.relations.length === 0) return prev;
  const existingIds = new Set(prev.map(r => r.related_media_external_id));
  const toAdd: any[] = [];
  for (const r of liveData.relations) {
    if (r.relationType !== 'RECOMMENDATION' && r.relatedExternalId && !existingIds.has(r.relatedExternalId)) {
      existingIds.add(r.relatedExternalId);
      toAdd.push({
        media_external_id: externalId,
        related_media_external_id: r.relatedExternalId,
        relation_type: r.relationType || 'RELATED',
        type_label: CANONICAL_RELATION_LABELS[r.relationType || ''] || r.typeLabel || 'Related',
        title: r.title || null,
        cover: r.cover || null,
        format: r.format || null,
      });
    }
  }
  return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
}

export function appendResyncRecommendations(prev: BundledRelation[], liveData: MediaPageData): BundledRelation[] {
  const existingIds = new Set(prev.map(r => r.external_id));
  const toAdd = (liveData.relations ?? [])
    .filter(r => r.relationType === 'RECOMMENDATION' && r.relatedExternalId && !existingIds.has(r.relatedExternalId))
    .map(r => ({ external_id: r.relatedExternalId!, title: r.title, cover: r.cover }));
  return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
}
