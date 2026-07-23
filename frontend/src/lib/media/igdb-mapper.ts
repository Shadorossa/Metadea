import { igdbImageUrl } from '../tauri';
import { getT } from '../../i18n/client';
import type { MediaPageData, MediaRelation, MediaStat, MediaCompany } from './types';
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
  /** IGDB's edition/version category (0 game, 1 dlc_addon, 8 remake, 9
   *  remaster, 10 expanded_game, 14 update, ...). */
  game_type?: number;
  /** Own-genre VN classification (igdb.rs's detect_vn) — a related title can
   *  be a VN even when the current page isn't, so its external_id prefix
   *  can't just inherit the page's own type. */
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
    company?: { id: number; name: string; logo?: { image_id: string } };
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
  const platforms = [...new Set((game.platforms ?? []).map(p => p.name))];

  // Structured (id + logo + role), for the relational companies/
  // media_by_company tables — a company can carry both roles at once
  // (self-published), so this yields one entry per role, not per company.
  const toMediaCompany = (c: NonNullable<IgdbDetailGame['involved_companies']>[number], role: 'developer' | 'publisher'): MediaCompany | null => {
    if (!c.company) return null;
    return {
      external_id: `company:${c.company.id}`,
      name: c.company.name,
      logo_url: c.company.logo?.image_id ? igdbImageUrl(c.company.logo.image_id, 'logo_med') : null,
      role,
    };
  };
  const companies: MediaCompany[] = (game.involved_companies ?? []).flatMap(c => {
    const entries: MediaCompany[] = [];
    if (c.developer) { const m = toMediaCompany(c, 'developer'); if (m) entries.push(m); }
    if (c.publisher) { const m = toMediaCompany(c, 'publisher'); if (m) entries.push(m); }
    return entries;
  });
  const publisherNames = companies.filter(c => c.role === 'publisher').map(c => c.name);

  const coverUrl = game.cover?.image_id ? igdbImageUrl(game.cover.image_id, '1080p') : undefined;
  const bannerUrl = game.banner_image_id ? igdbImageUrl(game.banner_image_id, '1080p') : undefined;

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

  // Only a plain (game_type 0) VN is VISUAL_NOVEL — a VN's remake is still a
  // REMAKE, so other game_types keep the same GAME_TYPE_FORMAT label.
  const gameType = game.game_type ?? 0;
  const format = gameType === 0 && mediaType === 'vnovel' ? 'VISUAL_NOVEL' : (GAME_TYPE_FORMAT[gameType] ?? 'GAME');

  const { core: coreGenres, tags: genreTags } = unifyGenres(genres);
  const genreDots = coreGenres.join(' · ') || undefined;
  const genreTagDots = genreTags.join(' · ') || undefined;

  // `||` not `??`: total_rating of exactly 0 (no reviews yet) must still
  // fall back to `rating`, not be treated as a real, final score.
  const scoreGlobal = normalizeScore100(game.total_rating || game.rating);

  let canonicalStatus = canonicalizeIgdbStatus(game.status);
  if (game.first_release_date) {
    const hasReleased = game.first_release_date * 1000 <= Date.now();
    if (!hasReleased) {
      canonicalStatus = 'NOT_YET_RELEASED';
    } else if (hasReleased && (canonicalStatus === 'NOT_YET_RELEASED' || !canonicalStatus)) {
      canonicalStatus = 'FINISHED';
    }
  }

  const statusLabel = canonicalStatus ? lookupLabel(tm.statuses, canonicalStatus, canonicalStatus) : undefined;
  const statusClass = canonicalStatus ? (STATUS_BADGE_CLASS[canonicalStatus] ?? '') : '';

  const formatLabel = lookupLabel(tm.formats, format, format);

  const stats: MediaStat[] = [];
  if (scoreGlobal) stats.push({ label: tm.stat_score, value: String(scoreGlobal), isScore: true });
  if (formatLabel || statusLabel) {
    const formatStat: MediaStat = { label: tm.stat_format, value: formatLabel };
    if (statusLabel) {
      formatStat.label2 = tm.stat_status;
      formatStat.value2 = statusLabel;
    }
    stats.push(formatStat);
  }

  // Platforms get their own Datos block (MediaPage.tsx) — this slot is
  // publisher-only, for consistency with other content types.
  const metaLines: string[] = [];
  if (publisherNames.length) metaLines.push(publisherNames.join(', '));

  const relations: MediaRelation[] = [];

  // relationType must stay the canonical key (EDITABLE_RELATION_OPTIONS/i18n/
  // DB), never IGDB's raw label. IGDB can list the same title under more than
  // one category — first one to claim an id wins.
  const seenRelatedIds = new Set<string>();
  const addRelations = (subGames: IgdbSubGame[] | undefined, defaultRelationType: keyof typeof canonicalRelationLabels) => {
    if (!subGames) return;
    for (const sg of dedupeEditionVariants(subGames)) {
      const relatedExternalId = `${sg.is_vn ? 'vnovel' : 'game'}:${sg.id}`;
      // IGDB occasionally self-references a game as its own remake/remaster.
      // Compared by numeric id, not "type:id" — is_vn can disagree per-record.
      if (sg.id === game.id) continue;
      if (seenRelatedIds.has(relatedExternalId)) continue;
      seenRelatedIds.add(relatedExternalId);

      const cover = sg.cover?.image_id ? igdbImageUrl(sg.cover.image_id, 'cover_big') : undefined;
      const title = cleanEditionTitle(sg.name);
      
      const queryParams = new URLSearchParams({ id: relatedExternalId });
      queryParams.set('t', title);
      if (cover) queryParams.set('c', cover);

      // Updates (game_type 14) get grouped under REL_UPDATE dynamically.
      const relationType = sg.game_type === 14 ? 'REL_UPDATE' : defaultRelationType;

      relations.push({
        typeLabel: canonicalRelationLabels[relationType],
        relationType,
        title,
        cover,
        url: `/media?${queryParams.toString()}`,
        relatedExternalId,
        format: sg.game_type != null ? GAME_TYPE_FORMAT[sg.game_type] : undefined,
      });
    }
  };

  // Same self-reference guard as addRelations().
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

  // IGDB inherits the base game's whole sibling-editions web onto a "full
  // edition" (remake/remaster/expanded/port/fork) — e.g. a remaster's own
  // standalone_expansions pointing at the original's expansion. So those
  // types only get their Fuente relation below, nothing from their own
  // record. DLC/expansion/standalone genuinely belong to whichever specific
  // game IGDB links them to, so they keep their full relations regardless.
  const IS_FULL_EDITION_TYPE = new Set([8, 9, 10, 11, 12]); // remake, remaster, expanded_game, port, fork
  if (!IS_FULL_EDITION_TYPE.has(gameType)) {
    addRelations(game.remakes, 'REMAKE');
    addRelations(game.remasters, 'REMASTER');
    addRelations(game.expanded_games, 'EXPANDED_GAME');
    addRelations(game.forks, 'FORK');
  }
  addRelations(game.dlcs, 'DLC');
  addRelations(game.expansions, 'EXPANSION');
  addRelations(game.standalone_expansions, 'STANDALONE');

  // Unlike remakes/remasters (which need a reverse lookup — see
  // mediaService.ts), DLC/expansion/standalone usually have parent_game/
  // version_parent pointing at the base game directly.
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
        format: parentSub.game_type != null ? GAME_TYPE_FORMAT[parentSub.game_type] : undefined,
      });
    }
  }

  return {
    externalId: rawId,
    type: mediaType,
    titleMain: game.name,
    titleNative: titleNative,
    titleRomaji: titleRomaji,
    cover: coverUrl,
    bannerImage: bannerUrl,
    bannerColor: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    statusLabel,
    statusClass,
    genreDots,
    genreTagDots,
    metaLines,
    dateBadge: releaseDate ?? undefined,
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
    companies,
  };
}

// ── Base game merge (remakes only) ────────────────────────────────────────
// Fetched separately (see igdb_get_base_games) since it's a reverse lookup
// only needed for the minority of games that are remakes.

export function mergeBaseGameRelation(data: MediaPageData, baseGames: IgdbSubGame[]): MediaPageData {
  if (!baseGames.length) return data;
  // Same self-reference guard as mapIgdbToMedia's addRelations().
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
// addRelations() uses (must match, since this merges into the same array).
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

  // Group by "via" so edition/SKU duplicates dedupe within their own category.
  const byVia = new Map<string, RelationGraphNode[]>();
  for (const n of nodes) {
    if (n.via === 'ports') continue; // ports never show as related versions
    // An expanded edition's "remasters" is usually the base game's, not its own.
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

// Final safety net across the three relation sources (direct fetch, graph
// walk, DB rows) — keeps the first occurrence (direct fetch/DB rows win).
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

