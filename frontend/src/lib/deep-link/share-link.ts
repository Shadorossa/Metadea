// Builds the rich https share link for a work (workers/share-links renders
// its Discord/Open Graph preview and forwards to metadea://). Everything the
// preview shows is packed into the URL by share-link-codec; nothing is
// stored anywhere. Callers fall back to buildShareUrl (the plain /open/ page)
// when this returns null.

import type { MediaPageData } from '../media/types';
import { isValidDeepLinkTarget, SHARE_LINK_BASE } from './deep-link-routes';
import { bannerTokenFromUrl, coverTokenFromUrl, encodeSharePath, typeLetterForId } from './share-link-codec';

/** What the app knows about a work, from a media page or any catalog row. */
export interface ShareableWork {
  externalId: string;
  title: string;
  year?: number | null;
  /** Unified genre names ("Action", "Drama"…). */
  genres?: string[] | null;
  /** 0..10, the app's scoreGlobal scale (7.9). The link carries it ×10. */
  score?: number | null;
  coverUrl?: string | null;
  bannerUrl?: string | null;
}

export function buildShareLink(work: ShareableWork): string | null {
  if (!work.title.trim()) return null;
  if (!isValidDeepLinkTarget({ kind: 'media', external_id: work.externalId })) return null;
  if (!typeLetterForId(work.externalId)) return null;
  // Both images travel in the URL (the Worker cannot call provider APIs:
  // AniList answers 403 to Cloudflare Workers). The preview shows the banner
  // as a large card and falls back to the cover when there is none — except
  // games, which always preview with their cover (owner's call). When a
  // banner is sent the cover is left out: the preview never shows both, and
  // the AniList cover token is what made these links long.
  const isGame = work.externalId.startsWith('game:');
  const banner = isGame ? undefined : bannerTokenFromUrl(work.bannerUrl, work.externalId) ?? undefined;
  const path = encodeSharePath({
    externalId: work.externalId,
    title: work.title,
    year: work.year ?? undefined,
    genres: work.genres ?? [],
    score: typeof work.score === 'number' && Number.isFinite(work.score) ? work.score * 10 : undefined,
    banner,
    cover: banner ? undefined : coverTokenFromUrl(work.coverUrl) ?? undefined,
  });
  return path ? `${SHARE_LINK_BASE}${path}` : null;
}

export function shareableWorkFromPage(data: MediaPageData): ShareableWork {
  return {
    externalId: data.externalId,
    title: data.titleMain,
    year: data.releaseYear,
    genres: data.genreDots ? data.genreDots.split(' · ') : [],
    score: data.scoreGlobal,
    coverUrl: data.cover,
    bannerUrl: data.bannerImage,
  };
}
