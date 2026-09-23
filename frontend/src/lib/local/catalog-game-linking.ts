import type { LocalGame, LibraryEntry, CatalogEntryLike, MetaEntry, DbMediaRelation } from '../tauri';
import type { LocalMediaItem } from './local-media-item';
import { normalizeForMatch } from './folder-match';
import { SUB_WORK_FORMATS } from '../media/media-types';
import { gameExternalId } from '../media/mappers/mapper-utils';
import { CONTAINS_RELATION_TYPES, PART_OF_RELATION_TYPES } from '../media/saga/saga-relation-types';

export function computeBundleCompletionStatus(
  bundleId: string,
  relations: DbMediaRelation[],
  byExternalId: Map<string, LibraryEntry>,
): string | undefined {
  const containsChildIds = relations
    .filter(r => r.media_external_id === bundleId && (CONTAINS_RELATION_TYPES.includes(r.relation_type) || r.relation_type === 'EPISODE' || r.relation_type === 'CONTAINS'))
    .map(r => r.related_media_external_id);
  const partOfChildIds = relations
    .filter(r => r.related_media_external_id === bundleId && (PART_OF_RELATION_TYPES.includes(r.relation_type) || r.relation_type === 'PART_OF' || r.relation_type === 'UPDATE'))
    .map(r => r.media_external_id);
  const childIds = Array.from(new Set([...containsChildIds, ...partOfChildIds])).filter((id): id is string => !!id && id !== bundleId);
  if (childIds.length === 0) return undefined;
  return childIds.every(id => byExternalId.get(id)?.status === 'completed') ? 'completed' : undefined;
}

// A scanned Steam game's own external_id (if any) is one candidate, but a
// library entry logged as a visual novel is catalogued as "vnovel:<id>"
// even though IGDB (and read_metadata_index's cache) always key it as a
// plain game id — only one of the two prefixes will ever actually resolve
// against the library. Independently re-derived in three places (Local's
// videojuegos status match, its "already owned" set, and the Visual Novel
// tab's own Steam-backlog match) before being pulled out here.
export function candidateExternalIdsForGame(g: LocalGame, pathCache: Record<string, MetaEntry>): string[] {
  const appId = g.app_id ?? '';
  const igdbId = appId ? pathCache[appId]?.igdb_id : undefined;
  return [
    g.external_id,
    igdbId != null ? gameExternalId(igdbId, true) : undefined,
    igdbId != null ? gameExternalId(igdbId, false) : undefined,
  ].filter((id): id is string => typeof id === 'string' && id.length > 0);
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
// `relations` (optional) also catches a bundle's own CONTAINS/EPISODE
// children (Umineko's 8 VN chapters, Higurashi's 8 arcs, ...) — that link
// lives in media_relations (see groupBundles' own containerOf), not in the
// child's own catalogEntry.format/parent_id the way SEASON/UPDATE/ISSUE
// sub-works are recorded, so without this a bundle's children never
// resolved to their container here and could never be recognized as "the
// same Steam install" the container itself is — each one stayed its own
// stray "Pendiente" catalog card even with the whole bundle installed.
export function sourceCatalogOf(
  item: LocalMediaItem,
  catalogMapById: Map<string, CatalogEntryLike>,
  relations: DbMediaRelation[] = [],
): CatalogEntryLike | undefined {
  const format = item.catalogEntry?.format;
  const parentId = item.catalogEntry?.parent_id;
  if (format && SUB_WORK_FORMATS.has(format) && parentId) return catalogMapById.get(parentId);
  const bundleId = relations.find(r => CONTAINS_RELATION_TYPES.includes(r.relation_type) && r.related_media_external_id === item.externalId)?.media_external_id;
  return bundleId ? catalogMapById.get(bundleId) : undefined;
}

// Strips a trailing chapter/episode marker ("Higurashi When They Cry Hou -
// Ch.1 Onikakushi" -> "Higurashi When They Cry Hou") — a per-chapter VN
// catalog title's own base work name, once that marker's gone, matches
// a bare Steam bundle app title directly. Never collapses to nothing:
// falls back to the original when the whole title would otherwise vanish
// (a title that's ONLY a chapter marker, however unlikely).
const CHAPTER_SUFFIX_RE = /\s*[-–—:]\s*(?:ch(?:apter)?\.?|episode|episodio|cap[ií]tulo|part|parte)\.?\s*\d+.*$/i;
function stripChapterSuffix(title: string): string {
  const stripped = title.replace(CHAPTER_SUFFIX_RE, '').trim();
  return stripped || title;
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

// Apostrophes/quotes are dropped BEFORE normalizeForMatch (which would turn
// "Director's" into "director s", splitting the edition keyword) — kept
// local to this matcher so folder scoring elsewhere is unaffected.
const APOSTROPHES = /['’‘`]/g;
const normalizeEditionText = (s: string): string => normalizeForMatch(s.replace(APOSTROPHES, ''));

export function findEditionPrefixMatch(title: string, games: LocalGame[]): LocalGame | undefined {
  const normTitle = normalizeEditionText(title);
  const titleTokens = normTitle.split(' ').filter(Boolean);
  // Below this, a single short/degenerate token (numbers especially) is too
  // likely to prefix-match something by pure coincidence.
  if (titleTokens.length < 2) return undefined;
  for (const g of games) {
    const normName = normalizeEditionText(g.name);
    if (!normName.startsWith(normTitle + ' ')) continue;
    const extra = normName.slice(normTitle.length).trim().split(' ').filter(Boolean);
    if (extra.every(tok => EDITION_KEYWORDS.has(tok) || tok === 'the' || tok === 'of')) return g;
  }
  return undefined;
}

export type StatusEntry =
  // libraryStatus: set only when this game was matched by NAME (not real
  // identity) to a library item — see buildLibraryStatusEntries below.
  // Callers whose OWN identity-based status map (steamGameMatch/
  // gameStatusMatch) has nothing for this exact game object (a name match
  // finds a game an identity match never would have) fall back to this
  // instead of silently showing no status badge at all for a match that
  // WAS found, just via a different path.
  | { kind: 'game'; game: LocalGame; libraryStatus?: string }
  | { kind: 'catalog'; item: LocalMediaItem; launchGame?: LocalGame };

export function displayNameFor(g: LocalGame, catalogMapById?: Map<string, CatalogEntryLike>): string | undefined {
  return g.external_id ? catalogMapById?.get(g.external_id)?.title_main ?? undefined : undefined;
}

// Shared "how a mixed installed+pendiente list gets ordered" logic -
// "biblioteca de Steam" (kind:'game', installed) and "perfil de usuario"
// (kind:'catalog', a library-tracked pendiente) are just two different
// SOURCES of the same kind of thing, so they're always merged into one list
// and sorted together instead of installed games trailing every pendiente
// (or vice versa) regardless of what the user actually asked to sort by.
// Used by both GamesGrid (Videojuegos) and LocalMediaSection (Visual
// Novel's own Steam-backed platform sections) so the two don't drift into
// two independently-maintained sort behaviors.
// 'shortestToBeat' reads the time_to_beat cache only (see
// useCachedBeatSeconds): works whose length was never looked up sort last.
export type SortMode = 'alpha' | 'lastPlayed' | 'playtime' | 'shortestToBeat';

export function entryDisplayName(entry: StatusEntry, displayNameFor: (g: LocalGame) => string | undefined): string {
  return entry.kind === 'game' ? (displayNameFor(entry.game) ?? entry.game.name) : entry.item.title;
}

// last_played (installed) is a unix-seconds timestamp; a catalog-only
// pendiente has no such field (it's never actually been launched through
// here), so its library entry's own updated_at — bumped whenever its
// progress/status changes — is the closest available proxy.
export function entryLastPlayedMs(entry: StatusEntry): number {
  if (entry.kind === 'game') return (entry.game.last_played ?? 0) * 1000;
  return Date.parse(entry.item.libraryEntry.updated_at ?? '') || 0;
}

// playtime_minutes (installed) and the library entry's minutes_spent
// (pendiente) are already the same unit, so these compare directly.
export function entryPlaytimeMinutes(entry: StatusEntry): number {
  if (entry.kind === 'game') return entry.game.playtime_minutes ?? 0;
  return entry.item.libraryEntry.minutes_spent ?? 0;
}

/** The catalog id an entry's time to beat is cached under, if it has one. */
export function entryExternalId(entry: StatusEntry): string | undefined {
  return entry.kind === 'game' ? entry.game.external_id : entry.item.externalId;
}

export function sortEntries(
  entries: StatusEntry[],
  mode: SortMode,
  displayNameFor: (g: LocalGame) => string | undefined,
  beatSeconds?: ReadonlyMap<string, number>,
): StatusEntry[] {
  const sorted = [...entries];
  if (mode === 'shortestToBeat') {
    const lengthOf = (entry: StatusEntry) => {
      const id = entryExternalId(entry);
      return (id && beatSeconds?.get(id)) || Infinity;
    };
    sorted.sort((a, b) => (lengthOf(a) - lengthOf(b)) || entryDisplayName(a, displayNameFor).localeCompare(entryDisplayName(b, displayNameFor)));
  } else if (mode === 'alpha') {
    sorted.sort((a, b) => entryDisplayName(a, displayNameFor).localeCompare(entryDisplayName(b, displayNameFor)));
  } else if (mode === 'lastPlayed') {
    sorted.sort((a, b) => entryLastPlayedMs(b) - entryLastPlayedMs(a));
  } else {
    sorted.sort((a, b) => entryPlaytimeMinutes(b) - entryPlaytimeMinutes(a));
  }
  return sorted;
}

// No index baked into either branch — sortEntries reorders this same list
// every time the sort mode/search filter changes, and a key that shifts
// when an item's INDEX does (instead of staying tied to the item itself)
// makes React tear down and remount it as a brand new element rather than
// recognizing it as the same one that just moved, losing Motion's own
// layout-animation tracking for it (a hard, un-animated pop to its new spot
// instead of easing there).
export function entryKey(entry: StatusEntry): string {
  return entry.kind === 'game' ? `g-${entry.game.app_id ?? entry.game.install_path ?? entry.game.name}` : `c-${entry.item.externalId}`;
}

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
  catalogMapById: Map<string, CatalogEntryLike>,
  pathCache: Record<string, MetaEntry> = {},
  relations: DbMediaRelation[] = [],
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
    ?? titles.map(tt => findEditionPrefixMatch(tt, games)).find(Boolean)
    // Same bundle-chapter case sourceCatalogOf's relations check targets,
    // for when no CONTAINS/EPISODE edge exists locally yet (nobody's ever
    // run the saga editor/"Localizar" flow that would create one) — the
    // chapter's own title still carries its base work's name, just with a
    // "- Ch.N ..." marker tacked on that a bare Steam app title never has.
    ?? titles.map(tt => gamesByNormalizedName.get(normalizeForMatch(stripChapterSuffix(tt)))).find(Boolean)
    ?? titles.map(tt => findEditionPrefixMatch(stripChapterSuffix(tt), games)).find(Boolean);

  const seen = new Set<string>();
  // Several chapters of the same un-related bundle can all resolve to the
  // SAME Steam game via the stripped-title fallback above — only the first
  // becomes its own card; the rest are the same install already
  // represented, not separate ones (same reasoning as `seen`, but keyed by
  // the matched game instead of the catalog item).
  const usedGames = new Set<LocalGame>();
  const entries: StatusEntry[] = [];
  for (const item of items) {
    const source = sourceCatalogOf(item, catalogMapById, relations);
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
    if (matched && usedGames.has(matched)) continue;
    if (matched) usedGames.add(matched);
    entries.push(matched ? { kind: 'game', game: matched, libraryStatus: item.status || undefined } : { kind: 'catalog', item });
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
