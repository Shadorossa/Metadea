import { getMediaRelationsForEditor, getCatalogEntry } from '../../../lib/tauri';
import { useAsyncResource } from '../../shared/hooks/useAsyncResource';
import type { LocalMediaItem } from './useLocalMediaEntries';

// A comic tracked against the numbered-issues run (total_count > 1, since
// that's what search actually surfaces — see comicvine.ts's collected-
// edition filter) can still be sitting on disk as a single collected-
// edition CBR/CBZ, not one file per issue. No local flag says so directly
// — the only signal available is whether an "Editions" relation (see
// comic-collected-editions.ts) points at a collection with exactly 1
// issue of its own, which is as close to "this whole run also exists as
// one tomo" as the data gets.
//
// TODO(audit 6.3): an IPC failure on either lookup is swallowed into `[]` /
// `null` and so reads as `false` — indistinguishable from a genuine "no
// single-tomo edition". Kept as-is (behaviour freeze): the panel renders
// this straight into isSingleEpisode, so a tri-state here would change
// what's on screen.
export function useEditionProbe(item: LocalMediaItem): boolean {
  const { value, loading } = useAsyncResource<boolean>(async signal => {
    if (item.libraryEntry.type !== 'comic') return false;
    const relations = await getMediaRelationsForEditor(item.externalId).catch(() => []);
    const editions = relations.filter(r => r.relation_type === 'EDITIONS');
    for (const rel of editions) {
      if (signal.aborted) return false;
      const entry = await getCatalogEntry(rel.related_media_external_id).catch(() => null);
      if (entry?.total_count === 1) return true;
    }
    return false;
  }, [item.externalId, item.libraryEntry.type], false);
  // Reset to false the moment the item changes, exactly like the old
  // "setHasSingleTomoEdition(false) then probe" effect did.
  return !loading && value;
}
