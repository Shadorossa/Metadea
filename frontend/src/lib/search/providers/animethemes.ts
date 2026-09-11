// animethemes.moe — anime openings/endings (the media page's "Temas" tab).
// Looked up directly by AniList numeric id via filter[site]=AniList, so no
// title/year fuzzy-matching is needed the way TMDB's own episode matching
// requires (see anime-tmdb-match.ts) — animethemes.moe already resolves its
// own catalog against AniList's ids.
import { fetchJson } from '../../api/client';

interface AnimeThemesArtist {
  name: string;
}

interface AnimeThemesVideo {
  link: string;
  resolution?: number;
  source?: string; // "BD", "TV", "WEB", ...
  nc?: boolean;     // no-credits version
}

interface AnimeThemesEntry {
  episodes?: string | null; // e.g. "1-24"
  videos?: AnimeThemesVideo[];
}

interface AnimeThemesTheme {
  slug: string;
  type: string; // "OP" | "ED"
  sequence?: number | null;
  song?: { title?: string | null; artists?: AnimeThemesArtist[] } | null;
  animethemeentries?: AnimeThemesEntry[];
}

interface AnimeThemesAnime {
  id: number;
  animethemes?: AnimeThemesTheme[];
}

interface AnimeThemesResponse {
  anime?: AnimeThemesAnime[];
}

export interface AnimeThemeSummary {
  slug: string;
  themeType: 'OP' | 'ED';
  sequence: number;
  songTitle: string | null;
  artists: string | null;
  episodes: string | null;
  videoUrl: string | null;
}

// Prefers the no-credits Blu-ray release at the highest resolution — the
// cleanest, best-quality cut available — falling back to whatever's there
// when a theme only ever got a TV/WEB release.
function pickBestVideo(videos: AnimeThemesVideo[] | undefined): AnimeThemesVideo | null {
  if (!videos?.length) return null;
  return [...videos].sort((a, b) => {
    const scoreOf = (v: AnimeThemesVideo) =>
      (v.source === 'BD' ? 2000 : 0) + (v.nc ? 1000 : 0) + (v.resolution ?? 0);
    return scoreOf(b) - scoreOf(a);
  })[0];
}

export async function fetchAnimeThemes(anilistId: number): Promise<AnimeThemeSummary[]> {
  const url = `https://api.animethemes.moe/anime`
    + `?filter[has]=resources&filter[site]=AniList&filter[external_id]=${anilistId}`
    + `&include=animethemes.animethemeentries.videos,animethemes.song.artists`;

  const data = await fetchJson<AnimeThemesResponse>(url).catch(() => null);
  const anime = data?.anime?.[0];
  if (!anime?.animethemes?.length) return [];

  return anime.animethemes
    .filter((t): t is AnimeThemesTheme & { type: 'OP' | 'ED' } => t.type === 'OP' || t.type === 'ED')
    .map(theme => {
      const entry = theme.animethemeentries?.[0];
      const video = pickBestVideo(entry?.videos);
      const seqMatch = theme.slug.match(/^(?:OP|ED)(\d+)/i);
      const sequence = (typeof theme.sequence === 'number' && !isNaN(theme.sequence))
        ? theme.sequence
        : (seqMatch ? parseInt(seqMatch[1], 10) : 1);
      return {
        slug: theme.slug,
        themeType: theme.type,
        sequence,
        songTitle: theme.song?.title?.trim() || null,
        artists: theme.song?.artists?.map(a => a.name).filter(Boolean).join(', ') || null,
        episodes: entry?.episodes || null,
        videoUrl: video?.link || null,
      };
    })
    .sort((a, b) => (a.themeType === b.themeType ? a.sequence - b.sequence : a.themeType === 'OP' ? -1 : 1));
}
