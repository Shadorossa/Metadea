// "Unify seasons" (Settings › Preferences) for the taste comparison's cover
// lists: a later AniList season collapses to its chain's base entry (the
// first season), so one anime shows once instead of once per season.
import type { CatalogSummary, DbMediaRelation } from '../tauri/catalog';
import type { TasteCompatibility, } from './taste-compatibility';
import type { TasteRatingPair } from '../tauri/social-profile';
import { createUnionFind } from '../shared/collections/union-find';

const PREQUEL = new Set(['PREQUEL', 'PRECUELA']);
const SEQUEL = new Set(['SEQUEL', 'SECUELA']);
const isAnimeId = (id: string) => id.startsWith('anime:');

/** Maps every anime in a sequel/prequel chain to the chain's base entry:
 *  the member nothing is a prequel of, earliest release first. Ids outside
 *  any chain map to themselves. */
export function animeSeasonBaseResolver(
  relations: readonly DbMediaRelation[],
  catalogMap: ReadonlyMap<string, Pick<CatalogSummary, 'release_year'>>,
): (id: string) => string {
  const graph = createUnionFind<string>();
  const hasPrequel = new Set<string>();
  for (const rel of relations) {
    const a = rel.media_external_id, b = rel.related_media_external_id;
    if (!a || !b || !isAnimeId(a) || !isAnimeId(b)) continue;
    const type = rel.relation_type.toUpperCase();
    if (PREQUEL.has(type)) hasPrequel.add(a);
    else if (SEQUEL.has(type)) hasPrequel.add(b);
    else continue;
    graph.union(a, b);
  }
  const members = new Map<string, string[]>();
  for (const rel of relations) {
    for (const id of [rel.media_external_id, rel.related_media_external_id]) {
      if (!id || !graph.has(id)) continue;
      const root = graph.find(id);
      const list = members.get(root) ?? [];
      if (!list.includes(id)) list.push(id);
      members.set(root, list);
    }
  }
  const year = (id: string) => catalogMap.get(id)?.release_year ?? Number.MAX_SAFE_INTEGER;
  const numeric = (id: string) => Number(id.split(':')[1]) || Number.MAX_SAFE_INTEGER;
  const baseOf = new Map<string, string>();
  for (const [root, list] of members) {
    const roots = list.filter(id => !hasPrequel.has(id));
    const pool = roots.length > 0 ? roots : list;
    const base = [...pool].sort((x, y) => year(x) - year(y) || numeric(x) - numeric(y))[0];
    baseOf.set(root, base);
  }
  return id => (graph.has(id) ? baseOf.get(graph.find(id)) ?? id : id);
}

/** One entry per chain, shown as the base when the app can draw it (it has
 *  a catalog row), else as the first season present. Order is kept. */
export function collapseSeasons<T>(
  items: readonly T[],
  idOf: (item: T) => string,
  withId: (item: T, id: string) => T,
  baseOf: (id: string) => string,
  canShow: (id: string) => boolean,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const id = idOf(item);
    const base = baseOf(id);
    if (seen.has(base)) continue;
    seen.add(base);
    out.push(base !== id && canShow(base) ? withId(item, base) : item);
  }
  return out;
}

export function unifyTasteSeasons(
  taste: TasteCompatibility,
  relations: readonly DbMediaRelation[],
  catalogMap: ReadonlyMap<string, Pick<CatalogSummary, 'release_year'>>,
): TasteCompatibility {
  const baseOf = animeSeasonBaseResolver(relations, catalogMap);
  const canShow = (id: string) => catalogMap.has(id);
  const pairs = (list: TasteRatingPair[]) =>
    collapseSeasons(list, p => p.external_id, (p, id) => ({ ...p, external_id: id }), baseOf, canShow);
  return {
    ...taste,
    sharedFavorites: collapseSeasons(taste.sharedFavorites, id => id, (_, id) => id, baseOf, canShow),
    bothLoved: pairs(taste.bothLoved),
    disagreements: pairs(taste.disagreements),
  };
}
