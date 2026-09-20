import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Translations } from '../../i18n/index';
import type { GitHubPull } from '../../lib/github/api';
import { fetchFileAtRef, listPullRequestFiles, type GitHubPullFile } from '../../lib/github/api';
import { catalogFilePath, externalIdFromFilename } from '../../lib/github/catalogPaths';
import { getCatalogEntry } from '../../lib/tauri/catalog';
import { getCharacter, type CharacterEntry } from '../../lib/tauri/characters';
import { buildPreviewMediaPageData, fetchMediaDataInternal, mapMediaDataToCatalogEntry } from '../../lib/media/mediaService';
import type { ProposalBundle, CharacterProposalBundle, CharacterProposalAppearance } from '../../lib/github/submitCollaborativeProposal';
import type { MediaPageData } from '../../lib/media/types';
import { CharacterPreviewCard } from '../character/CharacterPreviewCard';
import { IconChevronLeft, IconChevronRight, IconX } from '../local/ui/icons';
import MediaPage from '../media/MediaPage';

interface Props {
  pr: GitHubPull;
  token: string;
  externalId: string;
  i18n: Pick<Translations, 'media' | 'discord' | 'notifications'>;
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
  removedRelations: Array<{ id: string; title: string }>;
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
    removedRelations: relationChanges.removedRelations,
  };
}

function buildCharacterChangeSummary(
  current: CharacterProposalBundle,
  previous: CharacterProposalBundle | null,
  i18n: Props['i18n'],
): PreviewChangeSummary {
  const groups = new Map<string, ChangeCounts>();
  for (const [field, value] of Object.entries(current.character)) {
    if (field === 'external_id') continue;
    const previousValue = previous?.character?.[field as keyof typeof current.character];
    if (previous
      ? JSON.stringify(value ?? null) === JSON.stringify(previousValue ?? null)
      : value === null || value === undefined) continue;
    addChange(groups, i18n.notifications.preview_character_data, previous ? 'updated' : 'added');
  }
  mergeChangeCounts(groups, i18n.notifications.preview_appearances, compareList(
    current.appearances ?? [], previous?.appearances ?? [], appearance => appearance.media_external_id,
  ));
  mergeChangeCounts(groups, i18n.notifications.preview_voice_actors, compareList(
    current.actors ?? [], previous?.actors ?? [], actor => actor.external_id,
  ));

  return {
    groups: [...groups].map(([label, counts]) => ({ label, ...counts })),
    newRelationIds: [],
    updatedRelationIds: [],
    removedRelations: [],
  };
}

export function PrPreviewModal({ pr, token, externalId, i18n, onClose }: Props) {
  const t = i18n.notifications;
  const [state, setState] = useState<State>('loading');
  const [previewFiles, setPreviewFiles] = useState<PreviewRecord[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [previewData, setPreviewData] = useState<MediaPageData | null>(null);
  const [previewCharacter, setPreviewCharacter] = useState<CharacterEntry | null>(null);
  const [previewAppearances, setPreviewAppearances] = useState<CharacterProposalAppearance[]>([]);
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
          const baseline = await getCharacter(activeRecord.externalId).catch(() => null);
          if (cancelled) return;
          setPreviewCharacter({
            id: baseline?.id ?? '', created_at: baseline?.created_at ?? '', updated_at: baseline?.updated_at ?? '',
            ...baseline,
            ...bundle.character,
            name: bundle.character.name ?? baseline?.name ?? activeRecord.externalId,
          });
          setPreviewAppearances(bundle.appearances ?? []);
          setPreviewChanges(buildCharacterChangeSummary(bundle, previousBundle, i18n));
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

  const modal = (
    <div className="me-overlay pr-preview-overlay" onClick={onClose}>
      <div className="pr-preview-container" onClick={e => e.stopPropagation()}>
        <div className="pr-preview-banner">
          <span>{t.preview_banner.replace('{number}', String(pr.number))}</span>
          <button type="button" className="pr-preview-close" onClick={onClose} title={t.close_preview}>
            <IconX size={18} />
          </button>
        </div>
        {previewFiles.length > 1 && activeRecord && (
          <div className="pr-preview-work-indicator" aria-live="polite">
            <span>{getPreviewTitle(activeRecord)}</span>
            <span>{activeIndex + 1} / {previewFiles.length}</span>
          </div>
        )}
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
        <div className="pr-preview-body">
          {state === 'loading' && <div className="pr-preview-status">{t.preview_loading}</div>}
          {state === 'error' && <div className="pr-preview-status">{t.preview_error}</div>}
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
                          {group.removed > 0 && <span className="pr-preview-change-count is-removed" title={t.preview_removed}>−{group.removed}</span>}
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
              {previewChanges.removedRelations.length > 0 && (
                <div className="pr-preview-removed-relations" aria-label={t.preview_removed}>
                  {previewChanges.removedRelations.map(relation => (
                    <span className="pr-preview-removed-relation" key={relation.id}>{relation.title}</span>
                  ))}
                </div>
              )}
            </section>
          )}
          {state === 'ready' && isCharacter && previewCharacter && (
            <CharacterPreviewCard character={previewCharacter} appearances={previewAppearances} />
          )}
          {state === 'ready' && !isCharacter && previewData && (
            <MediaPage
              i18n={{ media: i18n.media, discord: i18n.discord }}
              previewData={previewData}
              previewMode
              previewAddedRelationIds={previewChanges?.newRelationIds}
              previewUpdatedRelationIds={previewChanges?.updatedRelationIds}
            />
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
