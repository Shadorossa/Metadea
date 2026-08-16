import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  scanFolderContents, playFileWithVlc, getVlcPlaybackStatus, saveLibraryEntry,
  saveEpisodeHistoryEntry, getEpisodeHistory, type EpisodeHistoryEntry,
  type LocalFolderEntry, updateDiscordPresence, resetDiscordPresence,
  pickFolder, pickFile, renamePath, getMediaRelationsForEditor, getCatalogEntry,
  addSequelToPlanning,
} from '../../../lib/tauri';
import { getT } from '../../../i18n/client';
import type { LocalMediaItem } from '../hooks/useLocalMediaEntries';
import {
  findMatchingFolder, findMatchingEpisodeFile, findMatchingFile, soleMediaFile,
  extractEpisodeInfo, extractTitleSeason, hasMediaFiles, cleanFilenameForDisplay,
  formatEpisodeLabel, buildLocateRenamePlan, dirname, type LocateRenamePlan,
  findTaggedPathRecursive, type TaggedMatch, MEDIA_EXTENSIONS, sanitizeForFilename,
  encodeExternalIdForFilename, matchRelationsToFiles, type RelatedFileMatch,
  type CandidateFileGroup,
} from '../utils/folderMatch';
import { ALL_CHAIN_RELATION_TYPES } from '../../../lib/media/sagaTypes';
import { resolveSeasonExternalIds, resolveOwnSeasonNumber } from '../utils/seasonResolve';
import { syncToAniList, isAniListType } from '../../../lib/media/anilist-sync';
import { formatWatchedAt } from '../utils/formatters';
import { IconX, IconFolder, IconCheck, IconAlertCircle, IconPencil } from '../ui/icons';

interface LocalMediaDetailPanelProps {
  item:            LocalMediaItem;
  rootFolder:      string | undefined;
  rootEntries:     LocalFolderEntry[];
  rootLoading:     boolean;
  onClose:         () => void;
  onProgressSaved: () => void;
  // Re-reads rootFolder's contents after the "Localizar" flow renames a
  // folder/its files — otherwise the freshly-renamed folder stays invisible
  // to matchedFolder/rootFileMatch until something else happens to trigger
  // a rescan (switching category and back, reopening the app).
  onRootRefresh:   () => Promise<void>;
}

// The "in progress" verb a freshly-started entry should switch to — matches
// the same three-way split used everywhere else in the app (watching an
// anime/series/movie vs. reading a manga/light novel/book).
const START_STATUS_BY_TYPE: Record<string, string> = {
  anime: 'watching', series: 'watching', movie: 'watching',
  manga: 'reading', lnovel: 'reading', book: 'reading',
};

// Position (0-1) VLC has to reach for an episode to count as "watched" —
// leaves room for trailing credits/next-episode previews the user skips.
const AUTO_MARK_THRESHOLD = 0.8;
const POLL_INTERVAL_MS = 3000;

export function LocalMediaDetailPanel({ item, rootFolder, rootEntries, rootLoading, onClose, onProgressSaved, onRootRefresh }: LocalMediaDetailPanelProps) {
  const t = getT();
  const [subEntries, setSubEntries] = useState<LocalFolderEntry[] | null>(null);
  // Absolute path actually holding the episode files — folderToScan
  // normally, but one level deeper when that folder itself holds no media
  // directly (see the auto-descend effect below).
  const [subContainerPath, setSubContainerPath] = useState<string | null>(null);
  const [subLoading, setSubLoading] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [history, setHistory] = useState<EpisodeHistoryEntry[]>([]);
  // A sequel useLocalMediaEntries deliberately hides from the main grid
  // until its prequel is finished still needs to be reachable from
  // *somewhere* — surfaced here instead, alongside the prequel itself, so
  // either neighbor is one click away regardless of which one is open.
  const [prequelInfo, setPrequelInfo] = useState<{ externalId: string; title: string; cover: string | null } | null>(null);
  const [sequelInfo, setSequelInfo] = useState<{ externalId: string; title: string; cover: string | null } | null>(null);

  // Which episode number the auto-mark already fired for, so a stray extra
  // poll tick (or VLC staying open past the threshold) can't save twice.
  const markedForRef = useRef<number | null>(null);
  const lastPresenceStartRef = useRef<number | null>(null);
  const lastKnownPositionRef = useRef(0);
  // The episode this VLC session is playing, captured once when "Reproducir"
  // is pressed — NOT recomputed from nextNumber while playing. nextNumber
  // advances the instant markWatched() saves progress, and the poll effect
  // used to depend on it directly: marking episode N re-ran the effect with
  // episode N+1, VLC was still sitting at the same >=80% position in the
  // same file (nothing about actual playback changed), so it immediately
  // "auto-marked" N+1 too, then N+2, cascading through the rest of the
  // season in one burst instead of one mark per episode actually watched.
  const sessionEpisodeRef = useRef<number | null>(null);

  // AniList's banner art (wide, no logo/text baked in) instead of the cover
  // — the cover is a portrait poster, stretched across this wide header it
  // just looks like a cropped-in blur of the same image already shown on
  // the card. Falls back to the cover only when this entry has no banner.
  const bannerUrl = item.catalogEntry?.banners_csv?.split(',')[0] || item.cover;

  const candidateTitles = useMemo(
    () => [item.title, item.titleRomaji, item.titleNative].filter((t): t is string => !!t),
    [item],
  );

  // The season this specific library entry belongs to, inferred from its own
  // title (e.g. "... 2nd GIG" -> 2) — needed so a sequel season doesn't get
  // matched against the prequel's folder/files (see folderMatch.ts).
  const itemSeasonFromTitle = useMemo(
    () => candidateTitles.reduce<number | null>((found, t) => found ?? extractTitleSeason(t), null),
    [candidateTitles],
  );
  // Some sequels' titles give no season number at all to extract (roman
  // numerals, a year suffix like "(2003)" instead of a season word) — starts
  // with the instant title-based guess, then upgrades asynchronously via a
  // PREQUEL-chain walk (see resolveOwnSeasonNumber) when that guess is null.
  const [itemSeason, setItemSeason] = useState<number | null>(itemSeasonFromTitle);
  useEffect(() => {
    setItemSeason(itemSeasonFromTitle);
    if (itemSeasonFromTitle != null) return;
    let cancelled = false;
    resolveOwnSeasonNumber(item.externalId, item.title).then(resolved => {
      if (!cancelled && resolved != null) setItemSeason(resolved);
    });
    return () => { cancelled = true; };
  }, [itemSeasonFromTitle, item.externalId, item.title]);

  const matchedFolder = useMemo(
    () => findMatchingFolder(rootEntries, candidateTitles, itemSeason, item.externalId),
    [rootEntries, candidateTitles, itemSeason, item.externalId],
  );

  // A single-episode work (movie, one-shot OVA/special) is often never
  // given its own subfolder at all — the file just sits directly in the
  // root category folder. Only relevant when no folder matched, since a
  // real subfolder (even holding just one file) is handled by the scan
  // effect below instead.
  // A movie doesn't necessarily live in the dedicated "Movies" category —
  // e.g. a Ghost in the Shell film is type 'anime' with catalog format
  // 'MOVIE', tracked right alongside the TV series. Checking format (not
  // just libraryEntry.type) is what actually catches that case.
  const isMovieFormat = item.libraryEntry.type === 'movie' || item.catalogEntry?.format === 'MOVIE';
  const isSingleEpisode = item.catalogEntry?.total_count === 1 || isMovieFormat;
  const rootFileMatch = useMemo(
    () => (isSingleEpisode && !matchedFolder) ? findMatchingFile(rootEntries, candidateTitles, item.externalId) : null,
    [isSingleEpisode, matchedFolder, rootEntries, candidateTitles, item.externalId],
  );

  // Bumped after a successful "Localizar" rename to force the deep-tag scan
  // below to re-check — a nested rename usually doesn't change anything
  // rootEntries/matchedFolder/rootFileMatch would pick up on their own.
  const [deepScanNonce, setDeepScanNonce] = useState(0);
  // A "[external_id]"-tagged folder/file anywhere under rootFolder, found by
  // a bounded recursive scan — covers a work whose folder ended up nested
  // (e.g. two levels under the category root) instead of a direct child of
  // it, which the root-level-only matchedFolder/rootFileMatch fast paths
  // can't see. Only runs once normal matching has already failed, since
  // it's a multi-round-trip scan not worth paying for on every open.
  const [deepTagMatch, setDeepTagMatch] = useState<TaggedMatch | null>(null);
  useEffect(() => {
    setDeepTagMatch(null);
    if (!rootFolder || matchedFolder || rootFileMatch) return;
    let cancelled = false;
    findTaggedPathRecursive(rootFolder, item.externalId).then(found => {
      if (!cancelled) setDeepTagMatch(found);
    });
    return () => { cancelled = true; };
  }, [rootFolder, matchedFolder, rootFileMatch, item.externalId, deepScanNonce]);

  // A deep tag match pointing at a bare file (a movie sharing a folder with
  // other works' files, tagged individually via "Localizar → archivo
  // suelto") is handled like rootFileMatch — no folder to scan into.
  const deepFileMatch = deepTagMatch && !deepTagMatch.isDir ? deepTagMatch : null;

  const folderToScan = useMemo(() => {
    if (matchedFolder && rootFolder) return `${rootFolder}/${matchedFolder.name}`;
    if (deepTagMatch?.isDir) return deepTagMatch.absPath;
    return null;
  }, [matchedFolder, rootFolder, deepTagMatch]);

  useEffect(() => {
    setPlayError(null);
    setIsPlaying(false);
    markedForRef.current = null;
    lastPresenceStartRef.current = null;
    lastKnownPositionRef.current = 0;
    getEpisodeHistory(item.externalId).then(setHistory).catch(() => setHistory([]));
  }, [item.externalId]);

  useEffect(() => {
    setPrequelInfo(null);
    setSequelInfo(null);
    let cancelled = false;
    getMediaRelationsForEditor(item.externalId).then(relations => {
      if (cancelled) return;
      const prequel = relations.find(r => r.relation_type === 'PREQUEL');
      const sequel = relations.find(r => r.relation_type === 'SEQUEL');
      if (prequel) setPrequelInfo({ externalId: prequel.related_media_external_id, title: prequel.title, cover: prequel.cover ?? null });
      if (sequel) setSequelInfo({ externalId: sequel.related_media_external_id, title: sequel.title, cover: sequel.cover ?? null });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [item.externalId]);

  // Opens the Media Editor directly (same event handleEdit itself dispatches
  // below) instead of navigating to /media — only externalId is required,
  // the editor fetches its own catalog/library data for it.
  const openMediaEditor = (externalId: string) => {
    window.dispatchEvent(new CustomEvent('open-profile-editor', { detail: { externalId } }));
  };

  useEffect(() => {
    if (!folderToScan) { setSubEntries(null); setSubContainerPath(null); return; }
    let cancelled = false;
    setSubLoading(true);

    scanFolderContents(folderToScan)
      .then(async entries => {
        if (cancelled) return;
        if (hasMediaFiles(entries)) {
          setSubEntries(entries);
          setSubContainerPath(folderToScan);
          return;
        }

        // Common rip layout: the matched folder is just a wrapper (release-
        // group tag, "[BD 1080p ...]" quality label, etc.) with a single
        // real subfolder holding the actual files — e.g. "Uchouten Kazoku
        // S1+ S2 [BD 1080p x265 FLAC]/Uchouten Kazoku/*.mkv". Only descend
        // when exactly one subfolder qualifies — several media-holding
        // subfolders (e.g. separate TV/OVA/Movie subfolders) means genuine
        // ambiguity about which one this catalog entry actually is, and
        // guessing wrong is worse than surfacing "not found".
        const subdirs = entries.filter(e => e.is_dir);
        if (subdirs.length === 0) { setSubEntries(entries); setSubContainerPath(folderToScan); return; }

        const scans = await Promise.all(
          subdirs.map(d => scanFolderContents(`${folderToScan}/${d.name}`).catch(() => [] as LocalFolderEntry[]))
        );
        if (cancelled) return;
        const withMedia = scans.map((s, i) => ({ dir: subdirs[i], entries: s })).filter(x => hasMediaFiles(x.entries));

        if (withMedia.length === 1) {
          setSubEntries(withMedia[0].entries);
          setSubContainerPath(`${folderToScan}/${withMedia[0].dir.name}`);
        } else {
          setSubEntries(entries);
          setSubContainerPath(folderToScan);
        }
      })
      .catch(() => { if (!cancelled) { setSubEntries([]); setSubContainerPath(folderToScan); } })
      .finally(() => { if (!cancelled) setSubLoading(false); });

    return () => { cancelled = true; };
  }, [folderToScan]);

  // Some multi-season folders (e.g. "The Big O" - 01..26, seasons 1 and 2
  // sharing one folder with continuous bare numbering, no S01/S02 markers
  // anywhere) can't be told apart by season at all — this season's own
  // "episode 1" is really file 14, not file 01. Sums the preceding seasons'
  // own total_count (via resolveSeasonExternalIds) and offsets the target
  // episode number by that before searching, but ONLY when the folder truly
  // has no season markers on any file — one that does (like Ghost in the
  // Shell's S01/S02 filenames) already disambiguates itself, and adding an
  // offset on top of that would double-count.
  const [seasonOffset, setSeasonOffset] = useState(0);
  useEffect(() => {
    setSeasonOffset(0);
    if (!subEntries || itemSeason == null || itemSeason <= 1) return;
    const anySeasonMarked = subEntries.some(e => !e.is_dir && MEDIA_EXTENSIONS.test(e.name) && extractEpisodeInfo(e.name)?.season != null);
    if (anySeasonMarked) return;

    let cancelled = false;
    (async () => {
      const seasonMap = await resolveSeasonExternalIds(item.externalId, item.title, itemSeason);
      let total = 0;
      for (let s = 1; s < itemSeason; s++) {
        const info = seasonMap[s];
        if (!info) { total = 0; break; }
        const entry = await getCatalogEntry(info.externalId).catch(() => null);
        if (!entry?.total_count) { total = 0; break; }
        total += entry.total_count;
      }
      if (!cancelled) setSeasonOffset(total);
    })();
    return () => { cancelled = true; };
  }, [subEntries, itemSeason, item.externalId, item.title]);

  // The next episode/chapter to watch/read — one past whatever's saved as
  // progress, or the first one when the entry is still just "planning".
  // nextNumber itself stays season-relative (progress/history/marking are
  // all tracked per this season's own 1..N numbering) — only the file
  // lookup below gets the absolute-numbering offset added on top.
  const nextNumber = item.status === 'planning' ? 1 : item.progress + 1;
  const nextFile = deepFileMatch
    ? { name: deepFileMatch.absPath.slice(dirname(deepFileMatch.absPath).length + 1), is_dir: false, size: 0 } as LocalFolderEntry
    : rootFileMatch ?? (subEntries
    ? findMatchingEpisodeFile(subEntries, nextNumber + seasonOffset, itemSeason)
      // A single-episode work's lone file often has no episode number
      // anywhere in its name (a movie filename has nothing to number) — the
      // numeric match above always misses it, but there's nothing else it
      // could be.
      ?? (isSingleEpisode ? soleMediaFile(subEntries) : null)
    : null);
  // Filenames like "... S01 E01 - SA - Section-9 ...mkv" carry the actual
  // episode title right there — show that instead of the raw filename when
  // it's there, since it's usually far more readable.
  const nextFileEpisodeTitle = nextFile ? extractEpisodeInfo(nextFile.name)?.episodeTitle ?? null : null;
  // media_catalog's total_count is the known episode/chapter count (kept
  // fresh for RELEASING shows too — see media-status.ts's weekly resync).
  // Once nextNumber goes past it there simply isn't a "next" one yet/ever —
  // that's not a missing-file problem, so it shouldn't render like one.
  const totalCount = item.catalogEntry?.total_count ?? null;
  const isCaughtUp = totalCount != null && totalCount > 0 && nextNumber > totalCount;

  const playContainer = deepFileMatch
    ? dirname(deepFileMatch.absPath)
    : rootFileMatch
    ? (rootFolder ?? null)
    : subContainerPath;
  const playPath = playContainer && nextFile ? `${playContainer}/${nextFile.name}` : null;

  const handleEdit = () => {
    window.dispatchEvent(new CustomEvent('open-profile-editor', {
      detail: {
        externalId:  item.externalId,
        libraryEntry: item.libraryEntry,
        catalogEntry: item.catalogEntry,
      },
    }));
  };

  // "Localizar" — escape hatch for when automatic matching fails: the user
  // picks the actual folder (or, for a folder shared with other distinct
  // works, a single file) themselves, and it gets renamed to a format the
  // matcher always recognizes afterward — no need to be a direct child of
  // rootFolder, since findTaggedPathRecursive above searches at any depth;
  // renaming always happens in place (same parent), never moving anything.
  // Files aren't touched until the user reviews and confirms the exact plan.
  const [locateMenuOpen, setLocateMenuOpen] = useState(false);
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
      const seasonMap = await resolveSeasonExternalIds(item.externalId, item.title, itemSeason);
      const plan = buildLocateRenamePlan(entries, item.title, item.externalId, itemSeason, seasonMap);
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
      setDeepScanNonce(n => n + 1);
      await onRootRefresh();
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
    const episodeTitle = info?.episodeTitle ? sanitizeForFilename(info.episodeTitle) : '';
    const ext = oldName.match(/\.[a-z0-9]+$/i)?.[0] ?? '';
    const parts = [formatEpisodeLabel(itemSeason, episode), titleSanitized, episodeTitle].filter(Boolean);
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
      setDeepScanNonce(n => n + 1);
      await onRootRefresh();
    } catch (err) {
      setLocateError(err instanceof Error ? err.message : 'Fallo al renombrar.');
    } finally {
      setLocateBusy(false);
    }
  };

  const handlePlay = () => {
    if (!playPath) return;
    setPlayError(null);
    sessionEpisodeRef.current = nextNumber;
    markedForRef.current = null;
    lastKnownPositionRef.current = 0;
    playFileWithVlc(playPath)
      .then(() => setIsPlaying(true))
      .catch(err => setPlayError(String(err)));
  };

  const markWatched = async (episodeNumber: number) => {
    if (markedForRef.current === episodeNumber) return;
    markedForRef.current = episodeNumber;

    // Reaching the last episode/chapter BY ACTUALLY PLAYING IT through the
    // app is what completes a work here — not just "progress caught up to
    // total_count" in the abstract, since that same condition could also be
    // true from a manual edit elsewhere that isn't "just finished watching."
    const finishing = totalCount != null && totalCount > 0 && episodeNumber >= totalCount;
    const nextStatus = finishing
      ? 'completed'
      : item.status === 'planning'
      ? (START_STATUS_BY_TYPE[item.libraryEntry.type] ?? item.status)
      : item.libraryEntry.status;

    const startedAt = item.libraryEntry.started_at ?? new Date().toISOString();
    const finishedAt = finishing ? new Date().toISOString() : item.libraryEntry.finished_at;

    try {
      await saveLibraryEntry({
        ...item.libraryEntry,
        progress:    episodeNumber,
        status:      nextStatus,
        started_at:  startedAt,
        finished_at: finishedAt,
      });
      onProgressSaved();
      saveEpisodeHistoryEntry(item.externalId, episodeNumber)
        .then(() => getEpisodeHistory(item.externalId))
        .then(setHistory)
        .catch(err => console.error('Failed to save episode history', err));
      // Only from actually finishing it here — see addSequelToPlanning's own
      // comment for why this doesn't live inside saveLibraryEntry itself.
      if (finishing) {
        addSequelToPlanning(item.externalId).catch(err => console.error('Failed to auto-add sequel to planning:', err));
      }
      // MediaEditorModal's own save does this too — the auto-mark-on-watch
      // flow here saves straight to saveLibraryEntry (bypassing that modal
      // entirely), so without this an episode watched through the local
      // player updated progress in-app but never reached AniList at all.
      if (isAniListType(item.libraryEntry.type)) {
        syncToAniList({
          externalId:      item.externalId,
          type:            item.libraryEntry.type,
          status:          nextStatus ?? '',
          rating:          item.libraryEntry.rating ?? 0,
          progress:        episodeNumber,
          progressVolumes: item.libraryEntry.progress_2 ?? 0,
          startedAt:       startedAt ?? '',
          finishedAt:      finishedAt ?? '',
          notes:           item.libraryEntry.notes ?? '',
        }).catch(err => console.error('Failed to sync watched episode to AniList:', err));
      }
    } catch (err) {
      // Don't block the next poll tick from retrying on a transient save error.
      markedForRef.current = null;
      console.error('Failed to auto-mark episode watched', err);
    }
  };

  // While VLC is playing the file we just launched, poll its HTTP status
  // interface and mark the episode watched once position crosses 80%.
  // Deliberately only depends on isPlaying — the episode being watched is
  // fixed for the whole session via sessionEpisodeRef (see handlePlay's
  // comment), not re-read from nextNumber, which changes the moment this
  // effect's own markWatched() call saves progress.
  useEffect(() => {
    if (!isPlaying) return;
    const episodeNumber = sessionEpisodeRef.current;
    if (episodeNumber == null) return;

    const interval = setInterval(() => {
      getVlcPlaybackStatus().then(status => {
        if (!status || (status.state !== 'playing' && status.state !== 'paused')) {
          // VLC stopped responding (closed) or moved to "stopped"/ended —
          // this is exactly the tick that would observe "episode finished",
          // so it can't just bail without checking: use the last position
          // seen while still playing/paused, since a "stopped" status often
          // no longer reports a meaningful position of its own.
          if (lastKnownPositionRef.current >= AUTO_MARK_THRESHOLD) {
            markWatched(episodeNumber);
          }
          setIsPlaying(false);
          return;
        }

        lastKnownPositionRef.current = status.position;

        // Live Discord Rich Presence updates with time remaining countdown
        if (status.state === 'playing') {
          const nowSec = Math.floor(Date.now() / 1000);
          const computedStart = nowSec - status.time;
          const computedEnd = computedStart + status.length;

          if (
            lastPresenceStartRef.current === null ||
            Math.abs(lastPresenceStartRef.current - computedStart) > 4
          ) {
            lastPresenceStartRef.current = computedStart;
            const coverUrl = item.cover && item.cover.startsWith('http') ? item.cover : undefined;
            updateDiscordPresence(`Watching ${item.title} - Episode ${episodeNumber}`, "", computedStart, computedEnd, coverUrl, item.title, "metadea", "Metadea").catch(() => {});
          }
        } else if (status.state === 'paused') {
          if (lastPresenceStartRef.current !== null) {
            lastPresenceStartRef.current = null;
            const coverUrl = item.cover && item.cover.startsWith('http') ? item.cover : undefined;
            updateDiscordPresence(`Watching ${item.title} - Episode ${episodeNumber}`, "Paused", undefined, undefined, coverUrl, item.title, "metadea", "Metadea").catch(() => {});
          }
        }

        if (status.position >= AUTO_MARK_THRESHOLD) {
          markWatched(episodeNumber);
        }
      }).catch(() => {
        setIsPlaying(false);
      });
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isPlaying, item.title, item.cover]);

  useEffect(() => {
    if (isPlaying) {
      const episodeNumber = sessionEpisodeRef.current ?? nextNumber;
      const coverUrl = item.cover && item.cover.startsWith('http') ? item.cover : undefined;
      updateDiscordPresence(`Watching ${item.title} - Episode ${episodeNumber}`, "", undefined, undefined, coverUrl, item.title, "metadea", "Metadea").catch(() => {});
    } else {
      lastPresenceStartRef.current = null;
      resetDiscordPresence().catch(() => {});
    }
    return () => {
      lastPresenceStartRef.current = null;
      resetDiscordPresence().catch(() => {});
    };
  }, [isPlaying, item.title, item.cover]);

  return (
    <div className="local-game-detail-panel">
      <div className="local-game-detail-header">
        <button className="local-game-detail-back" onClick={onClose} title={t.local.close_panel}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
        </button>
        {bannerUrl ? (
          <img src={bannerUrl} alt={item.title} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-elevated)' }}>
            <IconFolder />
          </div>
        )}
        <div className="local-game-detail-backdrop" />
        <button className="local-game-detail-close" onClick={onClose}><IconX /></button>
      </div>

      <div className="local-game-detail-content">
        <div className="local-game-detail-sticky-bar">
          <div className="local-media-detail-top-row">
            <p className="local-game-detail-title">{item.title}</p>
            <div className="local-media-detail-icon-actions">
              <div className="local-media-detail-locate-wrap">
                <button
                  type="button"
                  className="local-media-detail-locate-btn"
                  onClick={() => setLocateMenuOpen(v => !v)}
                  disabled={locateBusy || !rootFolder}
                  title="Localizar manualmente"
                >
                  {locateBusy ? <span className="spinner spinner--sm" /> : <IconFolder size={14} strokeWidth={2} />}
                </button>
                {locateMenuOpen && (
                  <div className="local-media-detail-locate-menu">
                    <button type="button" onClick={handleLocateFolder}>Elegir carpeta</button>
                    <button type="button" onClick={handleLocateSingleFile}>Elegir un archivo suelto</button>
                  </div>
                )}
              </div>
              <button type="button" className="local-media-detail-edit-icon" onClick={handleEdit} title={t.local.edit_catalog_log}>
                <IconPencil />
              </button>
              <a href={`/media?id=${item.externalId}`} className="local-game-detail-catalog-link">
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
                Ver en catálogo
              </a>
            </div>
          </div>
        </div>

        {playError && (
          <p className="local-media-play-error">No se pudo abrir VLC: {playError}</p>
        )}

        {locateError && !locatePreview && !locateFilePreview && (
          <p className="local-media-play-error">{locateError}</p>
        )}

        {!rootFolder ? (
          <div className="local-state-placeholder">
            <IconFolder />
            <p>{t.local.no_folder_for_category}</p>
          </div>
        ) : rootLoading ? (
          <div className="local-state-placeholder"><div className="spinner" /></div>
        ) : (
          <div className={`local-media-info-row${(prequelInfo || sequelInfo) ? ' local-media-info-row--has-neighbors' : ''}`}>
            <div className="local-media-left-col">
              <button
                type="button"
                className="local-game-detail-play"
                disabled={!playPath}
                title={playPath ? undefined : isCaughtUp ? 'Ya estás al día' : isMovieFormat ? 'No se encontró el archivo de la película' : 'No se encontró el archivo del próximo episodio/capítulo'}
                onClick={handlePlay}
              >
                {isPlaying ? (
                  <span className="spinner spinner--sm" />
                ) : (
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                )}
                {isPlaying ? 'Reproduciendo' : 'Reproducir'}
              </button>
              <div className="local-media-divider-line" />
              <div className="local-media-match-row">
                {(matchedFolder || rootFileMatch || deepTagMatch) && (
                  subLoading ? (
                    <span className="local-media-match-chip">
                      <div className="spinner spinner--sm" />
                      Buscando próximo episodio…
                    </span>
                  ) : isCaughtUp ? (
                    <span className="local-media-match-chip ok">
                      <IconCheck />
                      Al día — no hay episodios/capítulos nuevos ({totalCount} en total)
                    </span>
                  ) : (
                    <span className={`local-media-match-chip${nextFile ? ' ok' : ' fail'}`}>
                      {nextFile ? <IconCheck /> : <IconAlertCircle />}
                      {nextFile ? (
                        <>
                          {t.local.next_episode_label} <strong>
                            {isMovieFormat || totalCount === 1
                              ? (nextFileEpisodeTitle || cleanFilenameForDisplay(nextFile.name))
                              : `${formatEpisodeLabel(itemSeason, nextNumber)} - ${nextFileEpisodeTitle || cleanFilenameForDisplay(nextFile.name)}`}
                          </strong>
                        </>
                      ) : (
                        isMovieFormat ? 'Película no encontrada' : `Próximo episodio (${nextNumber}) no encontrado`
                      )}
                    </span>
                  )
                )}
              </div>
            </div>

            {(prequelInfo || sequelInfo) && (
              <div className="local-media-neighbors-row">
                <div className="local-media-neighbors-grid">
                  {prequelInfo && (
                    <button type="button" className="local-media-neighbor-link" title={prequelInfo.title} onClick={() => openMediaEditor(prequelInfo.externalId)}>
                      {prequelInfo.cover
                        ? <img className="local-media-neighbor-cover" src={prequelInfo.cover} alt={prequelInfo.title} />
                        : <div className="local-media-neighbor-cover local-media-neighbor-cover--fallback"><IconFolder size={20} strokeWidth={2} /></div>}
                      <span className="local-media-neighbor-label">Precuela</span>
                    </button>
                  )}
                  {sequelInfo && (
                    <button type="button" className="local-media-neighbor-link" title={sequelInfo.title} onClick={() => openMediaEditor(sequelInfo.externalId)}>
                      {sequelInfo.cover
                        ? <img className="local-media-neighbor-cover" src={sequelInfo.cover} alt={sequelInfo.title} />
                        : <div className="local-media-neighbor-cover local-media-neighbor-cover--fallback"><IconFolder size={20} strokeWidth={2} /></div>}
                      <span className="local-media-neighbor-label">Secuela</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {history.length > 0 && (
          <div className="local-media-history">
            <p className="local-media-history-title">{t.local.history_label}</p>
            <div className="local-media-history-feed">
              {history.map(h => (
                <div key={h.id} className="local-media-history-item">
                  <IconCheck />
                  <span>{t.local.episode_chapter_label} <strong>{h.episode_number}</strong></span>
                  <span className="local-media-history-date">{formatWatchedAt(h.watched_at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {locatePreview && createPortal(
        <div className="locate-preview-overlay" onClick={() => !locateBusy && setLocatePreview(null)}>
          <div className="locate-preview-modal" onClick={e => e.stopPropagation()}>
            <h3 className="locate-preview-title">Renombrar para detección automática</h3>
            <p className="locate-preview-hint">
              Esto renombra la carpeta y sus archivos en tu disco. Revisa antes de confirmar.
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
                  Obras relacionadas encontradas en carpetas vecinas (películas, OVAs...):
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
                Cancelar
              </button>
              <button type="button" className="pr-editor-btn pr-editor-btn--submit" onClick={handleLocateConfirm} disabled={locateBusy}>
                {locateBusy ? 'Renombrando...' : 'Confirmar y renombrar'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {locateFilePreview && createPortal(
        <div className="locate-preview-overlay" onClick={() => !locateBusy && setLocateFilePreview(null)}>
          <div className="locate-preview-modal" onClick={e => e.stopPropagation()}>
            <h3 className="locate-preview-title">Renombrar archivo</h3>
            <p className="locate-preview-hint">
              Solo se renombra este archivo — sus hermanos en la misma carpeta no se tocan.
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
                Cancelar
              </button>
              <button type="button" className="pr-editor-btn pr-editor-btn--submit" onClick={handleLocateFileConfirm} disabled={locateBusy}>
                {locateBusy ? 'Renombrando...' : 'Confirmar y renombrar'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
