import { igdbImageUrl } from '../tauri';
import { getT } from '../../i18n/client';
import type { MediaPageData, MediaRelation } from './types';
import { unifyGenres } from './genre-unifier';
import { cleanEditionTitle, dedupeEditionVariants } from './title-utils';
import { unixToDateParts, formatDateParts, normalizeScore100 } from './mapper-utils';

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
  summary?: string;
  cover?: { image_id: string };
  banner_image_id?: string | null;
  first_release_date?: number;
  rating?: number;
  total_rating?: number;
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

// IGDB's numeric `game_type`/`category` enum (0 = base game, 8 = remake, 9 =
// remaster, ...) is also mapped independently in the Cloudflare Worker at
// backend/src/services/igdb.ts (IGDB_CATEGORY_LABELS) for search results —
// same IGDB enum, two apps that can't share a module, so keep both in sync
// by hand when IGDB's category list changes.
const GAME_TYPE_FORMAT: Record<number, string> = {
  0: 'GAME',
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

  // Format: VNs are always VISUAL_NOVEL; games use game_type
  const gameType = game.game_type ?? 0;
  const format = mediaType === 'vnovel' ? 'VISUAL_NOVEL' : (GAME_TYPE_FORMAT[gameType] ?? 'GAME');

  // Genre split: core genres → genreDots, tags → genreTagDots
  const { core: coreGenres, tags: genreTags } = unifyGenres(genres);
  const genreDots = coreGenres.join(' · ') || undefined;
  const genreTagDots = genreTags.join(' · ') || undefined;

  // Score (prefer total_rating, fallback to rating — IGDB is /100)
  const scoreGlobal = normalizeScore100(game.total_rating ?? game.rating);

  const stats: { label: string; value: string }[] = [];
  if (scoreGlobal) stats.push({ label: tm.stat_score, value: scoreGlobal.toFixed(1) + ' / 10' });

  const metaLines: string[] = [];
  if (platforms.length) metaLines.push(platforms.join(' · '));
  if (publishers.length) metaLines.push(publishers.join(', '));

  // Agrupamiento y mapeo de las relaciones de IGDB en secciones
  const relations: MediaRelation[] = [];

  const addRelations = (subGames: IgdbSubGame[] | undefined, label: string) => {
    if (!subGames) return;
    for (const sg of dedupeEditionVariants(subGames)) {
      const cover = sg.cover?.image_id ? igdbImageUrl(sg.cover.image_id, 'cover_big') : undefined;
      relations.push({
        typeLabel: label,
        title: cleanEditionTitle(sg.name),
        cover,
        url: `/media?id=${sg.is_vn ? 'vnovel' : 'game'}:${sg.id}`,
      });
    }
  };

  const parentSub = game.parent_game || game.version_parent;
  const parentGame = parentSub
    ? {
        title: parentSub.name,
        externalId: `${parentSub.is_vn ? 'vnovel' : 'game'}:${parentSub.id}`,
        cover: parentSub.cover?.image_id ? igdbImageUrl(parentSub.cover.image_id, 'cover_big') : undefined,
      }
    : undefined;

  addRelations(game.remakes, 'Remake');
  // Expanded editions (game_type 10) commonly point at unrelated remasters
  // of the base game rather than a remaster of the edition itself — skip.
  if (gameType !== 10) addRelations(game.remasters, 'Remaster');
  addRelations(game.dlcs, 'DLC');
  addRelations(game.expansions, 'Expansion');
  addRelations(game.standalone_expansions, 'Standalone');
  addRelations(game.expanded_games, 'Expanded Edition');
  // Ports are never shown as related versions.
  addRelations(game.forks, 'Fork');

  return {
    externalId: rawId,
    type: mediaType,
    titleMain: game.name,
    titleNative: titleNative,
    titleEnglish: titleRomaji,   // romaji plays the "english" slot in MediaPageData
    cover: coverUrl,
    bannerImage: bannerUrl,
    bannerColor: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
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
    releaseYear,
    releaseMonth,
    releaseDay,
    platforms,
    scoreGlobal,
    companies: [...new Set([...developers, ...publishers])],
  };
}

// ── Base game merge (remakes only) ────────────────────────────────────────
// Fetched separately (see igdb_get_base_games) since it's a reverse lookup
// only needed for the minority of games that are remakes.

export function mergeBaseGameRelation(data: MediaPageData, baseGames: IgdbSubGame[]): MediaPageData {
  if (!baseGames.length) return data;
  const tm = getT().media;
  const baseRelations: MediaRelation[] = dedupeEditionVariants(baseGames).map(sg => ({
    typeLabel: tm.relations.PARENT,
    title: cleanEditionTitle(sg.name),
    cover: sg.cover?.image_id ? igdbImageUrl(sg.cover.image_id, 'cover_big') : undefined,
    url: `/media?id=${sg.is_vn ? 'vnovel' : 'game'}:${sg.id}`,
  }));
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

export function mergeRelationGraph(data: MediaPageData, nodes: RelationGraphNode[], gameType?: number): MediaPageData {
  if (!nodes.length) return data;

  const tm = getT().media;
  const VIA_LABELS: Record<string, string> = {
    remakes: 'Remake',
    remasters: 'Remaster',
    dlcs: 'DLC',
    expansions: 'Expansion',
    standalone_expansions: 'Standalone',
    expanded_games: 'Expanded Edition',
    ports: 'Port',
    forks: 'Fork',
    parent_game: tm.relations.PARENT,
    relation: 'Related',
  };

  const seen = new Set<string>([data.externalId]);
  if (data.parentGame) seen.add(data.parentGame.externalId);
  for (const r of data.relations) {
    const match = r.url?.match(/id=([^&]+)/);
    if (match) seen.add(decodeURIComponent(match[1]));
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
      extra.push({
        typeLabel: VIA_LABELS[n.via] ?? VIA_LABELS.relation,
        title: cleanEditionTitle(n.name),
        cover: n.cover?.image_id ? igdbImageUrl(n.cover.image_id, 'cover_big') : undefined,
        url: `/media?id=${externalId}`,
      });
    }
  }
  if (!extra.length) return data;
  return { ...data, relations: [...data.relations, ...extra] };
}

