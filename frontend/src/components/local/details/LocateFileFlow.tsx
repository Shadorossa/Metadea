import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  scanFolderContents, type LocalFolderEntry,
  pickFolder, pickFile, renamePath, getMediaRelationsForEditor, getCatalogEntry,
} from '../../../lib/tauri';
import { getT } from '../../../i18n/runtime';
import type { LocalMediaItem } from '../hooks/useLocalMediaEntries';
import {
  extractEpisodeInfo, hasMediaFiles,
  formatEpisodeLabel, buildLocateRenamePlan, dirname, type LocateRenamePlan,
  MEDIA_EXTENSIONS, sanitizeForFilename,
  encodeExternalIdForFilename, matchRelationsToFiles, type RelatedFileMatch,
  type CandidateFileGroup, isRedundantEpisodeName, type SeasonEpisodeCounts,
} from '../../../lib/local/folder-match';
import { ALL_CHAIN_RELATION_TYPES } from '../../../lib/media/saga/saga-relation-types';
import { resolveSeasonExternalIds, resolveOwnSeasonNumber } from '../../../lib/local/season-resolve';
import { fetchLocalSeasonEpisodeNames } from '../../../lib/media/episodes/episode-list';
import { IconFolder } from '../ui/icons';

interface LocateFileFlowArgs {
  item:          LocalMediaItem;
  rootFolder:    string | undefined;
  itemSeason:    number | null;
  isBookOrNovel: boolean;
  // Runs right after a successful rename, before the busy flag clears —
  // the panel re-checks its deep-tag scan and re-reads rootFolder here.
  onRenamed:     () => Promise<void>;
}

// "Localizar" — escape hatch for when automatic matching fails: the user
// picks the actual folder (or, for a folder shared with other distinct
// works, a single file) themselves, and it gets renamed to a format the
// matcher always recognizes afterward — no need to be a direct child of
// rootFolder, since findTaggedPathRecursive searches at any depth;
// renaming always happens in place (same parent), never moving anything.
// Files aren't touched until the user reviews and confirms the exact plan.
//
// State + handlers live in this hook rather than a single component
// because the panel renders the pieces in three different places: the
// error line at the top of the content column, the button inside the
// match row (which the no-folder/loading branches drop entirely), and the
// two preview modals outside those branches.
export function useLocateFileFlow({ item, rootFolder, itemSeason, isBookOrNovel, onRenamed }: LocateFileFlowArgs) {
  const [locateMenuOpen, setLocateMenuOpen] = useState(false);
  const locateBtnRef = useRef<HTMLButtonElement>(null);
  // The dropdown used to be a plain CSS-positioned absolute child of the
  // button's own wrapper — but that wrapper sits inside
  // .local-game-detail-content, which owns its own overflow-y:auto (see
  // local.css) to keep the banner from resizing as content streams in, and
  // an overflow ancestor clips an absolutely-positioned descendant
  // regardless of z-index. Same fix as AchievementCell's tooltip: render
  // into a body-level portal with position:fixed, positioned from the
  // button's own measured rect instead.
  const [locateMenuPos, setLocateMenuPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (!locateMenuOpen) return;
    const closeMenu = () => setLocateMenuOpen(false);
    // Deferred one tick so the same click that opened the menu (which also
    // bubbles up to document) doesn't immediately close it again.
    const id = setTimeout(() => document.addEventListener('click', closeMenu), 0);
    return () => { clearTimeout(id); document.removeEventListener('click', closeMenu); };
  }, [locateMenuOpen]);
  const [locateBusy, setLocateBusy] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [locatePreview, setLocatePreview] = useState<{
    pickedPath: string;
    parentDir: string;
    plan: LocateRenamePlan;
    // Movies/OVAs/etc. this work has a *relation* to (not its own season
    // chain — see ALL_CHAIN_RELATION_TYPES, filtered out below) found loose
    // in a sibling folder, e.g. Ghost in the Shell's movies sitting next to
    // its Stand Alone Complex folder under the same franchise parent. Each
    // gets its own [external_id] tag too, so it's recognized on its own the
    // next time its own catalog entry is opened.
    relatedMatches: RelatedFileMatch[];
  } | null>(null);
  const [locateFilePreview, setLocateFilePreview] = useState<{
    container: string;
    oldName: string;
    newName: string;
  } | null>(null);

  function validatePickedPath(picked: string): string | null {
    if (!rootFolder) return null;
    const normalizedRoot = rootFolder.replace(/\\/g, '/').replace(/\/+$/, '');
    const normalizedPicked = picked.replace(/\\/g, '/').replace(/\/+$/, '');
    if (normalizedPicked === normalizedRoot) {
      setLocateError('Esa es la carpeta raíz de la categoría — elige la carpeta/archivo de esta obra en concreto, dentro de ella.');
      return null;
    }
    if (!normalizedPicked.startsWith(`${normalizedRoot}/`)) {
      setLocateError(`Debe estar dentro de "${rootFolder}".`);
      return null;
    }
    return normalizedPicked;
  }

  // Fetched episode names for the "Localizar" rename flow — every distinct
  // catalog entry seasonMap points at (its own id for each anime season, or
  // just this work's own single id for a series), so buildLocateRenamePlan
  // can fill in a real "- Episode Title" for a file whose own name never had
  // one, instead of leaving it at just "SxxExx - Work Title".
  async function fetchEpisodeNamesForSeasonMap(
    mainExternalId: string,
    seasonMap: Record<number, { externalId: string; title: string }>,
  ): Promise<Record<string, Map<number, string>>> {
    if (item.libraryEntry.type !== 'anime' && item.libraryEntry.type !== 'series') return {};
    const ids = new Set<string>([mainExternalId, ...Object.values(seasonMap).map(s => s.externalId)]);
    const entries = await Promise.all(
      [...ids].map(async id => [id, await fetchLocalSeasonEpisodeNames(id, true).catch(() => new Map<number, string>())] as const),
    );
    return Object.fromEntries(entries);
  }

  // Each known season's own real episode total — what lets
  // buildLocateRenamePlan slice a bare continuously-numbered folder (no
  // per-file season marker at all) into its real seasons, and cap every
  // season at its own real length instead of running an extras clip past
  // it as if it were a further episode.
  async function fetchSeasonEpisodeCounts(
    seasonMap: Record<number, { externalId: string; title: string }>,
  ): Promise<SeasonEpisodeCounts> {
    const counts: SeasonEpisodeCounts = {};
    await Promise.all(Object.entries(seasonMap).map(async ([sStr, info]) => {
      const entry = await getCatalogEntry(info.externalId).catch(() => null);
      if (entry?.total_count) counts[Number(sStr)] = entry.total_count;
    }));
    return counts;
  }

  const handleLocateFolder = async () => {
    setLocateMenuOpen(false);
    setLocateError(null);
    if (!rootFolder) return;

    const picked = await pickFolder().catch(() => null);
    if (!picked) return;

    const normalizedPicked = validatePickedPath(picked);
    if (!normalizedPicked) return;
    const parent = dirname(normalizedPicked);

    setLocateBusy(true);
    try {
      const entries = await scanFolderContents(picked);
      if (!hasMediaFiles(entries)) {
        setLocateError('Esa carpeta no tiene archivos de vídeo/lectura directamente dentro.');
        return;
      }
      const resolvedSeason = await resolveOwnSeasonNumber(item.externalId, item.title) ?? itemSeason;
      const seasonMap = await resolveSeasonExternalIds(item.externalId, item.title, resolvedSeason);
      const [episodeNamesByExternalId, seasonEpisodeCounts] = await Promise.all([
        fetchEpisodeNamesForSeasonMap(item.externalId, seasonMap),
        fetchSeasonEpisodeCounts(seasonMap),
      ]);
      const plan = buildLocateRenamePlan(entries, item.title, item.externalId, resolvedSeason, seasonMap, item.libraryEntry.type, episodeNamesByExternalId, seasonEpisodeCounts);
      const relatedMatches = await findRelatedSiblingMatches(parent, normalizedPicked);
      setLocatePreview({ pickedPath: normalizedPicked, parentDir: parent, plan, relatedMatches });
    } catch (err) {
      setLocateError(err instanceof Error ? err.message : 'No se pudo leer esa carpeta.');
    } finally {
      setLocateBusy(false);
    }
  };

  // Movies/OVAs/etc. related to this work (not its own season chain) that
  // might be sitting loose in a sibling folder next to the one just picked
  // — e.g. picking "Koukaku Kidoutai/b. STAND Alone COMPLEX/" surfaces
  // "Koukaku Kidoutai/a. MOVIES/"'s files too, matched by relation title.
  // Best-effort: any failure here (relations fetch, sibling scan) just
  // means no related matches get offered, never blocks the main plan.
  async function findRelatedSiblingMatches(parentDir: string, excludePath: string): Promise<RelatedFileMatch[]> {
    try {
      const relations = await getMediaRelationsForEditor(item.externalId);
      const candidates = relations.filter(r => !ALL_CHAIN_RELATION_TYPES.includes(r.relation_type));
      if (candidates.length === 0) return [];

      const siblings = await scanFolderContents(parentDir);
      const groups: CandidateFileGroup[] = [];
      for (const sib of siblings) {
        const sibPath = `${parentDir}/${sib.name}`;
        if (sibPath === excludePath) continue;
        if (sib.is_dir) {
          const inner = await scanFolderContents(sibPath).catch(() => [] as LocalFolderEntry[]);
          groups.push({ containerPath: sibPath, entries: inner });
        } else {
          groups.push({ containerPath: parentDir, entries: [sib] });
        }
      }
      return matchRelationsToFiles(candidates, groups);
    } catch {
      return [];
    }
  }

  const handleLocateConfirm = async () => {
    if (!locatePreview) return;
    setLocateBusy(true);
    setLocateError(null);
    try {
      for (const { entry, newName } of locatePreview.plan.fileRenames) {
        if (entry.name === newName) continue;
        await renamePath(`${locatePreview.pickedPath}/${entry.name}`, `${locatePreview.pickedPath}/${newName}`);
      }
      const newFolderPath = `${locatePreview.parentDir}/${locatePreview.plan.folderNewName}`;
      if (newFolderPath !== locatePreview.pickedPath) {
        await renamePath(locatePreview.pickedPath, newFolderPath);
      }
      for (const m of locatePreview.relatedMatches) {
        await renamePath(`${m.containerPath}/${m.entry.name}`, `${m.containerPath}/${m.newName}`);
      }
      setLocatePreview(null);
      await onRenamed();
    } catch (err) {
      setLocateError(err instanceof Error ? err.message : 'Fallo al renombrar. Puede que se haya renombrado solo una parte.');
    } finally {
      setLocateBusy(false);
    }
  };

  // For a folder shared by several distinct works (e.g. a movie collection,
  // one file per film) — renames only the one file picked, leaving its
  // siblings untouched, instead of treating the whole folder as if it were
  // all episodes of this one work.
  const handleLocateSingleFile = async () => {
    setLocateMenuOpen(false);
    setLocateError(null);
    if (!rootFolder) return;

    const picked = await pickFile().catch(() => null);
    if (!picked) return;

    const normalizedPicked = validatePickedPath(picked);
    if (!normalizedPicked) return;
    if (!MEDIA_EXTENSIONS.test(normalizedPicked)) {
      setLocateError('Ese archivo no parece ser un vídeo/lectura reconocido.');
      return;
    }

    const container = dirname(normalizedPicked);
    const oldName = normalizedPicked.slice(container.length + 1);
    const info = extractEpisodeInfo(oldName);
    const episode = info ? Math.round(info.episode) : 1;
    const tag = encodeExternalIdForFilename(item.externalId);
    const titleSanitized = sanitizeForFilename(item.title);
    // Prefer the provider/database title: the text before the marker can be
    // an alternate title of the work, not the episode title.
    let rawEpisodeTitle = '';
    if (!isBookOrNovel) {
      const fetchedNames = await fetchLocalSeasonEpisodeNames(item.externalId, true).catch(() => new Map<number, string>());
      rawEpisodeTitle = fetchedNames.get(episode) ?? '';
      if (!rawEpisodeTitle && info?.episodeTitle && !isRedundantEpisodeName(info.episodeTitle, titleSanitized)) {
        rawEpisodeTitle = info.episodeTitle;
      }
    }
    const episodeTitle = rawEpisodeTitle && !isRedundantEpisodeName(rawEpisodeTitle, titleSanitized)
      ? sanitizeForFilename(rawEpisodeTitle)
      : '';
    const ext = oldName.match(/\.[a-z0-9]+$/i)?.[0] ?? '';
    const label = formatEpisodeLabel(itemSeason, episode, item.libraryEntry.type);
    const parts = [label, episodeTitle, titleSanitized].filter(Boolean);
    const newName = `${parts.join(' - ')} [${tag}]${ext}`;

    setLocateFilePreview({ container, oldName, newName });
  };

  const handleLocateFileConfirm = async () => {
    if (!locateFilePreview) return;
    setLocateBusy(true);
    setLocateError(null);
    try {
      if (locateFilePreview.oldName !== locateFilePreview.newName) {
        await renamePath(
          `${locateFilePreview.container}/${locateFilePreview.oldName}`,
          `${locateFilePreview.container}/${locateFilePreview.newName}`,
        );
      }
      setLocateFilePreview(null);
      await onRenamed();
    } catch (err) {
      setLocateError(err instanceof Error ? err.message : 'Fallo al renombrar.');
    } finally {
      setLocateBusy(false);
    }
  };

  return {
    locateMenuOpen, setLocateMenuOpen, locateBtnRef, locateMenuPos, setLocateMenuPos,
    locateBusy, locateError, locatePreview, setLocatePreview, locateFilePreview, setLocateFilePreview,
    handleLocateFolder, handleLocateSingleFile, handleLocateConfirm, handleLocateFileConfirm,
  };
}

export type LocateFileFlowState = ReturnType<typeof useLocateFileFlow>;

interface LocateButtonProps {
  flow:            LocateFileFlowState;
  rootFolder:      string | undefined;
  isSingleEpisode: boolean;
}

// The folder icon in the match row plus its (portal-rendered) dropdown.
export function LocateButton({ flow, rootFolder, isSingleEpisode }: LocateButtonProps) {
  const t = getT();
  const { locateMenuOpen, setLocateMenuOpen, locateBtnRef, locateMenuPos, setLocateMenuPos, locateBusy, handleLocateFolder, handleLocateSingleFile } = flow;

  return (
    <div className="local-media-detail-locate-wrap">
      <button
        ref={locateBtnRef}
        type="button"
        className="local-media-detail-locate-btn"
        onClick={() => {
          // "Elegir un archivo suelto" only makes sense for a
          // single-episode/movie/single-tomo-comic work — for
          // anything else there's no ambiguity to offer a choice
          // for, so the icon goes straight to "elegir carpeta"
          // instead of showing a dropdown with one option that's
          // never actually the right one to pick.
          if (!isSingleEpisode) { handleLocateFolder(); return; }
          if (!locateMenuOpen) {
            const rect = locateBtnRef.current?.getBoundingClientRect();
            if (rect) setLocateMenuPos({ top: rect.bottom + 6, left: rect.left + rect.width / 2 });
          }
          setLocateMenuOpen(v => !v);
        }}
        disabled={locateBusy || !rootFolder}
        title={t.local.locate_manually}
      >
        {locateBusy ? <span className="spinner spinner--sm" /> : <IconFolder size={14} strokeWidth={2} />}
      </button>
      {isSingleEpisode && locateMenuOpen && locateMenuPos && createPortal(
        <div
          className="local-media-detail-locate-menu local-media-detail-locate-menu--portal"
          style={{ top: locateMenuPos.top, left: locateMenuPos.left }}
          onClick={e => e.stopPropagation()}
        >
          <button type="button" onClick={handleLocateFolder}>{t.local.locate_choose_folder}</button>
          <button type="button" onClick={handleLocateSingleFile}>{t.local.locate_choose_file}</button>
        </div>,
        document.body,
      )}
    </div>
  );
}

// The two review-and-confirm modals (whole folder / single file), both
// body-level portals.
export function LocatePreviewModals({ flow }: { flow: LocateFileFlowState }) {
  const t = getT();
  const {
    locateBusy, locateError, locatePreview, setLocatePreview, locateFilePreview, setLocateFilePreview,
    handleLocateConfirm, handleLocateFileConfirm,
  } = flow;

  return (
    <>
      {locatePreview && createPortal(
        <div className="locate-preview-overlay" onClick={() => !locateBusy && setLocatePreview(null)}>
          <div className="locate-preview-modal" onClick={e => e.stopPropagation()}>
            <h3 className="locate-preview-title">{t.local.rename_for_detection_title}</h3>
            <p className="locate-preview-hint">
              {t.local.rename_for_detection_hint}
            </p>

            <div className="locate-preview-list">
              <div className="locate-preview-row locate-preview-row--folder">
                <span className="locate-preview-old">{locatePreview.pickedPath.split(/[/\\]/).pop()}</span>
                <span className="locate-preview-arrow">→</span>
                <span className="locate-preview-new">{locatePreview.plan.folderNewName}</span>
              </div>
              {locatePreview.plan.fileRenames.map(({ entry, newName }) => (
                <div key={entry.name} className="locate-preview-row">
                  <span className="locate-preview-old" title={entry.name}>{entry.name}</span>
                  <span className="locate-preview-arrow">→</span>
                  <span className="locate-preview-new" title={newName}>{newName}</span>
                </div>
              ))}
            </div>

            {locatePreview.relatedMatches.length > 0 && (
              <>
                <p className="locate-preview-hint" style={{ marginTop: '1rem' }}>
                  {t.local.related_works_found_hint}
                </p>
                <div className="locate-preview-list">
                  {locatePreview.relatedMatches.map(m => (
                    <div key={`${m.containerPath}/${m.entry.name}`} className="locate-preview-row locate-preview-row--related">
                      <span className="locate-preview-old" title={m.entry.name}>{m.relatedTitle}: {m.entry.name}</span>
                      <span className="locate-preview-arrow">→</span>
                      <span className="locate-preview-new" title={m.newName}>{m.newName}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {locateError && <p className="local-media-play-error">{locateError}</p>}

            <div className="locate-preview-actions">
              <button type="button" className="pr-editor-btn pr-editor-btn--cancel" onClick={() => setLocatePreview(null)} disabled={locateBusy}>
                {t.local.cancel}
              </button>
              <button type="button" className="pr-editor-btn pr-editor-btn--submit" onClick={handleLocateConfirm} disabled={locateBusy}>
                {locateBusy ? t.local.renaming_ellipsis : t.local.confirm_and_rename}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {locateFilePreview && createPortal(
        <div className="locate-preview-overlay" onClick={() => !locateBusy && setLocateFilePreview(null)}>
          <div className="locate-preview-modal" onClick={e => e.stopPropagation()}>
            <h3 className="locate-preview-title">{t.local.rename_file_title}</h3>
            <p className="locate-preview-hint">
              {t.local.rename_file_hint}
            </p>

            <div className="locate-preview-list">
              <div className="locate-preview-row">
                <span className="locate-preview-old" title={locateFilePreview.oldName}>{locateFilePreview.oldName}</span>
                <span className="locate-preview-arrow">→</span>
                <span className="locate-preview-new" title={locateFilePreview.newName}>{locateFilePreview.newName}</span>
              </div>
            </div>

            {locateError && <p className="local-media-play-error">{locateError}</p>}

            <div className="locate-preview-actions">
              <button type="button" className="pr-editor-btn pr-editor-btn--cancel" onClick={() => setLocateFilePreview(null)} disabled={locateBusy}>
                {t.local.cancel}
              </button>
              <button type="button" className="pr-editor-btn pr-editor-btn--submit" onClick={handleLocateFileConfirm} disabled={locateBusy}>
                {locateBusy ? t.local.renaming_ellipsis : t.local.confirm_and_rename}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
