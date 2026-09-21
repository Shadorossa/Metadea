import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Translations } from '../../i18n/index';
import { getT } from '../../i18n/client';
import type { GitHubPull } from '../../lib/github/api';
import { fetchFileAtRef, listPullRequestFiles, type GitHubPullFile } from '../../lib/github/api';
import { catalogFilePath, externalIdFromFilename } from '../../lib/github/catalogPaths';
import { getCatalogEntry } from '../../lib/tauri/catalog';
import { getCharacter, type CharacterEntry } from '../../lib/tauri/characters';
import { fetchAniListCharacterDetail, type AniListCharacterDetail } from '../../lib/search/providers/anilist';
import { mapExternalFormatToType } from '../../lib/media/mapper-utils';
import { parseCSV } from '../../lib/shared/string-utils';
import { buildPreviewMediaPageData, fetchMediaDataInternal, mapMediaDataToCatalogEntry } from '../../lib/media/mediaService';
import type { ProposalBundle, CharacterProposalBundle, CharacterProposalActor, CharacterProposalAppearance } from '../../lib/github/submitCollaborativeProposal';
import type { MediaPageData } from '../../lib/media/types';
import { CharacterPreviewCard, type CharacterPreviewAppearance, type CharacterPreviewChanges } from '../character/CharacterPreviewCard';
import { IconCheck, IconChevronLeft, IconChevronRight, IconX } from '../local/ui/icons';
import MediaPage from '../media/MediaPage';

interface Props {
  pr: GitHubPull;
  token: string;
  externalId: string;
  i18n: Pick<Translations, 'media' | 'discord' | 'notifications'>;
  onAccept: () => void;
  onReject: () => void;
  actioning: boolean;
  actionError: string | null;
  onClose: () => void;
}

type State = 'loading' | 'ready' | 'error';

interface ChangeCounts {
  added: number;
  updated: number;
  removed: number;
}

interface PreviewChangeGroup extends ChangeCounts {
  label: string;
}

interface PreviewChangeSummary {
  groups: PreviewChangeGroup[];
  newRelationIds: string[];
  updatedRelationIds: string[];
  removedItems: Array<{ id: string; title: string }>;
  characterChanges: CharacterPreviewChanges;
}

interface CharacterProviderData {
  entry: CharacterEntry;
  aliases: string[];
  appearances: CharacterPreviewAppearance[];
  actors: CharacterProposalActor[];
}

interface PreviewRecord {
  filename: string;
  externalId: string;
  bundle: ProposalBundle | CharacterProposalBundle;
}

function isCatalogJson(file: GitHubPullFile): boolean {
  return file.status !== 'removed' && /^catalog\/[^/]+\/[^/]+\.json$/i.test(file.filename);
}

function getPreviewTitle(record: PreviewRecord): string {
  if (record.externalId.startsWith('character:')) {
    const bundle = record.bundle as CharacterProposalBundle;
    return bundle.character?.name || record.externalId;
  }
  const bundle = record.bundle as ProposalBundle;
  return bundle.media_catalog?.title_main || bundle.media_catalog?.title_english
    || bundle.media_catalog?.title_romaji || record.externalId;
}

const EMPTY_CHANGE_COUNTS: ChangeCounts = { added: 0, updated: 0, removed: 0 };

function addChange(map: Map<string, ChangeCounts>, label: string, kind: keyof ChangeCounts) {
  const counts = map.get(label) ?? { ...EMPTY_CHANGE_COUNTS };
  counts[kind] += 1;
  map.set(label, counts);
}

function compareList<T>(
  current: T[],
  previous: T[],
  keyOf: (item: T) => string,
  matchesProviderData: (item: T) => boolean = () => false,
  hasProviderEntity: (item: T) => boolean = matchesProviderData,
  meaningfullyChanged: (current: T, previous: T) => boolean = (a, b) => JSON.stringify(a) !== JSON.stringify(b),
): ChangeCounts {
  const currentByKey = new Map(current.map(item => [keyOf(item), item] as const));
  const previousByKey = new Map(previous.map(item => [keyOf(item), item] as const));
  const counts = { ...EMPTY_CHANGE_COUNTS };

  for (const [key, item] of currentByKey) {
    const previousItem = previousByKey.get(key);
    if (previousItem === undefined) {
      if (matchesProviderData(item)) continue;
      if (hasProviderEntity(item)) counts.updated += 1;
      else counts.added += 1;
    } else if (meaningfullyChanged(item, previousItem) && !matchesProviderData(item)) {
      counts.updated += 1;
    }
  }
  for (const key of previousByKey.keys()) {
    if (!currentByKey.has(key)) counts.removed += 1;
  }
  return counts;
}

function mergeChangeCounts(map: Map<string, ChangeCounts>, label: string, counts: ChangeCounts) {
  if (counts.added + counts.updated + counts.removed === 0) return;
  const total = map.get(label) ?? { ...EMPTY_CHANGE_COUNTS };
  total.added += counts.added;
  total.updated += counts.updated;
  total.removed += counts.removed;
  map.set(label, total);
}

function normalizedRelationType(type: string | null | undefined): string {
  const normalized = (type ?? '').toUpperCase();
  return normalized.startsWith('REL_') ? normalized.slice(4) : normalized;
}

function compareRelationChanges(
  current: ProposalBundle['media_relations'],
  previous: ProposalBundle['media_relations'],
  sourceData: MediaPageData | null,
): { counts: ChangeCounts; newIds: string[]; updatedIds: string[]; removedRelations: Array<{ id: string; title: string }> } {
  // Recommendations are a separate MediaPage tab, not entries in the normal
  // related-work list. Ignore them on both sides so promoting a recommendation
  // to a real sequel/prequel is highlighted as a new relation, not an edit.
  const currentById = new Map(current
    .filter(relation => normalizedRelationType(relation.relation_type) !== 'RECOMMENDATION')
    .map(relation => [relation.related_media_external_id, relation] as const));
  const previousById = new Map(previous
    .filter(relation => normalizedRelationType(relation.relation_type) !== 'RECOMMENDATION')
    .map(relation => [relation.related_media_external_id, relation] as const));
  const apiById = new Map<string, NonNullable<MediaPageData['relations']>[number]>();
  for (const relation of sourceData?.relations ?? []) {
    if (!relation.relatedExternalId) continue;
    const existing = apiById.get(relation.relatedExternalId);
    // Recommendations render in a separate tab, so they are not an existing
    // relation card for this comparison. Prefer a real relation if the API
    // happens to return both kinds for the same target.
    if (!existing || (normalizedRelationType(existing.relationType) === 'RECOMMENDATION'
      && normalizedRelationType(relation.relationType) !== 'RECOMMENDATION')) {
      apiById.set(relation.relatedExternalId, relation);
    }
  }
  const counts = { ...EMPTY_CHANGE_COUNTS };
  const newIds: string[] = [];
  const updatedIds: string[] = [];
  const removedRelations: Array<{ id: string; title: string }> = [];

  for (const [id, relation] of currentById) {
    const previousRelation = previousById.get(id);
    const apiRelation = apiById.get(id);
    const currentType = normalizedRelationType(relation.relation_type);
    const previousType = normalizedRelationType(previousRelation?.relation_type);
    const apiType = normalizedRelationType(apiRelation?.relationType);

    if (previousRelation) {
      if (currentType !== previousType && currentType !== apiType) {
        counts.updated += 1;
        updatedIds.push(id);
      }
    } else if (apiRelation && apiType !== 'RECOMMENDATION') {
      if (currentType !== apiType) {
        counts.updated += 1;
        updatedIds.push(id);
      }
    } else {
      counts.added += 1;
      newIds.push(id);
    }
  }

  for (const [id, previousRelation] of previousById) {
    if (currentById.has(id)) continue;
    const apiRelation = apiById.get(id);
    const apiType = normalizedRelationType(apiRelation?.relationType);
    if (!apiRelation || apiType === 'RECOMMENDATION') {
      counts.removed += 1;
      removedRelations.push({ id, title: previousRelation.title || id });
    } else if (apiType !== normalizedRelationType(previousRelation.relation_type)) {
      counts.updated += 1;
    }
  }

  return { counts, newIds, updatedIds, removedRelations };
}

function catalogFieldLabel(field: string, type: string, i18n: Props['i18n']): string {
  const { media, notifications } = i18n;
  if (['title_main', 'title_native', 'title_romaji', 'title_english'].includes(field)) return notifications.preview_titles;
  if (field === 'synopsis') return media.section_synopsis;
  if (field === 'cover_url' || field === 'banners_csv') return notifications.preview_images;
  if (field.startsWith('release_')) return notifications.preview_dates;
  if (field === 'score_global') return media.stat_score;
  if (field === 'time_length') return media.stat_duration;
  if (field === 'status') return media.stat_status;
  if (field === 'format') return media.stat_format;
  if (field === 'total_count') return type === 'manga' || type === 'lnovel' ? media.stat_chapters : media.stat_episodes;
  if (field === 'total_count_2') return type === 'manga' || type === 'lnovel' ? media.stat_volumes : media.stat_seasons;
  if (field === 'genres_csv' || field === 'genres_tag_csv') return notifications.preview_genres;
  if (field === 'platforms_csv') return media.stat_platforms;
  if (field === 'shop_links_csv') return notifications.preview_links;
  if (field === 'source' || field === 'source_url') return media.stat_source;
  if (field === 'country_code') return media.stat_country;
  if (field === 'blocked_at') return notifications.preview_visibility;
  return notifications.preview_other_data;
}

function buildMediaChangeSummary(
  current: ProposalBundle,
  previous: ProposalBundle | null,
  sourceData: MediaPageData | null,
  i18n: Props['i18n'],
): PreviewChangeSummary {
  const groups = new Map<string, ChangeCounts>();
  const ignoredFields = new Set(['id', 'external_id', 'created_at', 'updated_at']);
  const type = current.media_catalog.type;
  const apiCatalog = sourceData
    ? mapMediaDataToCatalogEntry(sourceData, current.media_catalog.external_id)
    : null;

  for (const [field, value] of Object.entries(current.media_catalog)) {
    if (ignoredFields.has(field)) continue;
    const previousValue = previous?.media_catalog?.[field as keyof typeof current.media_catalog];
    if (previous
      ? JSON.stringify(value ?? null) === JSON.stringify(previousValue ?? null)
      : value === null || value === undefined) continue;
    const apiValue = apiCatalog?.[field as keyof typeof current.media_catalog];
    // The upload can serialize or fill a value that already matches the
    // provider. It appears in the branch JSON, but isn't a user-visible
    // change to the normal media page and shouldn't be highlighted.
    if (sourceData && JSON.stringify(value ?? null) === JSON.stringify(apiValue ?? null)) continue;
    addChange(groups, catalogFieldLabel(field, type, i18n), previous ? 'updated' : 'added');
  }

  const ownRelations = (current.media_relations ?? []).filter(
    relation => !relation.media_external_id || relation.media_external_id === current.media_catalog.external_id,
  );
  const previousRelations = (previous?.media_relations ?? []).filter(
    relation => !relation.media_external_id || relation.media_external_id === current.media_catalog.external_id,
  );
  const relationChanges = compareRelationChanges(ownRelations, previousRelations, sourceData);
  mergeChangeCounts(groups, i18n.media.section_related, relationChanges.counts);
  const apiCharacters = new Map((sourceData?.characters ?? []).map(character => [character.id ?? character.name, character] as const));
  mergeChangeCounts(groups, i18n.media.section_characters, compareList(
    current.characters ?? [], previous?.characters ?? [], character => character.external_id,
    character => {
      const apiCharacter = apiCharacters.get(character.external_id);
      return !!apiCharacter
        && apiCharacter.name === character.name
        && (apiCharacter.image ?? null) === (character.image_url ?? null)
        && (apiCharacter.role ?? null) === (character.relation_type || character.character_name || null);
    },
    character => apiCharacters.has(character.external_id),
  ));
  const apiAuthors = new Map((sourceData?.authors ?? []).map(author => [author.external_id, author] as const));
  mergeChangeCounts(groups, i18n.media.stat_authors, compareList(
    current.media_authors ?? [], previous?.media_authors ?? [], author => author.external_id,
    author => {
      const apiAuthor = apiAuthors.get(author.external_id);
      return !!apiAuthor
        && apiAuthor.name === author.name
        && (apiAuthor.image ?? null) === (author.image ?? null)
        && (apiAuthor.role ?? null) === (author.role ?? null);
    },
    author => apiAuthors.has(author.external_id),
  ));
  mergeChangeCounts(groups, i18n.notifications.preview_arcs, compareList(
    current.story_arcs ?? [], previous?.story_arcs ?? [], arc => arc.id,
  ));

  return {
    groups: [...groups].map(([label, counts]) => ({ label, ...counts })),
    newRelationIds: relationChanges.newIds,
    updatedRelationIds: relationChanges.updatedIds,
    removedItems: relationChanges.removedRelations,
    characterChanges: { fields: {}, appearances: {}, actors: {}, merges: {} },
  };
}

function normalizeAliases(value: string | null | undefined): string[] {
  return [...new Set(parseCSV(value).map(alias => alias.trim().toLowerCase()).filter(Boolean))].sort();
}

function sameCharacterField(field: string, left: unknown, right: unknown): boolean {
  if (field === 'aliases_csv') return JSON.stringify(normalizeAliases(left as string | null)) === JSON.stringify(normalizeAliases(right as string | null));
  if (field === 'image_url') {
    const normalizeImage = (value: unknown) => typeof value === 'string'
      ? value.replace(/\/(?:small|medium|large)\//i, '/_size_/')
      : value ?? null;
    return normalizeImage(left) === normalizeImage(right);
  }
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function buildAniListCharacterData(externalId: string, detail: AniListCharacterDetail): CharacterProviderData {
  const aliases = [...new Set([...(detail.name.alternative ?? []), ...(detail.name.alternativeSpoiler ?? [])].filter(Boolean))];
  const appearances = new Map<string, CharacterPreviewAppearance>();
  const actors = new Map<string, CharacterProposalActor>();

  for (const edge of detail.media?.edges ?? []) {
    const mediaExternalId = `${mapExternalFormatToType(edge.node.type, edge.node.format)}:${edge.node.id}`;
    appearances.set(mediaExternalId, {
      media_external_id: mediaExternalId,
      relation_type: edge.characterRole ?? null,
      title: edge.node.title.userPreferred || mediaExternalId,
      cover: edge.node.coverImage?.large ?? null,
    });
    for (const voiceActor of edge.voiceActors ?? []) {
      if (!voiceActor.id) continue;
      const actorId = `person:a${voiceActor.id}`;
      if (!actors.has(actorId)) {
        actors.set(actorId, {
          external_id: actorId,
          name: voiceActor.name?.userPreferred || voiceActor.name?.full || actorId,
          name_native: voiceActor.name?.native ?? null,
          image_url: voiceActor.image?.large || voiceActor.image?.medium || null,
          role: 'voice',
          language: voiceActor.languageV2 || 'Japanese',
        });
      }
    }
  }

  return {
    aliases,
    entry: {
      id: '',
      external_id: externalId,
      name: detail.name.full || externalId,
      name_native: detail.name.native ?? null,
      aliases_csv: aliases.join(', '),
      biography: detail.description ?? null,
      image_url: detail.image?.large ?? null,
      gender: detail.gender ?? null,
      age: detail.age ?? null,
      blood_type: detail.bloodType ?? null,
      dob_year: detail.dateOfBirth?.year ?? null,
      dob_month: detail.dateOfBirth?.month ?? null,
      dob_day: detail.dateOfBirth?.day ?? null,
      created_at: '',
      updated_at: '',
    },
    appearances: [...appearances.values()],
    actors: [...actors.values()],
  };
}

function mergeCharacterPreviewEntry(
  externalId: string,
  bundle: CharacterProposalBundle,
  provider: CharacterProviderData | null,
  local: CharacterEntry | null,
): CharacterEntry {
  const providerEntry = provider?.entry;
  const proposal = bundle.character;
  const fieldValue = (field: 'name' | 'name_native' | 'biography' | 'image_url') => {
    const hasProposalValue = Object.prototype.hasOwnProperty.call(proposal, field);
    const proposalValue = proposal[field];
    const providerValue = providerEntry?.[field];
    const localValue = local?.[field];
    if (hasProposalValue) return proposalValue || providerValue || null;
    return localValue || providerValue || null;
  };
  const chosenAliases = Object.prototype.hasOwnProperty.call(proposal, 'aliases_csv')
    ? proposal.aliases_csv
    : local?.aliases_csv;
  const aliases = [...new Set([...(provider?.aliases ?? []), ...parseCSV(chosenAliases).map(alias => alias.trim()).filter(Boolean)])];
  const localImageIsAniListMedium = !!local?.image_url
    && local.image_url.includes('anilist.co')
    && local.image_url.includes('/medium/');

  return {
    id: local?.id ?? '',
    external_id: externalId,
    name: String(fieldValue('name') || externalId),
    name_native: fieldValue('name_native'),
    aliases_csv: aliases.join(', '),
    biography: fieldValue('biography'),
    image_url: (localImageIsAniListMedium && !Object.prototype.hasOwnProperty.call(proposal, 'image_url'))
      ? providerEntry?.image_url ?? local?.image_url ?? null
      : fieldValue('image_url'),
    reaction: local?.reaction ?? null,
    gender: local?.gender ?? providerEntry?.gender ?? null,
    age: local?.age ?? providerEntry?.age ?? null,
    blood_type: local?.blood_type ?? providerEntry?.blood_type ?? null,
    dob_year: local?.dob_year ?? providerEntry?.dob_year ?? null,
    dob_month: local?.dob_month ?? providerEntry?.dob_month ?? null,
    dob_day: local?.dob_day ?? providerEntry?.dob_day ?? null,
    created_at: local?.created_at ?? '',
    updated_at: local?.updated_at ?? '',
  };
}

function mergeCharacterPreviewAppearances(
  current: CharacterProposalAppearance[],
  provider: CharacterPreviewAppearance[],
): CharacterPreviewAppearance[] {
  const byId = new Map(provider.map(appearance => [appearance.media_external_id, appearance] as const));
  for (const appearance of current) {
    byId.set(appearance.media_external_id, { ...byId.get(appearance.media_external_id), ...appearance });
  }
  return [...byId.values()];
}

function mergeCharacterPreviewActors(
  current: CharacterProposalActor[],
  provider: CharacterProposalActor[],
): CharacterProposalActor[] {
  const byId = new Map(provider.map(actor => [actor.external_id, actor] as const));
  for (const actor of current) {
    const merged = { ...(byId.get(actor.external_id) ?? { external_id: actor.external_id }) };
    for (const [field, value] of Object.entries(actor)) {
      if (value !== undefined && value !== null) (merged as Record<string, unknown>)[field] = value;
    }
    byId.set(actor.external_id, merged);
  }
  return [...byId.values()];
}

function buildCharacterChangeSummary(
  current: CharacterProposalBundle,
  previous: CharacterProposalBundle | null,
  provider: CharacterProviderData | null,
  i18n: Props['i18n'],
): PreviewChangeSummary {
  const groups = new Map<string, ChangeCounts>();
  const changedFields: CharacterPreviewChanges['fields'] = {};
  const fields = ['name', 'name_native', 'aliases_csv', 'biography', 'image_url'] as const;
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(current.character, field)) continue;
    const value = current.character[field];
    const previousValue = previous?.character?.[field];
    if (previous && sameCharacterField(field, value, previousValue)) continue;
    if (!previous && (value === null || value === undefined)) continue;
    const providerValue = provider?.entry[field];
    const matchesProvider = provider && sameCharacterField(field, value, providerValue);
    if (matchesProvider) continue;
    const isRemoval = (value === null || value === '') && previousValue != null && (providerValue === null || providerValue === undefined);
    const kind = isRemoval ? 'removed' : previous ? 'updated' : 'added';
    addChange(groups, i18n.notifications.preview_character_data, kind);
    changedFields[field] = kind;
  }

  const providerAppearances = new Map((provider?.appearances ?? []).map(item => [item.media_external_id, item] as const));
  const providerActors = new Map((provider?.actors ?? []).map(item => [item.external_id, item] as const));
  const currentAppearances = current.appearances ?? [];
  const previousAppearances = previous?.appearances ?? [];
  const currentActors = current.actors ?? [];
  const previousActors = previous?.actors ?? [];
  const appearanceChanges: CharacterPreviewChanges['appearances'] = {};
  const actorChanges: CharacterPreviewChanges['actors'] = {};
  const mergeChanges: CharacterPreviewChanges['merges'] = {};
  const removedItems: Array<{ id: string; title: string }> = [];

  const appearanceCounts = { ...EMPTY_CHANGE_COUNTS };
  const currentAppearanceById = new Map(currentAppearances.map(item => [item.media_external_id, item] as const));
  const previousAppearanceById = new Map(previousAppearances.map(item => [item.media_external_id, item] as const));
  for (const [id, item] of currentAppearanceById) {
    const old = previousAppearanceById.get(id);
    const api = providerAppearances.get(id);
    const matchesApi = !!api
      && normalizedRelationType(item.relation_type) === normalizedRelationType(api.relation_type);
    if (!old) {
      if (matchesApi) continue;
      const kind = api ? 'updated' : 'added';
      appearanceCounts[kind] += 1;
      appearanceChanges[id] = kind;
    } else if (normalizedRelationType(item.relation_type) !== normalizedRelationType(old.relation_type)) {
      if (matchesApi && normalizedRelationType(old.relation_type) === normalizedRelationType(api?.relation_type)) continue;
      appearanceCounts.updated += 1;
      appearanceChanges[id] = 'updated';
    }
  }
  for (const [id, old] of previousAppearanceById) {
    if (currentAppearanceById.has(id)) continue;
    const api = providerAppearances.get(id);
    if (api) {
      if (normalizedRelationType(old.relation_type) !== normalizedRelationType(api.relation_type)) {
        appearanceCounts.updated += 1;
        appearanceChanges[id] = 'updated';
      }
    } else {
      appearanceCounts.removed += 1;
      removedItems.push({ id, title: id });
    }
  }
  mergeChangeCounts(groups, i18n.notifications.preview_appearances, appearanceCounts);

  const currentMergeIds = new Set(current.merged_character_external_ids ?? []);
  const previousMergeIds = new Set(previous?.merged_character_external_ids ?? []);
  const mergeCounts = { ...EMPTY_CHANGE_COUNTS };
  for (const id of currentMergeIds) {
    if (previousMergeIds.has(id)) continue;
    mergeCounts.added += 1;
    mergeChanges[id] = 'added';
  }
  for (const id of previousMergeIds) {
    if (currentMergeIds.has(id)) continue;
    mergeCounts.removed += 1;
    mergeChanges[id] = 'removed';
    removedItems.push({ id, title: id });
  }
  mergeChangeCounts(groups, getT().character_editor.merges, mergeCounts);

  const actorCounts = { ...EMPTY_CHANGE_COUNTS };
  const currentActorById = new Map(currentActors.map(item => [item.external_id, item] as const));
  const previousActorById = new Map(previousActors.map(item => [item.external_id, item] as const));
  const actorMatches = (left: CharacterProposalActor, right: CharacterProposalActor, api: CharacterProposalActor | undefined) => {
    const fields = ['name', 'name_native', 'image_url', 'role', 'language'] as const;
    return fields.every(field => (left[field] ?? api?.[field] ?? null) === (right[field] ?? api?.[field] ?? null));
  };
  for (const [id, item] of currentActorById) {
    const old = previousActorById.get(id);
    const api = providerActors.get(id);
    if (!old) {
      if (api && actorMatches(item, api, api)) continue;
      const kind = api ? 'updated' : 'added';
      actorCounts[kind] += 1;
      actorChanges[id] = kind;
    } else if (!actorMatches(item, old, api)) {
      actorCounts.updated += 1;
      actorChanges[id] = 'updated';
    }
  }
  for (const [id, old] of previousActorById) {
    if (currentActorById.has(id)) continue;
    const api = providerActors.get(id);
    if (api) {
      if (!actorMatches(old, api, api)) {
        actorCounts.updated += 1;
        actorChanges[id] = 'updated';
      }
    } else {
      actorCounts.removed += 1;
      removedItems.push({ id, title: old.name || id });
    }
  }
  mergeChangeCounts(groups, i18n.notifications.preview_voice_actors, actorCounts);

  return {
    groups: [...groups].map(([label, counts]) => ({ label, ...counts })),
    newRelationIds: [],
    updatedRelationIds: [],
    removedItems,
    characterChanges: { fields: changedFields, appearances: appearanceChanges, actors: actorChanges, merges: mergeChanges },
  };
}

export function PrPreviewModal({ pr, token, externalId, i18n, onAccept, onReject, actioning, actionError, onClose }: Props) {
  const t = i18n.notifications;
  const [state, setState] = useState<State>('loading');
  const previewScreenRef = useRef<HTMLDivElement>(null);
  const previewPageRef = useRef<HTMLDivElement>(null);
  const [previewScale, setPreviewScale] = useState(1);
  const [previewFiles, setPreviewFiles] = useState<PreviewRecord[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [previewData, setPreviewData] = useState<MediaPageData | null>(null);
  const [previewCharacter, setPreviewCharacter] = useState<CharacterEntry | null>(null);
  const [previewAppearances, setPreviewAppearances] = useState<CharacterPreviewAppearance[]>([]);
  const [previewActors, setPreviewActors] = useState<CharacterProposalActor[]>([]);
  const [previewMergedCharacterIds, setPreviewMergedCharacterIds] = useState<string[]>([]);
  const [previewChanges, setPreviewChanges] = useState<PreviewChangeSummary | null>(null);
  const activeRecord = previewFiles[activeIndex] ?? null;
  const isCharacter = activeRecord?.externalId.startsWith('character:') ?? externalId.startsWith('character:');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // A contributor without push access gets forked+PR'd instead (see
        // GitHubPull.head's own doc comment) - pr.head.ref then names a
        // branch that only exists in their fork, not the base repo.
        let changedFiles: GitHubPullFile[] = [];
        try {
          changedFiles = await listPullRequestFiles(token, pr.number);
        } catch (err) {
          // Keep the original single-work preview usable if GitHub's PR-files
          // endpoint is temporarily unavailable; the primary file is still
          // fetched from the PR branch below.
          console.warn('[PrPreviewModal] Could not list all PR files:', err);
        }

        const filesById = new Map<string, string>();
        for (const file of changedFiles.filter(isCatalogJson)) {
          const filename = file.filename.split('/').at(-1) ?? '';
          const id = externalIdFromFilename(filename);
          if (id.includes(':')) filesById.set(id, file.filename);
        }
        // Include the work that opened the preview even if GitHub's changed
        // file listing omits it (or fails); related works remain navigable.
        if (!filesById.has(externalId)) filesById.set(externalId, catalogFilePath(externalId));

        const orderedFiles = [...filesById.entries()].sort(([a], [b]) => {
          if (a === externalId) return -1;
          if (b === externalId) return 1;
          return 0;
        });
        const records = (await Promise.all(orderedFiles.map(async ([id, filename]) => {
          try {
            const content = await fetchFileAtRef(token, filename, pr.head.ref, pr.head.repo?.full_name);
            return { filename, externalId: id, bundle: JSON.parse(content) as PreviewRecord['bundle'] };
          } catch (err) {
            console.warn(`[PrPreviewModal] Could not load changed catalog file ${filename}:`, err);
            return null;
          }
        }))).filter((record): record is PreviewRecord => record !== null);

        if (cancelled) return;
        if (records.length === 0) throw new Error('No changed catalog JSON files could be loaded');
        setPreviewFiles(records);
        const primaryIndex = records.findIndex(record => record.externalId === externalId);
        setActiveIndex(primaryIndex >= 0 ? primaryIndex : 0);
      } catch (err) {
        console.error('[PrPreviewModal] Failed to build preview:', err);
        if (!cancelled) setState('error');
      }
    })();

    return () => { cancelled = true; };
  }, [pr.number, pr.head.ref, pr.head.repo?.full_name, externalId, token]);

  useEffect(() => {
    if (!activeRecord) return;
    let cancelled = false;
    setState('loading');
    setPreviewData(null);
    setPreviewCharacter(null);
    setPreviewAppearances([]);
    setPreviewActors([]);
    setPreviewMergedCharacterIds([]);
    setPreviewChanges(null);

    (async () => {
      try {
        const previousContent = await fetchFileAtRef(token, activeRecord.filename, 'main').catch(err => {
          // A 404 means this PR adds a new catalog file; other failures should
          // not be mislabeled as a brand-new entry.
          if (err instanceof Error && /not found/i.test(err.message)) return null;
          throw err;
        });

        if (activeRecord.externalId.startsWith('character:')) {
          // Character proposals are independent files, not media-page data.
          const bundle = activeRecord.bundle as CharacterProposalBundle;
          const previousBundle = previousContent ? JSON.parse(previousContent) as CharacterProposalBundle : null;
          const [, providerCode, rawProviderId] = activeRecord.externalId.split(':');
          const providerId = providerCode === 'a' && /^\d+$/.test(rawProviderId ?? '') ? Number(rawProviderId) : null;
          const [baseline, aniListDetail] = await Promise.all([
            getCharacter(activeRecord.externalId).catch(() => null),
            providerId ? fetchAniListCharacterDetail(providerId).catch(err => {
              console.warn('[PrPreviewModal] Could not fetch AniList character details:', err);
              return null;
            }) : Promise.resolve(null),
          ]);
          const provider = aniListDetail ? buildAniListCharacterData(activeRecord.externalId, aniListDetail) : null;
          if (cancelled) return;
          setPreviewCharacter(mergeCharacterPreviewEntry(activeRecord.externalId, bundle, provider, baseline));
          setPreviewAppearances(mergeCharacterPreviewAppearances(bundle.appearances ?? [], provider?.appearances ?? []));
          setPreviewActors(mergeCharacterPreviewActors(bundle.actors ?? [], provider?.actors ?? []));
          setPreviewMergedCharacterIds(bundle.merged_character_external_ids ?? []);
          setPreviewChanges(buildCharacterChangeSummary(bundle, previousBundle, provider, i18n));
        } else {
          const bundle = activeRecord.bundle as ProposalBundle;
          const previousBundle = previousContent ? JSON.parse(previousContent) as ProposalBundle : null;
          const [baseline, sourceData] = await Promise.all([
            getCatalogEntry(activeRecord.externalId).catch(() => null),
            // Preview the proposal on top of the work as provided by its
            // source (AniList/TMDB/IGDB/etc.), not as a raw JSON diff.
            fetchMediaDataInternal(activeRecord.externalId).catch(() => null),
          ]);
          if (cancelled) return;
          setPreviewData(buildPreviewMediaPageData(bundle, baseline, sourceData));
          setPreviewChanges(buildMediaChangeSummary(bundle, previousBundle, sourceData, i18n));
        }
        setState('ready');
      } catch (err) {
        console.error('[PrPreviewModal] Failed to build work preview:', err);
        if (!cancelled) setState('error');
      }
    })();

    return () => { cancelled = true; };
  }, [activeRecord, token, i18n]);

  const changeWork = (offset: number) => {
    setActiveIndex(index => (index + offset + previewFiles.length) % previewFiles.length);
  };

  useEffect(() => {
    if (previewFiles.length < 2) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setActiveIndex(index => (index - 1 + previewFiles.length) % previewFiles.length);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setActiveIndex(index => (index + 1) % previewFiles.length);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewFiles.length]);

  // Fit the complete simulated page into its floating preview frame, rather
  // than clipping its lower sections or measuring against the user's monitor.
  // The frame can be wider than it is tall; only the page scale adapts.
  useEffect(() => {
    const screen = previewScreenRef.current;
    const page = previewPageRef.current;
    if (!screen || !page || state !== 'ready') {
      setPreviewScale(1);
      return;
    }

    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const width = page.scrollWidth;
        const height = page.scrollHeight;
        if (!width || !height) return;
        const scale = Math.min(1, screen.clientWidth / width, screen.clientHeight / height);
        setPreviewScale(current => Math.abs(current - scale) > 0.005 ? scale : current);
      });
    };

    const observer = new ResizeObserver(measure);
    observer.observe(screen);
    observer.observe(page);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [state, activeIndex, previewCharacter, previewData, previewChanges]);

  const modal = (
    <div className="me-overlay pr-preview-overlay" onClick={onClose}>
      <div
        className="pr-preview-container"
        onClick={e => {
          const target = e.target;
          const clickedPreviewContent = target instanceof Element
            && target.closest('.pr-preview-screen, .pr-preview-header, .pr-preview-work-arrow');
          if (!clickedPreviewContent) onClose();
          e.stopPropagation();
        }}
      >
        <div className="pr-preview-header">
          <div className="pr-preview-header-row">
            <div className="pr-preview-banner">
              <span>{t.preview_banner.replace('{number}', String(pr.number))}</span>
              <button type="button" className="pr-preview-close" onClick={onClose} title={t.close_preview}>
                <IconX size={18} />
              </button>
            </div>
            {state === 'ready' && previewChanges && (
              <section className="pr-preview-changes" aria-label={t.preview_changes_title}>
                <div className="pr-preview-changes-heading">
                  <h2>{t.preview_changes_title}</h2>
                  {previewChanges.groups.length > 0 && (
                    <ul className="pr-preview-change-list">
                      {previewChanges.groups.map(group => (
                        <li
                          className={`pr-preview-change-item${group.removed > 0 ? ' has-removed' : group.updated > 0 ? ' has-updated' : ' has-added'}`}
                          key={group.label}
                        >
                          <span className="pr-preview-change-label">{group.label}</span>
                          <span className="pr-preview-change-counts">
                            {group.added > 0 && <span className="pr-preview-change-count is-added" title={t.preview_added}>+{group.added}</span>}
                            {group.updated > 0 && <span className="pr-preview-change-count is-updated" title={t.preview_updated}>~{group.updated}</span>}
                            {group.removed > 0 && <span className="pr-preview-change-count is-removed" title={t.preview_removed}>-{group.removed}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="pr-preview-change-legend" aria-label={`${t.preview_added}, ${t.preview_updated}, ${t.preview_removed}`}>
                    <span className="is-added">+ {t.preview_added}</span>
                    <span className="is-updated">~ {t.preview_updated}</span>
                    <span className="is-removed">- {t.preview_removed}</span>
                  </div>
                </div>
                {previewChanges.groups.length === 0 && <p className="pr-preview-no-changes">{t.preview_no_changes}</p>}
                {previewChanges.removedItems.length > 0 && (
                  <div className="pr-preview-removed-relations" aria-label={t.preview_removed}>
                    {previewChanges.removedItems.map(item => (
                      <span className="pr-preview-removed-relation" key={item.id}>{item.title}</span>
                    ))}
                  </div>
                )}
              </section>
            )}
            <div className="pr-preview-action-controls">
              <button type="button" className="pr-list-accept-btn" onClick={onAccept} disabled={actioning}>
                <IconCheck size={15} strokeWidth={2.5} />
                {t.accept_button}
              </button>
              <button type="button" className="pr-list-reject-btn" onClick={onReject} disabled={actioning}>
                <IconX size={13} strokeWidth={2.5} />
                {t.reject_button}
              </button>
              {actionError && <p className="pr-preview-action-error" role="alert">{actionError}</p>}
            </div>
          </div>
          {previewFiles.length > 1 && activeRecord && (
            <div className="pr-preview-work-indicator" aria-live="polite">
              <span>{getPreviewTitle(activeRecord)}</span>
              <span>{activeIndex + 1} / {previewFiles.length}</span>
            </div>
          )}
        </div>
        <div className="pr-preview-screen-stage">
          {previewFiles.length > 1 && (
            <>
              <button
                type="button"
                className="pr-preview-work-arrow is-previous"
                onClick={() => changeWork(-1)}
                aria-label={t.preview_previous_work}
                title={t.preview_previous_work}
              >
                <IconChevronLeft size={22} />
              </button>
              <button
                type="button"
                className="pr-preview-work-arrow is-next"
                onClick={() => changeWork(1)}
                aria-label={t.preview_next_work}
                title={t.preview_next_work}
              >
                <IconChevronRight size={22} />
              </button>
            </>
          )}
          <div className="pr-preview-screen" ref={previewScreenRef}>
            <div className="pr-preview-body">
              {state === 'loading' && <div className="pr-preview-status">{t.preview_loading}</div>}
              {state === 'error' && <div className="pr-preview-status">{t.preview_error}</div>}
              {state === 'ready' && (isCharacter ? previewCharacter : previewData) && (
                <div
                  className="media-page pr-preview-simulated-screen"
                  ref={previewPageRef}
                  style={{ transform: `scale(${previewScale})` }}
                >
                  {isCharacter && previewCharacter ? (
                    <CharacterPreviewCard
                      character={previewCharacter}
                      appearances={previewAppearances}
                      actors={previewActors}
                      mergedCharacterIds={previewMergedCharacterIds}
                      changes={previewChanges?.characterChanges}
                    />
                  ) : previewData ? (
                    <MediaPage
                      i18n={{ media: i18n.media, discord: i18n.discord }}
                      previewData={previewData}
                      previewMode
                      previewAddedRelationIds={previewChanges?.newRelationIds}
                      previewUpdatedRelationIds={previewChanges?.updatedRelationIds}
                    />
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
