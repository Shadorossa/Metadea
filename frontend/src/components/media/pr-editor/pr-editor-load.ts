// PrEditorModal's load() effect, split out since it reads no component
// state: the catalog entry itself (resolveCatalogEntryForEditor) and the
// relations/saga half (loadPrEditorRelationsAndSaga), each a pure
// computation of `externalId` alone.
import { getBlockedExternalIds, getCatalogEntryForEditor, getMediaRelationsForEditor } from '../../../lib/tauri/catalog';
import type { MediaCatalogEntry, DbMediaRelation } from '../../../lib/tauri/catalog';
import { invoke } from '../../../lib/tauri';
import { fetchMediaDataInternal } from '../../../lib/media/media-page-data';
import { mapMediaDataToCatalogEntry } from '../../../lib/media/mappers/catalog-mapper';
import { comicVineGetIssues } from '../../../lib/tauri/comicvine';
import {
  BUNDLE_RELATION_TYPES, PART_OF_RELATION_TYPES, CONTAINS_RELATION_TYPES,
  isSagaRelationType, normalizeLegacyRelationType, type SagaRelationType,
} from '../../../lib/media/saga/saga-relation-types';
import { reconstructSagaOrder, type MediaMeta } from '../../../lib/media/saga/saga-grouping';
import { compareByReleaseDate } from '../../../lib/media/mappers/mapper-utils';
import { CANONICAL_RELATION_LABELS } from '../../../lib/media/saga/canonical-relations';
import type { BundledRelation } from '../../../lib/media/editor/pr-editor-types';
import type { PrEditorDraft } from './pr-editor-state';

// The draft fields this loader fills in — the modal dispatches them as one
// 'load' (both baseline and draft). The catalog entry, bundle children,
// characters and authors are loaded separately.
export type PrEditorLoadedDraft = Pick<PrEditorDraft,
  'bundledRelations' | 'containedRelations' | 'editableRelations' | 'recommendations' | 'issueRelations'
  | 'sagaOrder' | 'sagaRelationTypes' | 'sagaGroups' | 'sagaName'>;

// The catalog row to edit, or a blank one for an id not in the catalog yet.
// Null when the read failed for an entry that isn't blocked either — the
// modal shows its local-read error for that.
export async function resolveCatalogEntryForEditor(externalId: string): Promise<MediaCatalogEntry | null> {
  try {
    const res = await getCatalogEntryForEditor(externalId);
    return res ?? {
      id: '',
      external_id: externalId,
      type: externalId.split(':')[0],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  } catch (err) {
    console.error('Failed to get catalog entry:', err);
    // An older running Tauri binary may not yet have the editor-only
    // command compiled in. The blocked-id command is older and lets the
    // modal preserve the active removal state instead of presenting a
    // misleading enabled-looking button.
    const blockedIds = await getBlockedExternalIds().catch(() => [] as string[]);
    if (!blockedIds.includes(externalId)) return null;
    const now = new Date().toISOString();
    const liveData = await fetchMediaDataInternal(externalId, true).catch(() => null);
    return {
      ...(liveData ? mapMediaDataToCatalogEntry(liveData, externalId) : {}),
      id: '',
      external_id: externalId,
      type: liveData?.type ?? externalId.split(':')[0],
      blocked_at: 'blocked',
      created_at: now,
      updated_at: now,
    };
  }
}

// The issue list a ComicVine volume resolves to, as relation cards — issues
// without a cover are skipped since the card is the cover.
export async function loadComicVineIssuePreview(volumeId: number, baseType: string): Promise<BundledRelation[]> {
  const issues = await comicVineGetIssues(volumeId);
  return issues.flatMap(issue => {
    const cover = issue.image?.medium_url || issue.image?.small_url;
    if (!cover) return [];
    const number = issue.issue_number ? `#${issue.issue_number}` : '';
    const name = issue.name ? ` - ${issue.name}` : '';
    return [{
      external_id: `${baseType}:issue-${issue.id}`,
      title: number + name || `#${issue.id}`,
      cover,
    }];
  });
}

export interface PrEditorRelationsAndSagaResult {
  draft: PrEditorLoadedDraft;
  // Re-fetched via the transitive-ids expansion below — callers should prefer
  // this over whatever the sibling try block's getCatalogEntry resolved.
  currentEntry: MediaCatalogEntry | null;
  // Display-only metadata (cover/title) for saga members other than this
  // entry, so tags can show a thumbnail instead of a bare id.
  sagaMeta: Record<string, MediaMeta>;
}

export async function loadPrEditorRelationsAndSaga(externalId: string): Promise<PrEditorRelationsAndSagaResult> {
  const rels = await getMediaRelationsForEditor(externalId).catch(() => [] as DbMediaRelation[]);

  // Each of these sections is a plain list of related ids; the ids it
  // started out with are derived from the baseline (pr-editor-state.ts)
  // when the modal diffs against them on submit.
  const summarize = (matches: (r: DbMediaRelation) => boolean): BundledRelation[] =>
    rels.filter(matches).map(r => ({
      external_id: r.related_media_external_id,
      title: r.title,
      cover: r.cover,
    }));

  // Bundled In (PART_OF/UPDATE) vs. Contains (EPISODE) are opposite directions
  // of the same relationship; BUNDLE_RELATION_TYPES covers both for excluding them below.
  const bundledRelations = summarize(r => PART_OF_RELATION_TYPES.includes(r.relation_type));
  const containedRelations = summarize(r => CONTAINS_RELATION_TYPES.includes(r.relation_type));
  // ComicVine issues — split out of editableRelations into their own
  // section since their titles are often just a bare issue number, which
  // used to clutter the general Relations grid with a wall of numbers.
  const issueRelations = summarize(r => r.relation_type === 'ISSUE');
  const recommendations = summarize(r => r.relation_type === 'RECOMMENDATION');

  const transitiveIds = await invoke<string[]>('get_transitive_relation_ids', { mediaExternalId: externalId }).catch(() => [] as string[]);
  if (!transitiveIds.includes(externalId)) transitiveIds.push(externalId);
  const sagaMemberIds = new Set(transitiveIds);

  // Everything not Bundled In, not an ISSUE, and not targeting a saga member
  // — anything targeting a saga member is re-derived by the saga chain
  // builder instead.
  const editableRelations = rels
    .filter(r => !BUNDLE_RELATION_TYPES.includes(r.relation_type) && r.relation_type !== 'ISSUE'
      && r.relation_type !== 'RECOMMENDATION' && !sagaMemberIds.has(r.related_media_external_id))
    .map(r => {
      // Pre-canonical-keys rows still carry the raw English label (e.g. "Expanded Edition").
      const relationType = normalizeLegacyRelationType(r.relation_type);
      return {
        related_media_external_id: r.related_media_external_id,
        relation_type: relationType,
        type_label: CANONICAL_RELATION_LABELS[relationType] || r.type_label || relationType,
        title: r.title,
        cover: r.cover,
      };
    });

  const entriesData = await Promise.all(
    transitiveIds.map(async id => ({ id, entry: await getCatalogEntryForEditor(id).catch(() => null) }))
  );
  const validEntries = entriesData.filter((x): x is { id: string; entry: MediaCatalogEntry } => x.entry !== null);

  const currentEntry = validEntries.find(x => x.id === externalId)?.entry ?? null;

  validEntries.sort((a, b) => compareByReleaseDate(
    { ...a.entry, id: a.id },
    { ...b.entry, id: b.id }
  ));

  const sortedIds = validEntries.map(x => x.id);

  const sagaMeta: Record<string, MediaMeta> = {};
  for (const x of validEntries) {
    sagaMeta[x.id] = { title: x.entry.title_main || x.id, cover: x.entry.cover_url || null, release_year: x.entry.release_year ?? null };
  }

  // Bootstraps sagaRelationTypes/sagaGroups from existing SOURCE/EPISODE/
  // UPDATE/ALTERNATIVE edges — a one-time reverse-engineering of prior state.
  // sagaGroups (which ids are "alternate versions" of each other, and under
  // what curator-chosen name) is derived purely from ALTERNATIVE edges below,
  // never persisted in its own column — the relation graph (specifically the
  // part of type_label before its trailing " #N" position marker, written by
  // pr-editor-submit.ts) is the durable source of truth for both the
  // clustering itself and the name attached to it.
  const [allRelsList, dbSagaName] = await Promise.all([
    Promise.all(sortedIds.map(id => getMediaRelationsForEditor(id).catch(() => [] as DbMediaRelation[]))),
    invoke<string | null>('get_saga_name', { mediaExternalId: externalId }).catch(() => null),
  ]);
  // Reconstructed from SEQUEL edges, not release-date order alone, so a manual reorder survives a reload.
  const sagaOrder = reconstructSagaOrder(sortedIds, allRelsList);

  const sagaRelationTypes: Record<string, SagaRelationType> = {};
  const sagaGroups: Record<string, string> = {};
  let nextGroupNum = 1;

  for (let i = 0; i < sortedIds.length; i++) {
    const ownerId = sortedIds[i];
    for (const r of allRelsList[i]) {
      const otherId = r.related_media_external_id;
      if (r.relation_type === 'ALTERNATIVE') {
        if (!sagaGroups[ownerId] && !sagaGroups[otherId]) {
          // Recover the curator's own group name (everything before the
          // trailing " #N") instead of always minting a fresh "Group N" —
          // that used to silently discard whatever name was actually typed
          // in, every single reload. "Alternative Version" is the sentinel
          // pr-editor-submit.ts writes when nobody named the group at all,
          // so that case still falls back to an auto name here too.
          const match = /^(.*?)\s*#\d+$/.exec(r.type_label || '');
          const persisted = match ? match[1].trim() : '';
          const name = persisted && persisted !== 'Alternative Version' ? persisted : `Group ${nextGroupNum++}`;
          sagaGroups[ownerId] = sagaGroups[otherId] = name;
        } else if (sagaGroups[ownerId] && !sagaGroups[otherId]) {
          sagaGroups[otherId] = sagaGroups[ownerId];
        } else if (!sagaGroups[ownerId] && sagaGroups[otherId]) {
          sagaGroups[ownerId] = sagaGroups[otherId];
        }
      } else {
        const lower = r.relation_type.toLowerCase();
        if (isSagaRelationType(lower) && lower !== 'main') {
          sagaRelationTypes[otherId] = lower;
        }
      }
    }
  }

  return {
    draft: {
      bundledRelations,
      containedRelations,
      editableRelations,
      recommendations,
      issueRelations,
      sagaOrder,
      sagaRelationTypes,
      sagaGroups,
      sagaName: dbSagaName || '',
    },
    currentEntry,
    sagaMeta,
  };
}
