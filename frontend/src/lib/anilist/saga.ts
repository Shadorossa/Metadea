import { API_ENDPOINTS } from '../api/endpoints';
import { graphqlPost } from '../api/client';
import { resolveAniListType } from '../media/anilist-mapper';

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

interface SagaNodeResponse {
  Media: SagaNode | null;
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
        if (seen.has(nextId)) continue;
        seen.add(nextId);
        queue.push(nextId);
      }
    }
  }

  return Array.from(visited.values()).sort((a, b) => {
    const ay = a.year ?? 9999, by = b.year ?? 9999;
    if (ay !== by) return ay - by;
    const am = a.month ?? 12, bm = b.month ?? 12;
    if (am !== bm) return am - bm;
    return (a.day ?? 31) - (b.day ?? 31);
  });
}
