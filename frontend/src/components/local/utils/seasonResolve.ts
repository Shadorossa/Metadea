// Resolves which catalog entry (external_id) each season of a multi-season
// work actually belongs to — used by "Localizar" (LocalMediaDetailPanel) so
// a folder mixing several seasons' episodes (each season its own separate
// catalog entry, like Ghost in the Shell: Stand Alone Complex season 1 and
// its "2nd GIG" season 2) tags each file with the season it ACTUALLY
// belongs to, not always the one being localized right now.
import { getMediaRelationsForEditor, getAnilistPreSequelChecked, markAnilistPreSequelChecked } from '../../../lib/tauri';
import { graphqlPost } from '../../../lib/api/client';
import { API_ENDPOINTS } from '../../../lib/api/endpoints';
import { extractTitleSeason } from './folderMatch';

export interface SeasonInfo {
  externalId: string;
  title: string;
}

const SEASON_RELATIONS_QUERY = `
query($id: Int) {
  Media(id: $id) {
    relations {
      edges {
        relationType
        node {
          id
          title { romaji english }
        }
      }
    }
  }
}`;

interface AniListRelationsResponse {
  Media: {
    relations: {
      edges: Array<{
        relationType: string;
        node: { id: number; title: { romaji: string | null; english: string | null } };
      }>;
    };
  };
}

type RelationEdge = AniListRelationsResponse['Media']['relations']['edges'][number];

// resolveSeasonExternalIds and findPrequelExternalId both end up asking
// AniList the exact same question for the exact same id whenever the local
// media_relations table has nothing cached yet — the first without a season
// number in its title (the common case) always hits this once via
// findPrequelExternalId, and if that turns up a hit, the season-map build
// right after re-asks AniList for the very same id a second time. Module-
// level cache keyed by numericId (not persisted — just for this app
// session) so every caller after the first one reuses the same in-flight
// promise instead of firing a duplicate request.
const relationsCache = new Map<number, Promise<RelationEdge[]>>();

// Most titles in a library are standalone or already-season-1 — AniList
// genuinely has no PREQUEL to report for them, but that "no" was never
// remembered anywhere, so every single Local panel open re-asked AniList the
// same question forever. anilist_pre_sequel (see db.rs migration 47) records
// a confirmed "no prequel" so it's only ever asked once per title, persisted
// across app restarts — not just this session.
//
// Only the PREQUEL side is what gates the cache write — a root/season-1
// title very often DOES have a real SEQUEL (that's what makes it season 1
// of something), which resolveOwnSeasonNumber's hop-walk always ends up
// re-checking on its way up a chain (see The Big O: season 2 has its own
// PREQUEL cached locally already, but the walk still asks whether ITS
// prequel, season 1, has a prequel of its own too). Gating on "no chain
// relation at all" meant a title with a real sequel but no prequel — the
// single most common shape for any franchise's root — could never get
// cached, since it always failed that check. The sequel side is already
// covered by media_relations by the time anything reads it forward, so
// missing it here from this specific cache costs nothing.
// A network failure never marks anything, so it's retried normally later.
function fetchAniListRelationEdges(externalId: string, numericId: number): Promise<RelationEdge[]> {
  let cached = relationsCache.get(numericId);
  if (cached) return cached;

  cached = (async () => {
    const alreadyChecked = await getAnilistPreSequelChecked(externalId).catch(() => false);
    if (alreadyChecked) return [];

    try {
      const { result } = await graphqlPost<AniListRelationsResponse>(API_ENDPOINTS.ANILIST, SEASON_RELATIONS_QUERY, { id: numericId });
      const edges = result?.data?.Media?.relations?.edges ?? [];
      const hasPrequel = edges.some(e => e.relationType === 'PREQUEL');
      if (!hasPrequel) markAnilistPreSequelChecked(externalId).catch(() => {});
      return edges;
    } catch {
      return [];
    }
  })();
  relationsCache.set(numericId, cached);
  return cached;
}

// Checks this install's own saved relations first (SEQUEL/PREQUEL rows,
// same as PrEditorModal's own saga chain) and only calls out to AniList
// directly if nothing usable turned up locally — e.g. a fresh install that
// never opened the sequel's own page yet, so nothing's been cached to DB.
export async function resolveSeasonExternalIds(
  externalId: string,
  title: string,
  season: number | null,
): Promise<Record<number, SeasonInfo>> {
  const map: Record<number, SeasonInfo> = { [season ?? 1]: { externalId, title } };

  try {
    const relations = await getMediaRelationsForEditor(externalId);
    const chainRelations = relations.filter(r => r.relation_type === 'SEQUEL' || r.relation_type === 'PREQUEL');
    for (const rel of chainRelations) {
      const relSeason = extractTitleSeason(rel.title);
      if (relSeason != null && !(relSeason in map)) {
        map[relSeason] = { externalId: rel.related_media_external_id, title: rel.title };
      }
    }
    // The DB already had a real answer here — even a related title whose
    // own season number couldn't be parsed from its title (e.g. a root
    // title with no season word at all, like plain "THE Big O") means
    // there's genuinely nothing further AniList could add for this specific
    // relation; re-asking would just return the exact same unparseable
    // title again.
    if (chainRelations.length > 0) return map;
  } catch {
    // Fall through to the AniList check below.
  }

  // Only anime/manga carry an AniList relation graph to check at all.
  const [type, idStr] = externalId.split(':');
  if (type !== 'anime' && type !== 'manga') return map;
  const numericId = parseInt(idStr, 10);
  if (!Number.isFinite(numericId)) return map;

  const edges = await fetchAniListRelationEdges(externalId, numericId);
  for (const edge of edges) {
    if (edge.relationType !== 'SEQUEL' && edge.relationType !== 'PREQUEL') continue;
    const nodeTitle = edge.node.title.romaji ?? edge.node.title.english ?? '';
    const relSeason = extractTitleSeason(nodeTitle);
    if (relSeason != null && !(relSeason in map)) {
      map[relSeason] = { externalId: `${type}:${edge.node.id}`, title: nodeTitle };
    }
  }

  return map;
}

async function findPrequelExternalId(externalId: string): Promise<string | null> {
  try {
    const relations = await getMediaRelationsForEditor(externalId);
    const prequel = relations.find(r => r.relation_type === 'PREQUEL');
    if (prequel) return prequel.related_media_external_id;
  } catch {
    // Fall through to the AniList check below.
  }

  const [type, idStr] = externalId.split(':');
  if (type !== 'anime' && type !== 'manga') return null;
  const numericId = parseInt(idStr, 10);
  if (!Number.isFinite(numericId)) return null;

  const edges = await fetchAniListRelationEdges(externalId, numericId);
  const prequel = edges.find(e => e.relationType === 'PREQUEL');
  return prequel ? `${type}:${prequel.node.id}` : null;
}

// Some sequels never get a title AniList/extractTitleSeason can read a
// season number out of at all — e.g. "The Big O II" (roman numeral) or
// "... (2003)" (a year suffix instead of a season word). Falls back to
// counting PREQUEL hops back to a true root: one hop = season 2, two = 3,
// etc. Depth-capped purely to bound how many round trips a dead-end chain
// can cost, not because a real franchise is expected to hit it.
export async function resolveOwnSeasonNumber(externalId: string, title: string): Promise<number | null> {
  const fromTitle = extractTitleSeason(title);
  if (fromTitle != null) return fromTitle;

  let hops = 0;
  let currentId = externalId;
  for (let i = 0; i < 6; i++) {
    const prequelId = await findPrequelExternalId(currentId);
    if (!prequelId) break;
    hops++;
    currentId = prequelId;
  }
  return hops > 0 ? hops + 1 : null;
}
