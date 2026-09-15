import type { LocalGame, LibraryEntry, MediaCatalogEntry, MetaEntry } from '../../../lib/tauri';
import type { LocalMediaItem } from '../hooks/useLocalMediaEntries';
import { normalizeForMatch } from './folderMatch';
import { SUB_WORK_FORMATS } from '../../../lib/constants/media';
import { gameExternalId } from '../../../lib/media/mapper-utils';

// A scanned Steam game's own external_id (if any) is one candidate, but a
// library entry logged as a visual novel is catalogued as "vnovel:<id>"
// even though IGDB (and read_metadata_index's cache) always key it as a
// plain game id — only one of the two prefixes will ever actually resolve
// against the library. Independently re-derived in three places (Local's
// videojuegos status match, its "already owned" set, and the Visual Novel
// tab's own Steam-backlog match) before being pulled out here.
export function candidateExternalIdsForGame(g: LocalGame, pathCache: Record<string, MetaEntry>): string[] {
  const igdbId = g.app_id ? pathCache[g.app_id]?.igdb_id : undefined;
  return [
    g.external_id,
    igdbId != null ? gameExternalId(igdbId, true) : undefined,
    igdbId != null ? gameExternalId(igdbId, false) : undefined,
  ].filter((id): id is string => !!id);
}

// A season/update/issue/episode-tagged catalog entry (a Steam "season pass"
// or similar) still shows as ITSELF — its own card, own title/cover — but
// isn't separately launchable: its Play button targets the source game it's
// actually part of instead. Gated on format (same SUB_WORK_FORMATS
// stats-calculators.ts's isSubWorkItem uses), NOT just parent_id being set —
// parent_id also links a fully-playable, separately-owned edition (e.g.
// Death Stranding: Director's Cut) to its original, and THOSE keep their own
// identity/launch entirely, not redirected to a different edition the user
// doesn't actually have.
export function sourceCatalogOf(
  item: LocalMediaItem,
  catalogMapById: Map<string, MediaCatalogEntry>,
): MediaCatalogEntry | undefined {
  const format = item.catalogEntry?.format;
  const parentId = item.catalogEntry?.parent_id;
  return (format && SUB_WORK_FORMATS.has(format) && parentId) ? catalogMapById.get(parentId) : undefined;
}

// A conservative "different edition of the same work, no catalog relation to
// prove it" fallback — a STRICT prefix match on the title alone (never
// romaji/native, which can collapse to near-nothing once non-ASCII text is
// stripped for matching) requiring every extra trailing word to be an
// actual edition/release keyword. Not a fuzzy/similarity match — that
// previously mismatched unrelated titles sharing a short numeric suffix
// (e.g. "Bayonetta 3" against "Yakuza 3 Remastered").
const EDITION_KEYWORDS = new Set([
  'complete', 'definitive', 'deluxe', 'goty', 'edition', 'directors', 'cut',
  'remastered', 'remaster', 'enhanced', 'special', 'anniversary', 'redux',
  'hd', 'collection', 'ultimate', 'gold',
]);

export function findEditionPrefixMatch(title: string, games: LocalGame[]): LocalGame | undefined {
  const normTitle = normalizeForMatch(title);
  const titleTokens = normTitle.split(' ').filter(Boolean);
  // Below this, a single short/degenerate token (numbers especially) is too
  // likely to prefix-match something by pure coincidence.
  if (titleTokens.length < 2) return undefined;
  for (const g of games) {
    const normName = normalizeForMatch(g.name);
    if (!normName.startsWith(normTitle + ' ')) continue;
    const extra = normName.slice(normTitle.length).trim().split(' ').filter(Boolean);
    if (extra.every(tok => EDITION_KEYWORDS.has(tok) || tok === 'the' || tok === 'of')) return g;
  }
  return undefined;
}

export type StatusEntry =
  | { kind: 'game'; game: LocalGame }
  | { kind: 'catalog'; item: LocalMediaItem; launchGame?: LocalGame };

// Shared by every "library entries that might actually already be a scanned
// game under a different identity/edition" grid — Videojuegos' own
// Pendientes/En progreso sections and the Visual Novel tab's library-only
// entries alike, so both get exactly the same matching behavior instead of
// two separately-maintained copies of it. Matches by exact normalized title
// first (title/romaji/native), then the strict prefix+edition-wording
// fallback above; a season/update redirects to its source work's own match
// instead of trying to match itself, de-duped by that shared source id so a
// source with several tracked seasons doesn't show up once per season.
export function buildLibraryStatusEntries(
  items: LocalMediaItem[],
  games: LocalGame[],
  catalogMapById: Map<string, MediaCatalogEntry>,
  pathCache: Record<string, MetaEntry> = {},
): StatusEntry[] {
  const gamesByNormalizedName = new Map(games.map(g => [normalizeForMatch(g.name), g]));
  // A season/update's parent might already be LINKED (via app_id auto-match
  // or a manual "editar metadatos" pick — see IgdbPickerModal) to its own
  // installed game under a name IGDB itself doesn't share (Overwatch 2's own
  // Steam listing is named "Overwatch 2", but IGDB's base game — the one
  // every season's parent_id actually points to — is titled plain
  // "Overwatch") — an exact/prefix title match against the PARENT's name
  // would miss that entirely. Checked first, before any name-based guessing.
  const gamesByExternalId = new Map(games.flatMap(g => candidateExternalIdsForGame(g, pathCache).map(id => [id, g] as const)));
  const matchTitles = (titles: string[]): LocalGame | undefined =>
    titles.map(tt => gamesByNormalizedName.get(normalizeForMatch(tt))).find(Boolean)
    ?? titles.map(tt => findEditionPrefixMatch(tt, games)).find(Boolean);

  const seen = new Set<string>();
  const entries: StatusEntry[] = [];
  for (const item of items) {
    const source = sourceCatalogOf(item, catalogMapById);
    if (source) {
      const dedupeKey = source.external_id;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      // ID match first (see gamesByExternalId above) — falls back to an
      // exact title match against every variant (title/romaji/native), the
      // safe, unambiguous case — then the strict prefix+edition-wording
      // fallback, on the source's own title only.
      const sourceTitles = [source.title_main, source.title_romaji, source.title_native].filter((s): s is string => !!s);
      const launchGame = gamesByExternalId.get(source.external_id)
        ?? sourceTitles.map(tt => gamesByNormalizedName.get(normalizeForMatch(tt))).find(Boolean)
        ?? (source.title_main ? findEditionPrefixMatch(source.title_main, games) : undefined);
      entries.push({ kind: 'catalog', item, launchGame });
      continue;
    }
    if (seen.has(item.externalId)) continue;
    seen.add(item.externalId);
    const titles = [item.title, item.titleRomaji, item.titleNative].filter((s): s is string => !!s);
    const matched = matchTitles(titles);
    entries.push(matched ? { kind: 'game', game: matched } : { kind: 'catalog', item });
  }
  return entries;
}

// The reverse direction of buildLibraryStatusEntries' own matching above —
// given an installed game with no external_id at all (a restored ghost, or
// one whose scan never got auto-matched by app_id/igdb_id), finds the
// library STATUS it corresponds to by name instead. Without this,
// LocalLibrary's ID-based gameStatusMatch and this file's name-based
// buildLibraryStatusEntries could independently reach different verdicts
// about the very same game — one showing it untracked in its own platform
// section (ID match found nothing) while the other showed a SEPARATE
// "Pendiente"/"En progreso" card for the same title (name match DID find
// something) — the exact duplicate a GOG-scanned "Silent Hill 4: The Room"
// with no external_id produced against its own catalog-only Pendiente row.
export function matchGameStatusByName(
  game: LocalGame,
  libraryTitledEntries: { titles: string[]; entry: LibraryEntry }[],
): string | undefined {
  const normGameName = normalizeForMatch(game.name);
  for (const { titles, entry } of libraryTitledEntries) {
    if (titles.some(tt => normalizeForMatch(tt) === normGameName)) return entry.status ?? undefined;
  }
  for (const { titles, entry } of libraryTitledEntries) {
    if (titles.some(tt => findEditionPrefixMatch(tt, [game]) === game)) return entry.status ?? undefined;
  }
  return undefined;
}
