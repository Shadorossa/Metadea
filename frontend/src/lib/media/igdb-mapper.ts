import { igdbImageUrl } from '../tauri';
import { getT } from '../../i18n/client';
import type { MediaPageData, MediaRelation } from './types';
import { unifyGenres } from './genre-unifier';
import { cleanEditionTitle, dedupeEditionVariants } from './title-utils';
import { unixToDateParts, formatDateParts, normalizeScore100, lookupLabel } from './mapper-utils';
import { canonicalizeIgdbStatus, STATUS_BADGE_CLASS } from './media-status';
import { CANONICAL_RELATION_LABELS as canonicalRelationLabels } from './canonical-relations';

export interface IgdbSubGame {
  id: number;
  name: string;
  cover?: { image_id: string };
  first_release_date?: number;
  /** Own-genre VN classification computed backend-side (see igdb.rs's
   *  detect_vn) — a related title (remake, DLC, base game, ...) can be a
   *  visual novel even when the game being viewed isn't, or vice versa, so
   *  the relation's external_id prefix can't just inherit the current page's
   *  type. Without this, every relation used to get hardcoded to "game:",
   *  which created duplicate catalog stubs of the same title under both
   *  "game:" and "vnovel:" prefixes. */
  is_vn?: boolean;
}

interface IgdbDetailGame {
  id: number;
  name: string;
  url?: string;
  summary?: string;
  cover?: { image_id: string };
  banner_image_id?: string | null;
  first_release_date?: number;
  rating?: number;
  total_rating?: number;
  /** IGDB's release-status enum: 0 Released, 2 Alpha, 3 Beta, 4 Early Access,
   *  5 Offline, 6 Cancelled, 7 Rumored, 8 Delisted (no 1). */
  status?: number;
  game_type?: number;
  genres?: { id: number; name: string }[];
  involved_companies?: {
    id: number;
    company?: { name: string };
    developer?: boolean;
    publisher?: boolean;
  }[];
  platforms?: { id: number; name: string }[];
  alternative_names?: { name: string; comment?: string }[];
  store_links?: { platform: string; url: string }[] | null;
  parent_game?: IgdbSubGame;
  version_parent?: IgdbSubGame;

  // Relaciones de versiones
  remakes?: IgdbSubGame[];
  remasters?: IgdbSubGame[];
  dlcs?: IgdbSubGame[];
  expansions?: IgdbSubGame[];
  standalone_expansions?: IgdbSubGame[];
  expanded_games?: IgdbSubGame[];
  ports?: IgdbSubGame[];
  forks?: IgdbSubGame[];
}

const GAME_TYPE_FORMAT: Record<number, string> = {
  0: 'GAME',
  1: 'DLC',
  3: 'BUNDLE',
  2: 'EXPANSION',
  4: 'EXPANSION',
  5: 'MOD',
  6: 'EPISODE',
  7: 'SEASON',
  8: 'REMAKE',
  9: 'REMASTER',
  10: 'EXPANDED_GAME',
  11: 'PORT',
  12: 'FORK',
  14: 'UPDATE',
};

function dedupeStoreLinks(links: { platform: string; url: string }[] | null | undefined) {
  if (!links) return links; // preserves null ("checked, none found") vs undefined ("not applicable")
  const seenPlatforms = new Set<string>();
  return links.filter(l => {
    if (!l.platform || !l.url) return false;
    const key = l.platform.toLowerCase();
    if (seenPlatforms.has(key)) return false;
    seenPlatforms.add(key);
    return true;
  });
}

function findAltName(
  altNames: { name: string; comment?: string }[],
  predicate: (comment: string, name: string) => boolean,
): string | undefined {
  return altNames.find(an => predicate((an.comment ?? '').toLowerCase(), an.name))?.name;
}

export function mapIgdbToMedia(game: IgdbDetailGame, rawId: string): MediaPageData {
  const tm = getT().media;
  const genres = game.genres?.map(g => g.name) ?? [];
  const developers = game.involved_companies?.filter(c => c.developer && c.company).map(c => c.company!.name) ?? [];
  const publishers = game.involved_companies?.filter(c => c.publisher && c.company).map(c => c.company!.name) ?? [];
  const platforms = [...new Set((game.platforms ?? []).map(p => p.name))];

  const coverUrl = game.cover?.image_id ? igdbImageUrl(game.cover.image_id, '1080p') : undefined;
  const bannerUrl = game.banner_image_id ? igdbImageUrl(game.banner_image_id, '1080p') : undefined;

  // Release date breakdown
  const releaseDateParts = game.first_release_date ? unixToDateParts(game.first_release_date) : undefined;
  const releaseYear = releaseDateParts?.year ?? undefined;
  const releaseMonth = releaseDateParts?.month ?? undefined;
  const releaseDay = releaseDateParts?.day ?? undefined;

  const releaseDate = releaseDateParts
    ? formatDateParts(releaseDateParts, { monthStyle: 'long', requireDay: true })
    : null;

  // Alternative names: native (JP chars or "japanese" comment) and romaji
  const altNames = game.alternative_names ?? [];
  const titleNative = findAltName(
    altNames,
    (comment, name) => comment.includes('japanese') || /[぀-ヿ一-龯]/.test(name),
  );
  const titleRomaji = findAltName(
    altNames,
    (comment) => comment.includes('romaji') || comment.includes('romanized'),
  );

  // Type from rawId prefix (e.g. "vnovel:12345" → "vnovel")
  const mediaType = rawId.split(':')[0].split('_')[0] as 'game' | 'vnovel';

  // Format: a plain (game_type 0) VN is VISUAL_NOVEL; every other game_type
  // (remake, remaster, DLC, ...) uses the same GAME_TYPE_FORMAT label
  // regardless of vnovel/game — a VN's remake is still a REMAKE. Forcing
  // every vnovel-typed entry to VISUAL_NOVEL unconditionally used to erase
  // that distinction: the format badge showed "Visual Novel" instead of
  // "Remake"/"Remaster" on those pages, and the FULL_EDITION_FORMATS-based
  // stale-relation pruning in media-relations.ts silently never applied to
  // any VN (its `format` never matched REMAKE/REMASTER/etc).
  const gameType = game.game_type ?? 0;
  const format = gameType === 0 && mediaType === 'vnovel' ? 'VISUAL_NOVEL' : (GAME_TYPE_FORMAT[gameType] ?? 'GAME');

  // Genre split: core genres → genreDots, tags → genreTagDots
  const { core: coreGenres, tags: genreTags } = unifyGenres(genres);
  const genreDots = coreGenres.join(' · ') || undefined;
  const genreTagDots = genreTags.join(' · ') || undefined;

  // Score (prefer total_rating, fallback to rating — IGDB is /100)
  const scoreGlobal = normalizeScore100(game.total_rating ?? game.rating);

  const canonicalStatus = canonicalizeIgdbStatus(game.status);
  const statusLabel = canonicalStatus ? lookupLabel(tm.statuses, canonicalStatus, canonicalStatus) : undefined;
  const statusClass = canonicalStatus ? (STATUS_BADGE_CLASS[canonicalStatus] ?? '') : '';

  const stats: { label: string; value: string }[] = [];
  if (scoreGlobal) stats.push({ label: tm.stat_score, value: scoreGlobal.toFixed(1) + ' / 10' });
  if (statusLabel) stats.push({ label: tm.stat_status, value: statusLabel });

  const metaLines: string[] = [];
  if (platforms.length) metaLines.push(platforms.join(' · '));
  if (publishers.length) metaLines.push(publishers.join(', '));

  // Agrupamiento y mapeo de las relaciones de IGDB en secciones
  const relations: MediaRelation[] = [];

  // `relationType` must be the same canonical key used everywhere else in the
  // system (EDITABLE_RELATION_OPTIONS, the i18n `relations` table, the saved
  // DB row) — it used to be the raw English display label itself (e.g.
  // "Expanded Edition"), which meant it never matched EDITABLE_RELATION_OPTIONS
  // and the collaborative-catalog editor rendered it as an extra, unlocalized
  // duplicate option alongside the real (localized) "EXPANDED_GAME" entry.
  //
  // IGDB sometimes lists the exact same title under more than one of these
  // categories (e.g. both `expansions` and `standalone_expansions`) — a work
  // can only relate to another one way, so the first category to claim an id
  // wins and later calls silently skip it, rather than pushing a second
  // relation object IGDB itself considers the same underlying game.
  const seenRelatedIds = new Set<string>();
  const addRelations = (subGames: IgdbSubGame[] | undefined, defaultRelationType: keyof typeof canonicalRelationLabels) => {
    if (!subGames) return;
    for (const sg of dedupeEditionVariants(subGames)) {
      const relatedExternalId = `${sg.is_vn ? 'vnovel' : 'game'}:${sg.id}`;
      // IGDB occasionally lists a game among its own remakes/remasters/etc.
      // (a self-reference in its data, not a bug on our end) — never turn
      // that into a relation pointing a media at itself. Compared by the raw
      // numeric IGDB id, not the computed "type:id" string — `is_vn` is
      // derived per-record and can disagree with how the *current* page
      // classified the same underlying game, so two references to the same
      // id can end up with different type prefixes ("game:79848" vs
      // "vnovel:79848") and slip past a plain string comparison.
      if (sg.id === game.id) continue;
      if (seenRelatedIds.has(relatedExternalId)) continue;
      seenRelatedIds.add(relatedExternalId);

      const cover = sg.cover?.image_id ? igdbImageUrl(sg.cover.image_id, 'cover_big') : undefined;
      const title = cleanEditionTitle(sg.name);
      
      const queryParams = new URLSearchParams({ id: relatedExternalId });
      queryParams.set('t', title);
      if (cover) queryParams.set('c', cover);

      // Dynamically detect updates (game_type 14) so they are grouped under "REL_UPDATE"
      const relationType = sg.game_type === 14 ? 'REL_UPDATE' : defaultRelationType;

      relations.push({
        typeLabel: canonicalRelationLabels[relationType],
        relationType,
        title,
        cover,
        url: `/media?${queryParams.toString()}`,
        relatedExternalId,
      });
    }
  };

  // IGDB has been seen returning a game as its own parent_game/version_parent
  // (a self-reference in its data) — ignore that instead of rendering the
  // page's own "Fuente"/parent card as itself. Compared by numeric id, same
  // reasoning as addRelations() above.
  const rawParentSub = game.parent_game || game.version_parent;
  const parentSub = rawParentSub && rawParentSub.id !== game.id
    ? rawParentSub
    : undefined;
  const parentGame = parentSub
    ? {
        title: parentSub.name,
        externalId: `${parentSub.is_vn ? 'vnovel' : 'game'}:${parentSub.id}`,
        cover: parentSub.cover?.image_id ? igdbImageUrl(parentSub.cover.image_id, 'cover_big') : undefined,
      }
    : undefined;

  // IGDB tends to copy/inherit the base game's whole sibling-editions web
  // onto a "full edition" of that game (remake/remaster/expanded edition/
  // port/fork) — e.g. a remaster's own "standalone_expansions" field
  // pointing at the *original, non-remastered* expansion, rendering as if
  // it belonged to the remaster. So those types only ever get their
  // Fuente/parent relation (set below, unconditionally) — nothing else from
  // their own IGDB record.
  //
  // Content attached to a specific release (DLC/expansion/standalone
  // expansion/episode/season/mod/update) doesn't have that inheritance
  // problem — its own remakes/remasters/etc. genuinely describe *that*
  // piece of content (e.g. an expansion's own remaster), so those types
  // keep their full direct relations alongside their Fuente.
  const IS_FULL_EDITION_TYPE = new Set([8, 9, 10, 11, 12]); // remake, remaster, expanded_game, port, fork
  if (!IS_FULL_EDITION_TYPE.has(gameType)) {
    // Sibling editions are only shown on the base game — IGDB tends to inherit
    // the base game's whole edition web onto remakes/remasters, so we block them there.
    addRelations(game.remakes, 'REMAKE');
    addRelations(game.remasters, 'REMASTER');
    addRelations(game.expanded_games, 'EXPANDED_GAME');
    addRelations(game.forks, 'FORK');
  }
  // Full editions (remake/remaster/expanded_game/port/fork) get nothing here
  // beyond their Fuente relation below — their own remasters/expanded_games
  // fields are just as inherited-from-the-base-game as standalone_expansions
  // was (see comment above), so a remake showing "its own remaster" was
  // actually always the *base game's* remaster, not one made from the remake.
  // Content (DLCs/expansions/standalone) is genuinely attached to whichever
  // specific game IGDB links it to — a remake's exclusive DLC should appear
  // on the remake's page, not only on the base game's page.
  addRelations(game.dlcs, 'DLC');
  addRelations(game.expansions, 'EXPANSION');
  addRelations(game.standalone_expansions, 'STANDALONE');

  // Unlike remakes/remasters (which need a reverse `where remakes/remasters
  // = id` lookup — see mediaService.ts — because IGDB doesn't reliably set a
  // forward parent field on those), DLCs/expansions/standalone expansions
  // usually DO have `parent_game`/`version_parent` pointing at the base game
  // directly, so their Fuente relation can be added right here without an
  // extra request.
  if (parentSub) {
    const relatedExternalId = `${parentSub.is_vn ? 'vnovel' : 'game'}:${parentSub.id}`;
    if (!seenRelatedIds.has(relatedExternalId)) {
      seenRelatedIds.add(relatedExternalId);
      relations.push({
        typeLabel: canonicalRelationLabels.PARENT,
        relationType: 'PARENT',
        title: cleanEditionTitle(parentSub.name),
        cover: parentSub.cover?.image_id ? igdbImageUrl(parentSub.cover.image_id, 'cover_big') : undefined,
        url: `/media?id=${relatedExternalId}`,
        relatedExternalId,
      });
    }
  }

  return {
    externalId: rawId,
    type: mediaType,
    titleMain: game.name,
    titleNative: titleNative,
    titleEnglish: titleRomaji,   // romaji plays the "english" slot in MediaPageData
    cover: coverUrl,
    bannerImage: bannerUrl,
    bannerColor: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    statusLabel,
    statusClass,
    genreDots,
    genreTagDots,
    metaLines,
    dateBadge: releaseDate ?? undefined,
    developerBadge: developers[0] ?? undefined,
    description: game.summary,
    stats,
    characters: [],
    relations,
    parentGame,
    progressStatus: 'playing',
    progressLabel: getT().profile.status_playing,
    storeLinks: dedupeStoreLinks(game.store_links),
    // Catalog fields
    format,
    source: 'igdb',
    sourceUrl: game.url,
    releaseYear,
    releaseMonth,
    releaseDay,
    platforms,
    scoreGlobal,
    status: canonicalStatus,
    companies: [...new Set([...developers, ...publishers])],
  };
}

// ── Base game merge (remakes only) ────────────────────────────────────────
// Fetched separately (see igdb_get_base_games) since it's a reverse lookup
// only needed for the minority of games that are remakes.

export function mergeBaseGameRelation(data: MediaPageData, baseGames: IgdbSubGame[]): MediaPageData {
  if (!baseGames.length) return data;
  // Same IGDB self-reference quirk as elsewhere in this file — compared by
  // numeric id, not the "type:id" string (see addRelations()'s comment).
  const currentNumericId = parseInt(data.externalId.split(':')[1], 10);
  const baseRelations: MediaRelation[] = dedupeEditionVariants(baseGames)
    .filter(sg => sg.id !== currentNumericId)
    .map(sg => {
    const relatedExternalId = `${sg.is_vn ? 'vnovel' : 'game'}:${sg.id}`;
    const cover = sg.cover?.image_id ? igdbImageUrl(sg.cover.image_id, 'cover_big') : undefined;
    const title = cleanEditionTitle(sg.name);
    
    const queryParams = new URLSearchParams({ id: relatedExternalId });
    queryParams.set('t', title);
    if (cover) queryParams.set('c', cover);

    return {
      typeLabel: canonicalRelationLabels.PARENT,
      relationType: 'PARENT',
      title,
      cover,
      url: `/media?${queryParams.toString()}`,
      relatedExternalId,
    };
  });
  return { ...data, relations: [...baseRelations, ...data.relations] };
}

// ── Transitive relation graph merge ──────────────────────────────────────
// igdb_get_relation_graph walks the forward relation arrays (and parent_game)
// breadth-first so that e.g. a remaster of an expanded edition, or a port of
// a remaster, still surfaces here even though it's 2-3 hops away from the
// game currently being viewed, not a direct IGDB relation.

export interface RelationGraphNode {
  id: number;
  name: string;
  cover?: { image_id: string };
  via: string;
  is_vn?: boolean;
}

// IGDB relation-array field name -> the same canonical relation_type key
// addRelations() above uses. This used to map straight to a raw English
// label ("Expanded Edition") instead, which — since this graph-walk result
// merges into the same `data.relations` array the direct fetch already
// populated with the canonical key — meant the *same* related game could
// show up twice: once correctly labeled from the direct fetch, once again
// here under its old, unlocalized, un-deduped-against-DB label.
const VIA_TO_RELATION_TYPE: Record<string, string> = {
  remakes: 'REMAKE',
  remasters: 'REMASTER',
  dlcs: 'DLC',
  expansions: 'EXPANSION',
  standalone_expansions: 'STANDALONE',
  expanded_games: 'EXPANDED_GAME',
  forks: 'FORK',
  parent_game: 'PARENT',
};

export function mergeRelationGraph(data: MediaPageData, nodes: RelationGraphNode[], gameType?: number): MediaPageData {
  if (!nodes.length) return data;

  const tm = getT().media;

  const seen = new Set<string>([data.externalId]);
  if (data.parentGame) seen.add(data.parentGame.externalId);
  for (const r of data.relations) {
    if (r.relatedExternalId) seen.add(r.relatedExternalId);
  }

  // Group by "via" so edition/collection SKU duplicates are deduped within
  // their own relation category, same as the direct-relation path.
  const byVia = new Map<string, RelationGraphNode[]>();
  for (const n of nodes) {
    // Ports never show as related versions.
    if (n.via === 'ports') continue;
    // Expanded editions (game_type 10) commonly turn up unrelated remasters
    // of the base game rather than a remaster of the edition itself — skip.
    if (n.via === 'remasters' && gameType === 10) continue;
    const group = byVia.get(n.via);
    if (group) group.push(n); else byVia.set(n.via, [n]);
  }

  const extra: MediaRelation[] = [];
  for (const group of byVia.values()) {
    for (const n of dedupeEditionVariants(group)) {
      const externalId = `${n.is_vn ? 'vnovel' : 'game'}:${n.id}`;
      if (seen.has(externalId)) continue;
      seen.add(externalId);
      const cover = n.cover?.image_id ? igdbImageUrl(n.cover.image_id, 'cover_big') : undefined;
      const title = cleanEditionTitle(n.name);
      
      const queryParams = new URLSearchParams({ id: externalId });
      queryParams.set('t', title);
      if (cover) queryParams.set('c', cover);

      const relationType = VIA_TO_RELATION_TYPE[n.via];
      extra.push({
        typeLabel: relationType ? canonicalRelationLabels[relationType as keyof typeof canonicalRelationLabels] : 'Related',
        relationType: relationType ?? n.via,
        title,
        cover,
        url: `/media?${queryParams.toString()}`,
        relatedExternalId: externalId,
      });
    }
  }
  if (!extra.length) return data;
  return { ...data, relations: dedupeRelationsByTarget([...data.relations, ...extra]) };
}

// Final safety net: even with every merge step deduping against what it's
// about to append, three independent relation sources feed the same
// `data.relations` array (direct IGDB fetch, this transitive graph walk,
// DB-persisted rows) — collapsing by target id here guarantees the same
// related work can never render twice regardless of which upstream step
// let one slip through. Keeps the first occurrence (direct fetch / DB rows
// are merged in before this graph walk runs, so they take priority over a
// less-specific transitively-discovered duplicate).
export function dedupeRelationsByTarget(relations: MediaRelation[]): MediaRelation[] {
  const seen = new Set<string>();
  const result: MediaRelation[] = [];
  for (const r of relations) {
    const key = r.relatedExternalId ?? r.url ?? `${r.typeLabel}:${r.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(r);
  }
  return result;
}

