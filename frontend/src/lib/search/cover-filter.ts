// Anime-only cover quality filter for search/browse results — mirrors
// openlibrary.ts's book filter (`docs.filter(b => b.cover_i && ...)`, a
// plain existence check), but anime also needs to catch a cover that
// technically exists yet isn't a real poster: some AniList entries with no
// official key art fall back to a banner/screenshot instead, which reads as
// a horizontal (~16:9) image instead of a normal portrait poster. AniList's
// API exposes no width/height field to check this server-side, so this
// probes the actual image client-side — a CDN image load, not an extra
// AniList GraphQL request, and the same image the card needs to render
// anyway (the browser's HTTP cache makes the card's own <img> load an
// instant hit right after).
import type { SearchResult } from './index';

function probeIsPortrait(url: string): Promise<boolean> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0 && img.naturalHeight > img.naturalWidth);
    img.onerror = () => resolve(false); // broken/unreachable image — treat like no cover at all
    img.src = url;
  });
}

export async function filterValidAnimeCovers(results: SearchResult[]): Promise<SearchResult[]> {
  const withCover = results.filter((r): r is SearchResult & { coverUrl: string } => !!r.coverUrl);
  const isPortrait = await Promise.all(withCover.map(r => probeIsPortrait(r.coverUrl)));
  return withCover.filter((_, i) => isPortrait[i]);
}
