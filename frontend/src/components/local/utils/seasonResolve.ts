// Resolves which catalog entry (external_id) each season of a multi-season
// work actually belongs to — used by "Localizar" (LocalMediaDetailPanel) so
// a folder mixing several seasons' episodes (each season its own separate
// catalog entry, like Ghost in the Shell: Stand Alone Complex season 1 and
// its "2nd GIG" season 2) tags each file with the season it ACTUALLY
// belongs to, not always the one being localized right now.
import { getMediaRelationsForEditor } from '../../../lib/tauri';
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
    let addedFromDb = false;
    for (const rel of chainRelations) {
      const relSeason = extractTitleSeason(rel.title);
      if (relSeason != null && !(relSeason in map)) {
        map[relSeason] = { externalId: rel.related_media_external_id, title: rel.title };
        addedFromDb = true;
      }
    }
    if (addedFromDb) return map;
  } catch {
    // Fall through to the AniList check below.
  }

  // Only anime/manga carry an AniList relation graph to check at all.
  const [type, idStr] = externalId.split(':');
  if (type !== 'anime' && type !== 'manga') return map;
  const numericId = parseInt(idStr, 10);
  if (!Number.isFinite(numericId)) return map;

  try {
    const { result } = await graphqlPost<AniListRelationsResponse>(API_ENDPOINTS.ANILIST, SEASON_RELATIONS_QUERY, { id: numericId });
    const edges = result?.data?.Media?.relations?.edges ?? [];
    for (const edge of edges) {
      if (edge.relationType !== 'SEQUEL' && edge.relationType !== 'PREQUEL') continue;
      const nodeTitle = edge.node.title.romaji ?? edge.node.title.english ?? '';
      const relSeason = extractTitleSeason(nodeTitle);
      if (relSeason != null && !(relSeason in map)) {
        map[relSeason] = { externalId: `${type}:${edge.node.id}`, title: nodeTitle };
      }
    }
  } catch {
    // Best-effort — leave the map with just this work's own season.
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

  try {
    const { result } = await graphqlPost<AniListRelationsResponse>(API_ENDPOINTS.ANILIST, SEASON_RELATIONS_QUERY, { id: numericId });
    const edges = result?.data?.Media?.relations?.edges ?? [];
    const prequel = edges.find(e => e.relationType === 'PREQUEL');
    if (prequel) return `${type}:${prequel.node.id}`;
  } catch {
    // Best-effort.
  }
  return null;
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
