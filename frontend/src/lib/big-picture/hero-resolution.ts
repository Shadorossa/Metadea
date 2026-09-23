// The PS5 skin's background asks each provider for its largest rendition of
// the art it already picked, sized for the actual screen (CSS width × device
// pixel ratio): IGDB `t_original`, TMDB `original`, Steam's 2× library hero.
// Unknown hosts keep their URL. The backdrop shows the smaller image first
// and swaps to this one once it has loaded (BigPictureBackdrop), so a slow
// or missing large file never leaves the screen empty.

/** The best URL for a background `targetPx` wide, or `url` itself. */
export function highResArtUrl(url: string, targetPx: number): string {
  // IGDB: t_1080p (1920 px) covers full-HD; larger screens want the original.
  const igdb = /^(https:\/\/images\.igdb\.com\/igdb\/image\/upload\/)t_[a-z0-9_]+(\/.+)$/i.exec(url);
  if (igdb) return `${igdb[1]}${targetPx > 1920 ? 't_original' : 't_1080p'}${igdb[2]}`;
  // TMDB: w1280 is enough up to 1280 px, otherwise the original upload.
  const tmdb = /^(https:\/\/image\.tmdb\.org\/t\/p\/)(?:w\d+|original)(\/.+)$/i.exec(url);
  if (tmdb) return `${tmdb[1]}${targetPx > 1280 ? 'original' : 'w1280'}${tmdb[2]}`;
  // Steam: the store header (460 px) or the 1× library hero → the 2× hero
  // (3840 px); games without one fail to load and the backdrop keeps `url`.
  const steam = /^(https:\/\/[^/]*(?:steamstatic|steampowered)\.com\/.*\/apps\/\d+\/)(?:header|library_hero|capsule_[a-z0-9_]+)\.jpg(\?.*)?$/i.exec(url);
  if (steam) return `${steam[1]}${targetPx > 1920 ? 'library_hero_2x' : 'library_hero'}.jpg`;
  return url;
}

/** Physical pixels the background covers on this screen. */
export function backgroundTargetPx(): number {
  if (typeof window === 'undefined') return 1920;
  const cssWidth = Math.max(window.innerWidth || 0, window.screen?.width || 0);
  return Math.round(cssWidth * (window.devicePixelRatio || 1));
}
