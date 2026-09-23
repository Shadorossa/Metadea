import { API_ENDPOINTS } from '../api/endpoints';
import { graphqlPost } from '../api/client';
import { resolveAniListType } from '../media/mappers/anilist-mapper';
import { topoSortByPrecedes } from '../media/saga/saga-grouping';

export interface SagaEntry {
  externalId: string;
  title: string;
  cover: string | null;
  format: string | null;
  mediaType: string; // 'anime' | 'manga' | 'lnovel'
  year: number | null;
  month: number | null;
  day: number | null;
}

interface SagaNode {
  id: number;
  type: string;
  format: string | null;
  title: { romaji: string | null; english: string | null; native: string | null };
  coverImage: { large: string | null } | null;
  startDate: { year: number | null; month: number | null; day: number | null } | null;
  relations: { edges: Array<{ relationType: string; node: { id: number } }> };
}

// Deliberately light — only the fields needed to keep walking (relations)
// plus what a saga-list card displays. The full detail query (search/
// providers/anilist.ts) pulls much more (characters, studios, ...) that
// would be wasted on every hop of the walk below.
interface SagaPageResponse {
  Page: {
    media: SagaNode[];
  } | null;
}

const SAGA_BATCH_QUERY = `
  query SagaNodes($ids: [Int]!) {
    Page(page: 1, perPage: 50) {
      media(id_in: $ids) {
        id
        type
        format
        title { romaji english native }
        coverImage { large }
        startDate { year month day }
        relations {
          edges {
            relationType
            node { id }
          }
        }
      }
    }
  }
`;

// AniList only exposes direct PREQUEL/SEQUEL edges per media (one hop each
// way) — there's no "give me the whole franchise" query. To build the full
// timeline we walk outward from the starting entry in both directions
// breadth-first, querying newly-discovered IDs in batches to minimize request count,
// until the chain stops producing new nodes. Sequels-of-sequels, prequels-of-prequels,
// etc. all get picked up this way even though AniList never lists them
// directly on the entry the user started from.
const SAGA_RELATION_TYPES = new Set(['PREQUEL', 'SEQUEL']);

export async function fetchAniListSaga(startId: number): Promise<SagaEntry[]> {
  const visited = new Map<number, SagaEntry>();
  const seen = new Set<number>([startId]);
  const queue: number[] = [startId];
  // Raw numeric-id SEQUEL edges (ownerId -> targetId) collected during the
  // walk — kept as bare AniList ids rather than externalIds because an
  // edge's own node{id} arrives before we know that node's resolved
  // mediaType prefix (that only comes from fetching it as its own top-level
  // `media` entry, later in the same or a following batch).
  const sequelEdges: Array<[number, number]> = [];

  while (queue.length > 0) {
    // Process queue in batches of up to 50 to minimize requests
    const batch = queue.splice(0, 50);
    const { ok, result } = await graphqlPost<SagaPageResponse>(API_ENDPOINTS.ANILIST, SAGA_BATCH_QUERY, { ids: batch });
    if (!ok) continue;

    const mediaList = result?.data?.Page?.media;
    if (!mediaList) continue;

    for (const media of mediaList) {
      if (!media) continue;
      const mediaType = resolveAniListType(media.type.toLowerCase(), media.format);
      visited.set(media.id, {
        externalId: `${mediaType}:${media.id}`,
        title: media.title.romaji ?? media.title.english ?? media.title.native ?? '',
        cover: media.coverImage?.large ?? null,
        format: media.format,
        mediaType,
        year: media.startDate?.year ?? null,
        month: media.startDate?.month ?? null,
        day: media.startDate?.day ?? null,
      });

      for (const edge of media.relations?.edges ?? []) {
        if (!SAGA_RELATION_TYPES.has(edge.relationType)) continue;
        const nextId = edge.node.id;
        if (edge.relationType === 'SEQUEL') sequelEdges.push([media.id, nextId]);
        if (seen.has(nextId)) continue;
        seen.add(nextId);
        queue.push(nextId);
      }
    }
  }

  const entries = Array.from(visited.values());
  // Release date is only the FALLBACK/tiebreak order now, not the final
  // one — AniList's own release dates can disagree with its own SEQUEL
  // edges (e.g. Gintama: The Semi-Final released 6 days after The Final, but
  // is still recorded as The Final's PREQUEL), which used to leave a
  // same-franchise chain visibly out of order. The SEQUEL edges collected
  // above are the actual source of truth, same as reconstructFromRelations
  // already treats the local media_relations table.
  const dateOrderedIds = [...entries]
    .sort((a, b) => {
      const ay = a.year ?? 9999, by = b.year ?? 9999;
      if (ay !== by) return ay - by;
      const am = a.month ?? 12, bm = b.month ?? 12;
      if (am !== bm) return am - bm;
      return (a.day ?? 31) - (b.day ?? 31);
    })
    .map(e => e.externalId);

  const precedes = new Map<string, Set<string>>();
  for (const [ownerId, targetId] of sequelEdges) {
    const owner = visited.get(ownerId);
    const target = visited.get(targetId);
    if (!owner || !target) continue; // target fell outside the visited set — shouldn't happen, but defensive
    if (!precedes.has(owner.externalId)) precedes.set(owner.externalId, new Set());
    precedes.get(owner.externalId)!.add(target.externalId);
  }

  const dateIndex = new Map(dateOrderedIds.map((id, i) => [id, i]));
  const orderedIds = topoSortByPrecedes(dateOrderedIds, precedes, (a, b) => dateIndex.get(a)! - dateIndex.get(b)!);

  const byId = new Map(entries.map(e => [e.externalId, e]));
  return orderedIds.map(id => byId.get(id)!);
}
