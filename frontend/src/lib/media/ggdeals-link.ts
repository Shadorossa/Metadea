// GG.deals price-comparison link for a game/visual novel. GG.deals resolves
// `/steam/app/<id>/` to its own game card, so a known Steam app id gives an
// exact link; otherwise a title search is the best available target.

const GGDEALS_ORIGIN = 'https://gg.deals';

/** Media types whose pages show the GG.deals link (IGDB-backed works). */
export const GGDEALS_MEDIA_TYPES: readonly string[] = ['game', 'vnovel'];

/** Steam app id from a Steam store URL (`store.steampowered.com/app/<id>`,
 *  with or without a trailing slug or query string). Sub/bundle/other store
 *  URLs return null — GG.deals' `/steam/app/` route only accepts app ids. */
export function steamAppIdFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== 'store.steampowered.com' && host !== 'steamcommunity.com') return null;
  const match = parsed.pathname.match(/^\/app\/(\d+)(?:\/|$)/);
  return match && Number(match[1]) > 0 ? match[1] : null;
}

/** First Steam app id found among a work's store links. */
export function steamAppIdFromStoreLinks(
  links: readonly { platform?: string; url: string }[] | null | undefined,
): string | null {
  for (const link of links ?? []) {
    const id = steamAppIdFromUrl(link.url);
    if (id) return id;
  }
  return null;
}

export function ggDealsSearchUrl(title: string): string {
  return `${GGDEALS_ORIGIN}/search/?title=${encodeURIComponent(title.trim())}`;
}

export function ggDealsSteamAppUrl(appId: string | number): string {
  return `${GGDEALS_ORIGIN}/steam/app/${appId}/`;
}

/** The work's GG.deals page: exact by Steam app id when one is known (an
 *  explicit `steamAppId`, e.g. a Local Steam install, wins over store links),
 *  title search otherwise. */
export function ggDealsLink(input: {
  title: string;
  storeLinks?: readonly { platform?: string; url: string }[] | null;
  steamAppId?: string | number | null;
}): string {
  const explicit = input.steamAppId != null && /^\d+$/.test(String(input.steamAppId).trim()) && Number(input.steamAppId) > 0
    ? String(input.steamAppId).trim()
    : null;
  const appId = explicit ?? steamAppIdFromStoreLinks(input.storeLinks);
  return appId ? ggDealsSteamAppUrl(appId) : ggDealsSearchUrl(input.title);
}
