// Episode + theme preview loading for PrEditorModal's Episodes/Themes
// subtabs — read-only data keyed on the entry's type and episode source,
// fetched as soon as the entry loads (not when the subtab opens) so the
// preview is ready by the time the curator gets there.
import { useEffect, useRef, useState } from 'react';
import type { MediaCatalogEntry } from '../../../lib/tauri/catalog';
import { fetchMediaThemes } from '../../../lib/media/media-page-data';
import { getMediaEpisodes, type MediaEpisode } from '../../../lib/tauri/episodes';
import { type MediaTheme } from '../../../lib/tauri/themes';
import { fetchMediaEpisodes } from '../../../lib/media/episodes/episode-list';
import { fetchTmdbDetail, fetchTmdbEpisodes, type TmdbTvDetail } from '../../../lib/search/providers/tmdb';

export function usePrEditorPreviews(externalId: string, entry: MediaCatalogEntry | null) {
  const [episodePreview, setEpisodePreview] = useState<MediaEpisode[]>([]);
  const [episodePreviewLoading, setEpisodePreviewLoading] = useState(false);
  const [episodeSourceTitle, setEpisodeSourceTitle] = useState('');
  const [themePreview, setThemePreview] = useState<MediaTheme[]>([]);
  const [themePreviewLoading, setThemePreviewLoading] = useState(false);
  const episodePreviewRequest = useRef(0);

  const entryType = entry?.type;
  const episodeSourceId = entry?.episode_source_id;
  const totalCount2 = entry?.total_count_2;

  useEffect(() => {
    if (!entryType || !['anime', 'series'].includes(entryType)) {
      setEpisodePreview([]);
      setEpisodeSourceTitle('');
      setEpisodePreviewLoading(false);
      setThemePreview([]);
      setThemePreviewLoading(false);
      return;
    }

    let cancelled = false;
    const requestId = ++episodePreviewRequest.current;
    const isCurrent = () => !cancelled && requestId === episodePreviewRequest.current;
    setEpisodePreviewLoading(true);
    setEpisodePreview([]);
    setEpisodeSourceTitle('');
    setThemePreview([]);
    if (entryType === 'anime') {
      setThemePreviewLoading(true);
      fetchMediaThemes(externalId)
        .then(themes => { if (isCurrent()) setThemePreview(themes); })
        .catch(error => { if (isCurrent()) console.error('Failed to load theme preview', error); })
        .finally(() => { if (isCurrent()) setThemePreviewLoading(false); });
    } else {
      setThemePreviewLoading(false);
    }

    const toPreviewEpisode = (episode: {
      season_number: number;
      episode_number: number;
      season_episode_number?: number;
      name: string | null;
      cover_url: string | null;
    }): MediaEpisode => ({
      external_id: externalId,
      season_number: episode.season_number,
      episode_number: episode.season_episode_number ?? episode.episode_number,
      name: episode.name,
      cover_url: episode.cover_url,
      source_key: null,
      mapping_key: null,
    });

    const load = async () => {
      if (episodeSourceId) {
        const tmdbId = Number(episodeSourceId);
        if (!Number.isInteger(tmdbId) || tmdbId <= 0) return;
        const detail = await fetchTmdbDetail(tmdbId, 'series') as TmdbTvDetail | null;
        if (!isCurrent()) return;
        setEpisodeSourceTitle(detail?.name || `TMDB #${tmdbId}`);
        const seasons = detail?.number_of_seasons || totalCount2 || 0;
        const episodes = seasons > 0 ? await fetchTmdbEpisodes(tmdbId, seasons) : [];
        if (isCurrent()) setEpisodePreview(episodes.map(toPreviewEpisode));
        return;
      }

      const cached = await getMediaEpisodes(externalId).catch(() => []);
      if (isCurrent() && cached.length > 0) setEpisodePreview(cached);
      const episodes = await fetchMediaEpisodes(
        externalId,
        false,
        entryType === 'series' ? totalCount2 ?? undefined : undefined,
      ).catch(() => cached);
      if (!isCurrent()) return;
      setEpisodePreview(episodes);

      const tmdbId = episodes
        .map(episode => episode.source_key?.match(/^tmdb:(\d+):/)?.[1])
        .find(Boolean)
        || (entryType === 'series' ? externalId.match(/^series:(\d+)$/)?.[1] : undefined);
      if (tmdbId) {
        const detail = await fetchTmdbDetail(Number(tmdbId), 'series') as TmdbTvDetail | null;
        if (isCurrent()) setEpisodeSourceTitle(detail?.name || `TMDB #${tmdbId}`);
      } else if (isCurrent()) {
        setEpisodeSourceTitle(episodes.some(episode => episode.source_key?.startsWith('anilist:')) ? 'AniList' : '—');
      }
    };

    load().catch(error => {
      if (isCurrent()) console.error('Failed to load episode source preview', error);
    }).finally(() => {
      if (isCurrent()) setEpisodePreviewLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [externalId, entryType, episodeSourceId, totalCount2]);

  return { episodePreview, episodePreviewLoading, episodeSourceTitle, themePreview, themePreviewLoading };
}
