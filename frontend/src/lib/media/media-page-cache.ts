// Session-cache read-path repair for the media page. The cache itself lives
// in media-cache.ts; this is the one normalization applied to a cache hit
// before it's handed back, split out of media-page-data.ts (still re-exported
// from there) so both the fetchMediaData and fetchMediaDataWithFallback cache
// paths share it without either owning it.
import type { MediaPageData } from './types';
import { API_SPORTS_EVENT_BANNER_COLOR } from './constants';
import { setCachedMediaData } from './media-cache';

export function normalizeCachedApiSportsCompetition(rawId: string, data: MediaPageData): MediaPageData {
  if (!/^event:apisports:(?:football|basketball):\d+$/.test(rawId) || !Array.isArray(data.seasons) || data.seasons.length === 0) return data;
  if (data.format === 'Season' && data.bannerColor === API_SPORTS_EVENT_BANNER_COLOR) return data;
  const normalized = { ...data, format: 'Season', bannerColor: API_SPORTS_EVENT_BANNER_COLOR };
  setCachedMediaData(rawId, normalized);
  return normalized;
}
