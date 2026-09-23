import { useEffect, useRef, useState } from 'react';
import { ModalShell } from '../shared/ModalShell';
import type { Translations } from '../../i18n/index';
import type { GitHubPull } from '../../lib/github/api';
import { fetchFileAtRef, listPullRequestFiles, type GitHubPullFile } from '../../lib/github/api';
import { catalogFilePath, externalIdFromFilename } from '../../lib/github/catalog-paths';
import { getCatalogEntry } from '../../lib/tauri/catalog';
import { getCharacter, type CharacterEntry } from '../../lib/tauri/characters';
import { fetchAniListCharacterDetail } from '../../lib/search/providers/anilist';
import { buildPreviewMediaPageData, fetchMediaDataInternal } from '../../lib/media/media-page-data';
import type { ProposalBundle, CharacterProposalBundle, CharacterProposalActor } from '../../lib/github/submit-collaborative-proposal';
import {
  buildAniListCharacterData,
  buildCharacterChangeSummary,
  buildMediaChangeSummary,
  getPreviewTitle,
  isCatalogJson,
  mergeCharacterPreviewActors,
  mergeCharacterPreviewAppearances,
  mergeCharacterPreviewEntry,
  type PreviewChangeSummary,
  type PreviewRecord,
} from '../../lib/github/proposal-diff';
import type { MediaPageData } from '../../lib/media/types';
import { CharacterPreviewCard, type CharacterPreviewAppearance } from '../character/CharacterPreviewCard';
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

  return (
    <ModalShell
      onClose={onClose}
      label={t.preview_banner.replace('{number}', String(pr.number))}
      overlayClassName="me-overlay pr-preview-overlay"
      panelClassName="pr-preview-container"
      panelProps={{
        onClick: e => {
          const target = e.target;
          const clickedPreviewContent = target instanceof Element
            && target.closest('.pr-preview-screen, .pr-preview-header, .pr-preview-work-arrow');
          if (!clickedPreviewContent) onClose();
          e.stopPropagation();
        },
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
    </ModalShell>
  );
}
