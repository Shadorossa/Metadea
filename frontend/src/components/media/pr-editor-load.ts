// The relations/saga half of PrEditorModal's load() effect, split out
// because it's a fully self-contained computation of `externalId` alone —
// no component state is read, only written afterward via the returned
// result. (The catalog-entry half stays in the component: it's a separate,
// independently-caught try block that sets `entry`/`originalEntry` on its
// own before this one even starts.)
import { getCatalogEntry, getMediaRelationsForEditor, getMediaSagaGroups } from '../../lib/tauri/catalog';
import type { MediaCatalogEntry, DbMediaRelation } from '../../lib/tauri/catalog';
import { invoke } from '../../lib/tauri';
import {
  BUNDLE_RELATION_TYPES, PART_OF_RELATION_TYPES, CONTAINS_RELATION_TYPES,
  isSagaRelationType, normalizeLegacyRelationType, type SagaRelationType,
} from '../../lib/media/sagaTypes';
import { reconstructSagaOrder, type MediaMeta } from '../../lib/media/sagaGrouping';
import { compareByReleaseDate } from '../../lib/media/mapper-utils';
import { CANONICAL_RELATION_LABELS } from '../../lib/media/canonical-relations';
import type { BundledRelation, EditableRelation } from './PrEditorModal';

export interface PrEditorRelationsAndSagaResult {
  bundledRelations: BundledRelation[];
  originalBundledIds: Set<string>;
  containedRelations: BundledRelation[];
  originalContainedIds: Set<string>;
  editableRelations: EditableRelation[];
  originalEditableRelationTypes: Map<string, string>;
  // Set when the transitive-ids expansion below re-fetched this entry's own
  // catalog row (already sorted alongside the rest of the saga) — the
  // caller should prefer this over whatever getCatalogEntry(externalId)
  // resolved in the sibling try block, same as the original inline code did.
  currentEntry: MediaCatalogEntry | null;
  sagaMeta: Record<string, MediaMeta>;
  sagaOrder: string[];
  originalSagaOrder: string[];
  sagaRelationTypes: Record<string, SagaRelationType>;
  originalSagaRelationTypes: Record<string, SagaRelationType>;
  sagaGroups: Record<string, string>;
  originalSagaGroups: Record<string, string>;
  sagaName: string;
  originalSagaName: string;
}

export async function loadPrEditorRelationsAndSaga(externalId: string): Promise<PrEditorRelationsAndSagaResult> {
  const rels = await getMediaRelationsForEditor(externalId).catch(() => [] as DbMediaRelation[]);

  // Bundled In (this entry belongs to something else — PART_OF/UPDATE)
  // vs. Contains (something else belongs to this entry — EPISODE) are
  // opposite directions of the same relationship; BUNDLE_RELATION_TYPES
  // covers both only for excluding them from the plain Relations list
  // below.
  const bundledRelations = rels
    .filter(r => PART_OF_RELATION_TYPES.includes(r.relation_type))
    .map(r => ({
      external_id: r.related_media_external_id,
      title: r.title,
      cover: r.cover,
    }));
  const originalBundledIds = new Set(bundledRelations.map(r => r.external_id));

  const containedRelations = rels
    .filter(r => CONTAINS_RELATION_TYPES.includes(r.relation_type))
    .map(r => ({
      external_id: r.related_media_external_id,
      title: r.title,
      cover: r.cover,
    }));
  const originalContainedIds = new Set(containedRelations.map(r => r.external_id));

  const transitiveIds = await invoke<string[]>('get_transitive_relation_ids', { mediaExternalId: externalId }).catch(() => [] as string[]);
  if (!transitiveIds.includes(externalId)) transitiveIds.push(externalId);
  const sagaMemberIds = new Set(transitiveIds);

  // Everything that isn't Bundled In and doesn't target a saga-chain
  // member shows up here — every existing relation the entry already
  // had (ADAPTATION, SPIN_OFF, ALTERNATIVE outside the saga, CHARACTER,
  // OTHER, ...), not just a fixed whitelist. Anything targeting a saga
  // member is re-derived by the saga chain builder on save instead.
  const editableRelations = rels
    .filter(r => !BUNDLE_RELATION_TYPES.includes(r.relation_type) && !sagaMemberIds.has(r.related_media_external_id))
    .map(r => {
      // Rows saved before game relations used canonical type keys
      // (see igdb-mapper.ts) still carry the raw English label as
      // relation_type (e.g. "Expanded Edition") — normalize on load so
      // the dropdown pre-selects the real, localized option instead of
      // rendering it as an extra unlocalized duplicate.
      const relationType = normalizeLegacyRelationType(r.relation_type);
      return {
        related_media_external_id: r.related_media_external_id,
        relation_type: relationType,
        type_label: (CANONICAL_RELATION_LABELS as any)[relationType] || r.type_label || relationType,
        title: r.title,
        cover: r.cover,
      };
    });
  const originalEditableRelationTypes = new Map(editableRelations.map(r => [r.related_media_external_id, r.relation_type]));

  const entriesData = await Promise.all(
    transitiveIds.map(async id => ({ id, entry: await getCatalogEntry(id).catch(() => null) }))
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
    sagaMeta[x.id] = { title: x.entry.title_main || x.id, cover: x.entry.cover_url || null };
  }

  // Bootstraps sagaRelationTypes/sagaGroups from whatever SOURCE/
  // EPISODE/UPDATE/ALTERNATIVE edges already exist in the DB — this
  // is a one-time reverse-engineering of prior state, distinct from
  // classifySagaChain (which turns already-known sagaRelationTypes/
  // sagaGroups back into a display/relation structure).
  const [allRelsList, dbGroups, dbSagaName] = await Promise.all([
    Promise.all(sortedIds.map(id => getMediaRelationsForEditor(id).catch(() => [] as DbMediaRelation[]))),
    getMediaSagaGroups(sortedIds).catch(() => ({} as Record<string, string>)),
    invoke<string | null>('get_saga_name', { mediaExternalId: externalId }).catch(() => null),
  ]);
  // Reconstructs the manually-saved order (if any) from SEQUEL edges
  // among allRelsList instead of trusting release-date order alone —
  // otherwise a drag-reorder+submit looked saved but silently reverted
  // to release-date order the next time the editor was reopened.
  const sagaOrder = reconstructSagaOrder(sortedIds, allRelsList);
  const originalSagaOrder = sagaOrder;

  const sagaRelationTypes: Record<string, SagaRelationType> = {};
  const sagaGroups: Record<string, string> = { ...dbGroups };
  let nextGroupNum = 1;

  for (let i = 0; i < sortedIds.length; i++) {
    const ownerId = sortedIds[i];
    for (const r of allRelsList[i]) {
      const otherId = r.related_media_external_id;
      if (r.relation_type === 'ALTERNATIVE') {
        if (!sagaGroups[ownerId] && !sagaGroups[otherId]) {
          sagaGroups[ownerId] = sagaGroups[otherId] = `Group ${nextGroupNum++}`;
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
    bundledRelations,
    originalBundledIds,
    containedRelations,
    originalContainedIds,
    editableRelations,
    originalEditableRelationTypes,
    currentEntry,
    sagaMeta,
    sagaOrder,
    originalSagaOrder,
    sagaRelationTypes,
    originalSagaRelationTypes: { ...sagaRelationTypes },
    sagaGroups,
    originalSagaGroups: { ...sagaGroups },
    sagaName: dbSagaName || '',
    originalSagaName: dbSagaName || '',
  };
}
