import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  scanFolderContents, getCatalogEntry,
  type LocalFolderEntry,
} from '../../../lib/tauri';
import { ReaderModal } from '../../reader/ReaderModal';
import { setReadingSession } from '../../../lib/reader/reading-session';
import { getT } from '../../../i18n/runtime';
import type { LocalMediaItem } from '../hooks/useLocalMediaEntries';
import {
  findMatchingFolder, findMatchingEpisodeFile, findMatchingFile, soleMediaFile,
  extractEpisodeInfo, extractTitleSeason, hasMediaFiles, cleanFilenameForDisplay,
  formatEpisodeLabel, dirname,
  MEDIA_EXTENSIONS, isRedundantEpisodeName,
} from '../../../lib/local/folder-match';
import { resolveSeasonExternalIds, resolveOwnSeasonNumber } from '../../../lib/local/season-resolve';
import { usePlaybackState } from '../hooks/usePlaybackState';
import {
  startQueuePlayback, pausePlayback, resumePlayback,
  type PlaybackQueueItem,
} from '../../../lib/local/playback-service';
import { formatPlaybackTime } from '../../../lib/local/formatters';
import { catalogReleaseTimestampMs, firstCsvUrl } from '../../../lib/media/mappers/mapper-utils';
import { isReadingType } from '../../../lib/media/media-types';
import { formatDateLong } from '../../../lib/shared/text/format-date';
import { useAsyncResource } from '../../shared/hooks/useAsyncResource';
import { IconFolder, IconPencil } from '../ui/icons';
import { CatalogLinkIcon } from './CatalogLinkIcon';
import { useMediaNeighbors } from '../hooks/useMediaNeighbors';
import { useEditionProbe } from '../hooks/useEditionProbe';
import { useDeepTagScan } from '../hooks/useDeepTagScan';
import { useEpisodeHistory } from '../hooks/useEpisodeHistory';
import { useEpisodeNames } from '../hooks/useEpisodeNames';
import { useResumeState } from '../hooks/useResumeState';
import { NeighborsRow } from './NeighborsRow';
import { openMediaEditor } from '../../../lib/media/editor/open-media-editor';
import { MediaScreenshotsSection } from './MediaScreenshotsSection';
import { EpisodeHistoryList } from './EpisodeHistoryList';
import { useLocateFileFlow, LocateButton, LocatePreviewModals } from './LocateFileFlow';

interface LocalMediaDetailPanelProps {
  item:            LocalMediaItem;
  rootFolder:      string | undefined;
  rootEntries:     LocalFolderEntry[];
  rootLoading:     boolean;
  // Invoked by this panel's own back/close button — owned by DetailPanelShell
  // (see LocalMediaSection), which plays the slide-out animation and only
  // unmounts this component once it's actually finished.
  onCloseClick:    () => void;
  onProgressSaved: () => void;
  // Re-reads rootFolder's contents after the "Localizar" flow renames a
  // folder/its files — otherwise the freshly-renamed folder stays invisible
  // to matchedFolder/rootFileMatch until something else happens to trigger
  // a rescan (switching category and back, reopening the app).
  onRootRefresh:   () => Promise<void>;
  autoResume?: boolean;
  onAutoResumeHandled?: () => void;
}

export function LocalMediaDetailPanel({ item, rootFolder, rootEntries, rootLoading, onCloseClick, onProgressSaved, onRootRefresh, autoResume, onAutoResumeHandled }: LocalMediaDetailPanelProps) {
  const t = getT();
  const [subEntries, setSubEntries] = useState<LocalFolderEntry[] | null>(null);
  // Absolute path actually holding the episode files — folderToScan
  // normally, but one level deeper when that folder itself holds no media
  // directly (see the auto-descend effect below).
  const [subContainerPath, setSubContainerPath] = useState<string | null>(null);
  const [subLoading, setSubLoading] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  // The one global playback-service.ts instance, not per-panel state — reads
  // as "idle" for this item whenever the shared session belongs to some
  // other item (or nothing at all), so this naturally reflects the real
  // state on every render/remount with no restore-on-mount logic needed.
  const playback = usePlaybackState();
  const isThisPlaying = playback?.externalId === item.externalId;
  const playState: 'idle' | 'playing' | 'paused' = isThisPlaying ? playback!.status : 'idle';
  // A sequel useLocalMediaEntries deliberately hides from the main grid
  // until its prequel is finished still needs to be reachable from
  // *somewhere* — surfaced here instead, alongside the prequel itself, so
  // either neighbor is one click away regardless of which one is open.
  // Same resolution GameDetailPanel uses (PARENT/edition-matching/bundle
  // children included, not just a plain PREQUEL/SEQUEL lookup) — see
  // useMediaNeighbors.
  const { prequel: prequelInfo, sequel: sequelInfo, bundleChildren } = useMediaNeighbors(item.externalId, item.title);

  // AniList's banner art (wide, no logo/text baked in) instead of the cover
  // — the cover is a portrait poster, stretched across this wide header it
  // just looks like a cropped-in blur of the same image already shown on
  // the card. Falls back to the cover only when this entry has no banner.
  const bannerUrl = firstCsvUrl(item.catalogEntry?.banners_csv) || item.cover;

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
  // The title gives an instant guess, then the PREQUEL chain can correct it
  // when installment numbering differs from the actual season order.
  const { value: resolvedSeason, loading: seasonResolving } = useAsyncResource<number | null>(
    () => resolveOwnSeasonNumber(item.externalId, item.title),
    [itemSeasonFromTitle, item.externalId, item.title],
    null,
  );
  const itemSeason = (!seasonResolving && resolvedSeason != null) ? resolvedSeason : itemSeasonFromTitle;

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

  const hasSingleTomoEdition = useEditionProbe(item);

  const isReading = isReadingType(item.libraryEntry.type);
  const totalVols = item.catalogEntry?.total_count_2 ?? null;
  const hasDefinedVols = isReading && totalVols != null && totalVols > 0;
  const isSingleEpisode = hasDefinedVols
    ? totalVols === 1
    : (item.catalogEntry?.total_count === 1 || isMovieFormat || hasSingleTomoEdition);

  // Same "not released yet" rule LocalMediaSection uses to group things into
  // "Sin estrenar" — null release_year counts as unreleased too, since
  // there's nothing on file to say otherwise. Opening one of those items
  // here shouldn't show a "file/episode not found" error (there's nothing to
  // find, it hasn't come out) — show when it's actually coming out instead.
  const releaseTimestamp = catalogReleaseTimestampMs(item.catalogEntry);
  const isUnreleased = releaseTimestamp === null || releaseTimestamp > Date.now();
  const releaseLabel = releaseTimestamp !== null
    ? t.local.will_release_on.replace('{date}', formatDateLong(new Date(releaseTimestamp)))
    : t.local.will_release_soon;
  const rootFileMatch = useMemo(
    () => (isSingleEpisode && !matchedFolder) ? findMatchingFile(rootEntries, candidateTitles, item.externalId) : null,
    [isSingleEpisode, matchedFolder, rootEntries, candidateTitles, item.externalId],
  );

  const { deepTagMatch, deepTagSearchComplete, rescan: rescanDeepTags } = useDeepTagScan(item, rootFolder, matchedFolder, rootFileMatch);

  // A deep tag match pointing at a bare file (a movie sharing a folder with
  // other works' files, tagged individually via "Localizar → archivo
  // suelto") is handled like rootFileMatch — no folder to scan into.
  const deepFileMatch = deepTagMatch && !deepTagMatch.isDir ? deepTagMatch : null;

  const folderToScan = useMemo(() => {
    if (matchedFolder && rootFolder) return `${rootFolder}/${matchedFolder.name}`;
    if (deepTagMatch?.isDir) return deepTagMatch.absPath;
    return null;
  }, [matchedFolder, rootFolder, deepTagMatch]);

  const { currentHistory, historyMenu, setHistoryMenu, deleteHistoryEntry } = useEpisodeHistory(item, itemSeason, onProgressSaved);

  // A stale VLC-launch error shouldn't outlive the work it belonged to —
  // cleared on the exact same triggers that refetch the chain history.
  useEffect(() => {
    setPlayError(null);
  }, [item.externalId, item.title, itemSeason]);

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
  const { value: seasonOffsetValue, loading: seasonOffsetLoading } = useAsyncResource<number>(async () => {
    if (!subEntries || itemSeason == null || itemSeason <= 1) return 0;
    const anySeasonMarked = subEntries.some(e => !e.is_dir && MEDIA_EXTENSIONS.test(e.name) && extractEpisodeInfo(e.name)?.season != null);
    if (anySeasonMarked) return 0;

    const seasonMap = await resolveSeasonExternalIds(item.externalId, item.title, itemSeason);
    let total = 0;
    for (let s = 1; s < itemSeason; s++) {
      const info = seasonMap[s];
      if (!info) { total = 0; break; }
      const entry = await getCatalogEntry(info.externalId).catch(() => null);
      if (!entry?.total_count) { total = 0; break; }
      total += entry.total_count;
    }
    return total;
  }, [subEntries, itemSeason, item.externalId, item.title], 0);
  const seasonOffset = seasonOffsetLoading ? 0 : seasonOffsetValue;

  const nextNumber = item.status === 'planning'
    ? 1
    : hasDefinedVols
    ? Math.floor(item.libraryEntry.progress_2 ?? 0) + 1
    : item.progress + 1;

  const totalCount = hasDefinedVols
    ? totalVols
    : (item.catalogEntry?.total_count ?? null);
  const isCaughtUp = totalCount != null && totalCount > 0 && nextNumber > totalCount;

  const mediaFiles = useMemo(() => {
    if (!subEntries) return [];
    return subEntries.filter(e => !e.is_dir && MEDIA_EXTENSIONS.test(e.name));
  }, [subEntries]);

  const sortedMediaFiles = useMemo(() => {
    return [...mediaFiles].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );
  }, [mediaFiles]);

  const tomosMismatch = hasDefinedVols && subEntries !== null && mediaFiles.length !== totalVols;

  const nextFile = useMemo<LocalFolderEntry | null>(() => {
    if (tomosMismatch) return null;
    if (deepFileMatch) {
      return { name: deepFileMatch.absPath.slice(dirname(deepFileMatch.absPath).length + 1), is_dir: false, size: 0 } as LocalFolderEntry;
    }
    if (rootFileMatch) return rootFileMatch;
    if (!subEntries) return null;

    if (isReading) {
      const match = findMatchingEpisodeFile(subEntries, nextNumber, null);
      if (match) return match;
      if (hasDefinedVols && !tomosMismatch && nextNumber >= 1 && nextNumber <= sortedMediaFiles.length) {
        return sortedMediaFiles[nextNumber - 1];
      }
      return isSingleEpisode ? soleMediaFile(subEntries) : null;
    }

    return findMatchingEpisodeFile(subEntries, nextNumber + seasonOffset, itemSeason)
      ?? ((isSingleEpisode || isReading) ? soleMediaFile(subEntries) : null);
  }, [
    tomosMismatch, deepFileMatch, rootFileMatch, subEntries, isReading,
    nextNumber, hasDefinedVols, sortedMediaFiles, isSingleEpisode,
    seasonOffset, itemSeason,
  ]);

  const isBookOrNovel = item.libraryEntry.type === 'lnovel' || item.libraryEntry.type === 'book';
  // extractEpisodeInfo's episodeTitle can itself just be this work's own
  // name again (its "nothing meaningful follows the number" fallback grabs
  // whatever text sits BEFORE it instead — always just the title for the
  // common "Show Name - 14 (quality tags)" naming convention) — redundancy-
  // checked so junk falls through to the fetched provider name below
  // instead of blocking it.
  const nextFileEpisodeTitleRaw = (nextFile && !isBookOrNovel) ? extractEpisodeInfo(nextFile.name)?.episodeTitle ?? null : null;
  const nextFileEpisodeTitle = (nextFileEpisodeTitleRaw && !isRedundantEpisodeName(nextFileEpisodeTitleRaw, item.title)) ? nextFileEpisodeTitleRaw : null;

  const episodeNames = useEpisodeNames(item, isReading, isMovieFormat, currentHistory);

  const [readerOpen, setReaderOpen] = useState(false);
  const { resumeSeconds, readingProgress } = useResumeState(item, nextNumber, isThisPlaying, isReading, readerOpen);

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

  const locate = useLocateFileFlow({
    item, rootFolder, itemSeason, isBookOrNovel,
    onRenamed: async () => {
      rescanDeepTags();
      await onRootRefresh();
    },
  });
  const { locateError, locatePreview, locateFilePreview } = locate;

  // Builds the queue starting at nextNumber and hands it to playback-service
  // — every remaining episode this folder actually has a file for, not just
  // the one about to play, so VLC queues the whole rest of the season in one
  // launch. Multi-episode queueing only makes sense for a real per-episode
  // folder (subEntries); a movie/deep-tagged/root single-file match is just
  // the one file, nothing to queue after it.
  const handlePlay = () => {
    if (!playPath || !nextFile) return;
    setPlayError(null);

    const playbackEpisodeTitle = (episodeNumber: number, fileName: string): string | undefined => {
      const fetchedName = episodeNames.get(`${item.externalId}|${episodeNumber}`);
      if (fetchedName && !isRedundantEpisodeName(fetchedName, item.title)) return fetchedName;
      const parsedName = extractEpisodeInfo(fileName)?.episodeTitle;
      return parsedName && !isRedundantEpisodeName(parsedName, item.title) ? parsedName : undefined;
    };
    const queue: PlaybackQueueItem[] = [{
      episodeNumber: nextNumber,
      filePath: playPath,
      seasonNumber: itemSeason ?? 1,
      episodeTitle: playbackEpisodeTitle(nextNumber, nextFile.name),
    }];
    if (subEntries && subContainerPath && !deepFileMatch && !rootFileMatch) {
      let n = nextNumber + 1;
      while (totalCount == null || totalCount <= 0 || n <= totalCount) {
        const file = findMatchingEpisodeFile(subEntries, n + seasonOffset, itemSeason);
        if (!file) break;
        queue.push({
          episodeNumber: n,
          filePath: `${subContainerPath}/${file.name}`,
          seasonNumber: itemSeason ?? 1,
          episodeTitle: playbackEpisodeTitle(n, file.name),
        });
        n++;
        if (queue.length >= 500) break; // sanity guard against a runaway loop
      }
    }

    startQueuePlayback({
      externalId:   item.externalId,
      type:         item.libraryEntry.type,
      title:        item.title,
      cover:        item.cover,
      libraryEntry: item.libraryEntry,
      totalCount,
      queue,
    }).catch(err => setPlayError(String(err)));
  };

  // Once playback-service.ts actually has a session for this item, the play
  // button becomes a real pause/resume toggle (VLC's own HTTP commands,
  // no relaunching a second process) instead of only ever launching fresh.
  const handlePlayButtonClick = () => {
    if (isThisPlaying) {
      if (playback!.status === 'playing') pausePlayback();
      else resumePlayback();
      return;
    }
    handlePlay();
  };

  const autoResumeHandledRef = useRef(false);
  useEffect(() => {
    if (!autoResume) { autoResumeHandledRef.current = false; return; }
    if (autoResumeHandledRef.current || rootLoading || subLoading || !deepTagSearchComplete) return;
    if ((matchedFolder || deepTagMatch?.isDir) && subEntries === null) return;

    autoResumeHandledRef.current = true;
    if (playPath && nextFile) {
      if (isReading) setReaderOpen(true);
      else if (isThisPlaying) {
        if (playback?.status === 'paused') resumePlayback();
      } else {
        handlePlay();
      }
    }
    onAutoResumeHandled?.();
  }, [autoResume, rootLoading, subLoading, deepTagSearchComplete, matchedFolder, deepTagMatch, subEntries, playPath, nextFile, isReading, isThisPlaying, playback?.status, handlePlay, onAutoResumeHandled]);

  // Shared by both the ReaderModal prop and the stand-by session it can
  // hand off to (onStandBy below) — computed once instead of twice.
  const readerTitle = isSingleEpisode
    ? item.title
    : `${item.title} - ${formatEpisodeLabel(itemSeason, nextNumber, item.libraryEntry.type)}`;
  const activePlaybackItem = isThisPlaying ? playback!.queue[playback!.queueIndex] : null;
  const activePlaybackCode = activePlaybackItem
    ? formatEpisodeLabel(activePlaybackItem.seasonNumber ?? itemSeason, activePlaybackItem.episodeNumber, item.libraryEntry.type)
    : '';
  const activePlaybackTitle = activePlaybackItem
    ? activePlaybackItem.episodeTitle ?? episodeNames.get(`${item.externalId}|${activePlaybackItem.episodeNumber}`)
    : undefined;
  const playingButtonLabel = activePlaybackCode
    ? `Reproduciendo ${activePlaybackCode}${activePlaybackTitle ? ` - ${activePlaybackTitle}` : ''}`
    : 'Reproduciendo';

  return (
    <>
      <div className="local-game-detail-header">
        <button className="local-game-detail-back" onClick={onCloseClick} title={t.local.close_panel}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
        </button>
        {/* Keyed by this item's identity — same crossfade-on-remount
            treatment as GameDetailPanel's own banner (see its comment) —
            a plain src swap on the same <img> node otherwise changes the
            pixels instantly with no transition. */}
        <div className="local-game-detail-banner-wrap" key={item.externalId}>
          {bannerUrl ? (
            <img className="cover-image-fill" src={bannerUrl} alt={item.title} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-elevated)' }}>
              <IconFolder />
            </div>
          )}
        </div>
        <div className="local-game-detail-backdrop" />
      </div>

      <div className="local-game-detail-content">
        <div className="local-game-detail-sticky-bar">
          <div className="local-media-detail-top-row">
            <p className="local-game-detail-title">{item.title}</p>
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
          <div className={`local-media-info-row${(prequelInfo || sequelInfo || bundleChildren.length > 0) ? ' local-media-info-row--has-neighbors' : ''}`}>
            <div className="local-media-left-col">
              {isReading ? (
                <button
                  type="button"
                  className="local-game-detail-play"
                  disabled={isUnreleased || !playPath}
                  title={isUnreleased ? releaseLabel : playPath ? undefined : isCaughtUp ? 'Ya estás al día' : tomosMismatch ? `Se esperaban exactamente ${totalVols} tomos en la carpeta (encontrados: ${mediaFiles.length})` : (item.libraryEntry.type === 'comic' && isSingleEpisode) ? 'Volumen no encontrado' : 'No se encontró el archivo del próximo volumen'}
                  onClick={() => setReaderOpen(true)}
                >
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                  </svg>
                  {isUnreleased
                    ? releaseLabel
                    : readingProgress
                    ? (isSingleEpisode
                      ? `Seguir por la página ${readingProgress.pageNumber}`
                      : item.libraryEntry.type === 'comic'
                      ? `Seguir por la página ${readingProgress.pageNumber} del número ${nextNumber}`
                      : `Seguir por la página ${readingProgress.pageNumber} del volumen ${nextNumber}`)
                    : 'Empezar a leer'}
                </button>
              ) : (
                <button
                  type="button"
                  className={`local-game-detail-play${playState === 'paused' ? ' local-game-detail-play--paused' : ''}`}
                  // Once this item's own queue is actually playing, the button
                  // is a pause/resume toggle — always enabled, even once
                  // nextFile/playPath (recomputed from item.progress, which
                  // doesn't advance in this component's own props mid-queue)
                  // goes stale or empty from episodes the queue already
                  // played through.
                  disabled={!isThisPlaying && (isUnreleased || !playPath)}
                  title={isUnreleased ? releaseLabel : playPath ? undefined : isCaughtUp ? 'Ya estás al día' : isMovieFormat ? 'No se encontró el archivo de la película' : 'No se encontró el archivo del próximo episodio/capítulo'}
                  onClick={handlePlayButtonClick}
                >
                  {playState === 'playing' ? (
                    <span className="spinner spinner--sm" />
                  ) : playState === 'paused' ? (
                    <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
                    </svg>
                  ) : (
                    <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  )}
                  <span className="local-game-detail-play-label">
                    {playState === 'playing' ? playingButtonLabel : playState === 'paused' ? 'En pausa' : isUnreleased ? releaseLabel : (resumeSeconds && resumeSeconds > 5 ? `Seguir viendo en ${formatPlaybackTime(resumeSeconds)}` : 'Reproducir')}
                  </span>
                </button>
              )}
              <div className="local-media-divider-line" />
              <div className="local-media-match-row">
                <LocateButton flow={locate} rootFolder={rootFolder} isSingleEpisode={isSingleEpisode} />
                {(matchedFolder || rootFileMatch || deepTagMatch) && !isUnreleased && (
                  subLoading ? (
                    <span className="local-media-match-chip">
                      <div className="spinner spinner--sm" />
                      {isReading ? 'Buscando próximo volumen…' : 'Buscando próximo episodio…'}
                    </span>
                  ) : isCaughtUp ? (
                    <span className="local-media-match-chip ok">
                      {isReading
                        ? `Al día — no hay volúmenes nuevos (${totalCount} en total)`
                        : `Al día — no hay episodios/capítulos nuevos (${totalCount} en total)`}
                    </span>
                  ) : (
                    <span className={`local-media-match-chip local-media-match-chip--labeled${nextFile ? ' ok' : ' fail'}`}>
                      {nextFile ? (
                        <>
                          <span className="local-media-match-label">{isReading ? t.local.next_volume_label : t.local.next_episode_label}</span>{' '}<strong>
                            {(() => {
                              const code = formatEpisodeLabel(itemSeason, nextNumber, item.libraryEntry.type);
                              const cleanFileName = cleanFilenameForDisplay(nextFile.name);
                              if (isSingleEpisode) return isBookOrNovel ? code : (nextFileEpisodeTitle || cleanFileName);
                              if (isBookOrNovel) return code;

                              // The manual locator writes the canonical
                              // "SxxExx - episode - work" form. Its cleaned
                              // filename already contains everything this
                              // label needs, so adding the fetched title again
                              // would duplicate it before the same text.
                              const canonicalPrefix = new RegExp(`^${code}\\s*-`, 'i');
                              if (canonicalPrefix.test(nextFile.name)) return `${code} - ${cleanFileName}`;
                              if (nextFileEpisodeTitle) return `${code} - ${nextFileEpisodeTitle}`;

                              const fetchedName = episodeNames.get(`${item.externalId}|${nextNumber}`);
                              return fetchedName && !isRedundantEpisodeName(fetchedName, item.title)
                                ? `${code} - "${fetchedName}" - ${cleanFileName}`
                                : `${code} - ${cleanFileName}`;
                            })()}
                          </strong>
                        </>
                      ) : (
                        isMovieFormat ? 'Película no encontrada'
                          : (item.libraryEntry.type === 'comic' && isSingleEpisode) ? 'Volumen no encontrado'
                          : tomosMismatch ? `Se esperaban exactamente ${totalVols} tomos en la carpeta (encontrados: ${mediaFiles.length})`
                          : item.libraryEntry.type === 'comic' ? `Próximo número (${nextNumber}) no encontrado`
                          : isReading ? `Próximo volumen (${nextNumber}) no encontrado`
                          : (item.libraryEntry.type === 'anime' || item.libraryEntry.type === 'series') ? (
                            <>
                              <span className="local-media-match-label">{t.local.next_episode_label}</span>{' '}
                              <strong>
                                {(() => {
                                  const code = formatEpisodeLabel(itemSeason, nextNumber, item.libraryEntry.type);
                                  const fetchedName = episodeNames.get(`${item.externalId}|${nextNumber}`);
                                  const episodeTitle = fetchedName && !isRedundantEpisodeName(fetchedName, item.title)
                                    ? fetchedName
                                    : null;
                                  return [code, episodeTitle, item.title].filter(Boolean).join(' - ');
                                })()}
                              </strong>
                            </>
                          )
                          : `Próximo episodio (${nextNumber}) no encontrado`
                      )}
                    </span>
                  )
                )}
                <div className="local-media-match-row-right">
                  <button type="button" className="local-media-detail-edit-icon" onClick={handleEdit} title={t.local.edit_catalog_log}>
                    <IconPencil />
                  </button>
                  <CatalogLinkIcon externalId={item.externalId} />
                </div>
              </div>
            </div>

            <NeighborsRow prequel={prequelInfo} sequel={sequelInfo} bundleChildren={bundleChildren} onOpen={openMediaEditor} />
          </div>
        )}

        <div className={`local-media-history-screenshots-layout${currentHistory.length > 0 ? ' has-history' : ''}`}>
          <EpisodeHistoryList
            item={item}
            itemSeason={itemSeason}
            isMovieFormat={isMovieFormat}
            history={currentHistory}
            episodeNames={episodeNames}
            historyMenu={historyMenu}
            onOpenMenu={setHistoryMenu}
            onDeleteEntry={deleteHistoryEntry}
          />

          <MediaScreenshotsSection
            key={item.externalId}
            workName={item.title}
            achievements={null}
            achievementsLoading={false}
          />
        </div>
      </div>

      <LocatePreviewModals flow={locate} />

      {readerOpen && playPath && nextFile && (
        <ReaderModal
          externalId={item.externalId}
          title={readerTitle}
          filePath={playPath}
          episodeNumber={nextNumber}
          totalCount={totalCount}
          libraryEntry={item.libraryEntry}
          isSingleTomo={isSingleEpisode}
          cover={item.cover}
          onClose={() => setReaderOpen(false)}
          onStandBy={(spreadIndex, totalSpreads, pageCount) => {
            setReadingSession({
              externalId: item.externalId,
              title: readerTitle,
              cover: item.cover,
              filePath: playPath,
              episodeNumber: nextNumber,
              totalCount,
              libraryEntry: item.libraryEntry,
              isSingleTomo: isSingleEpisode,
              pageCount,
              spreadIndex,
              totalSpreads,
            });
          }}
          onProgressSaved={onProgressSaved}
        />
      )}
    </>
  );
}
