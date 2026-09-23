// Which launcher a catalog-only "Pendiente" game belongs to, and the
// persistent memo of IGDB's answer. usePendingLaunchers used to ask IGDB
// (igdb_get_game_detail, a live request) for every planning game without
// cached shop links on EVERY Local grid build — the same ids, the same
// answer, on every visit and every rescan. The verdict ("steam", "nintendo",
// … or "no known platform") is remembered here for PENDING_LAUNCHER_TTL_MS so
// a game is asked about once a week at most; the fallback assignment the
// hook applies (Steam) is unchanged, it just no longer costs a request.

import { STORAGE_KEYS } from '../storage/storage-keys';
import type { IgdbGame } from '../tauri';

export const PENDING_LAUNCHER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Map IGDB platform names (from a catalog entry's shop_links_csv, e.g.
// "steam|url,epic|url", or a live IGDB detail's store_links) to our own
// launcher keys.
const SHOP_LINK_PLATFORM_MAP: Record<string, string> = {
  steam:                 'steam',
  'epic games store':    'epic',
  epic:                  'epic',
  gog:                   'gog',
  xbox:                  'xbox',
  'xbox game pass':      'xbox',
  ea:                    'ea',
  'ea app':              'ea',
  origin:                'ea',
  nintendo:              'nintendo',
  'nintendo eshop':      'nintendo',
  playstation:           'playstation',
  'playstation store':   'playstation',
};

function launcherFromPlatformName(name?: string | null): string | undefined {
  if (!name) return undefined;
  return SHOP_LINK_PLATFORM_MAP[name.trim().toLowerCase()];
}

export function getLauncherFromShopLinks(shopLinksCsv?: string | null): string | undefined {
  if (!shopLinksCsv) return undefined;
  const platforms = shopLinksCsv.split(',').map(p => p.split('|')[0]);
  if (platforms.some(p => p?.trim().toLowerCase() === 'steam')) return 'steam';
  for (const p of platforms) {
    const mapped = launcherFromPlatformName(p);
    if (mapped) return mapped;
  }
  return undefined;
}

// Same signal GameDetailPanel's "Ver en Steam"/"Ver en Nintendo" already
// uses (IGDB's own store_links + involved_companies) — a LIVE fetch, not a
// local-DB read, since shop_links_csv/companies only ever get persisted
// locally once the user has actually opened this entry's own /media page at
// least once (see mediaService.ts's persistToCatalog).
export function launcherFromIgdbDetail(detail: IgdbGame | Record<string, unknown> | null): string | undefined {
  if (!detail) return undefined;
  const links = detail.store_links as { platform?: string }[] | undefined;
  if (links?.some(l => l.platform?.trim().toLowerCase() === 'steam')) return 'steam';
  for (const l of links ?? []) {
    const mapped = launcherFromPlatformName(l.platform);
    if (mapped) return mapped;
  }
  const companies = detail.involved_companies as { company?: { name?: string }; developer?: boolean; publisher?: boolean }[] | undefined;
  for (const c of companies ?? []) {
    if (!(c.developer || c.publisher)) continue;
    const name = c.company?.name?.toLowerCase() ?? '';
    if (name.includes('nintendo')) return 'nintendo';
    if (name.includes('playstation') || name.includes('sony')) return 'playstation';
  }
  const platforms = detail.platforms as { name?: string }[] | undefined;
  if (platforms?.some(p => {
    const n = p.name?.toLowerCase() ?? '';
    return n.includes('pc') || n.includes('windows') || n.includes('steam');
  })) {
    return 'steam';
  }
  return undefined;
}

// ── Persistent memo ─────────────────────────────────────────────────────────

export interface PendingLauncherMemoEntry {
  /** null = IGDB was asked and named no known platform. */
  launcher: string | null;
  checkedAt: number;
}

export type PendingLauncherMemo = Record<string, PendingLauncherMemoEntry>;

export function isPendingLauncherMemoFresh(entry: PendingLauncherMemoEntry | undefined, now: number): entry is PendingLauncherMemoEntry {
  return !!entry && now - entry.checkedAt < PENDING_LAUNCHER_TTL_MS && now >= entry.checkedAt;
}

// Drops expired rows so the blob can't grow without bound.
export function prunePendingLauncherMemo(memo: PendingLauncherMemo, now: number): PendingLauncherMemo {
  const kept: PendingLauncherMemo = {};
  for (const [id, entry] of Object.entries(memo)) {
    if (isPendingLauncherMemoFresh(entry, now)) kept[id] = entry;
  }
  return kept;
}

export function readPendingLauncherMemo(): PendingLauncherMemo {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.pendingLauncherMemo);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed as PendingLauncherMemo : {};
  } catch {
    return {};
  }
}

export function writePendingLauncherMemo(memo: PendingLauncherMemo): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS.pendingLauncherMemo, JSON.stringify(memo));
  } catch {
    // A non-persistent webview storage only costs the next visit a request.
  }
}

// The launcher for `externalId` ("game:<igdb id>"): the memo when fresh,
// otherwise `fetchDetail`'s live answer, which is then remembered (found or
// not). A failed fetch is not remembered, so it's retried next time — same
// as the hook's own catch, which treated it as "no launcher" for that build.
export async function resolvePendingLauncher(
  externalId: string,
  fetchDetail: (igdbId: number) => Promise<IgdbGame | null>,
  now = Date.now(),
): Promise<string | undefined> {
  const memo = readPendingLauncherMemo();
  const hit = memo[externalId];
  if (isPendingLauncherMemoFresh(hit, now)) return hit.launcher ?? undefined;
  const igdbId = Number(externalId.split(':')[1]);
  if (!igdbId) return undefined;
  let launcher: string | undefined;
  try {
    launcher = launcherFromIgdbDetail(await fetchDetail(igdbId));
  } catch {
    return undefined;
  }
  const pruned = prunePendingLauncherMemo(readPendingLauncherMemo(), now);
  pruned[externalId] = { launcher: launcher ?? null, checkedAt: now };
  writePendingLauncherMemo(pruned);
  return launcher;
}
