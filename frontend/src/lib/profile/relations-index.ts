import type { DbMediaRelation } from '../tauri';

// media_external_id -> that media's own relation rows (rows without an
// owning id, i.e. not from get_all_media_relations, are skipped). Built once
// per grouping pass so per-member lookups are O(1) instead of a full scan of
// the ~7.6k-row catalog-wide list for every owned work.
export function indexRelationsByMedia(relations: readonly DbMediaRelation[]): Map<string, DbMediaRelation[]> {
  const byMedia = new Map<string, DbMediaRelation[]>();
  for (const relation of relations) {
    const owner = relation.media_external_id;
    if (!owner) continue;
    const list = byMedia.get(owner);
    if (list) list.push(relation);
    else byMedia.set(owner, [relation]);
  }
  return byMedia;
}
