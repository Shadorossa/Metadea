// Cast of a work the user picked as a merge source: local cache first, live
// fetch as fallback, then filtered down to characters that can still be
// merged into the edited character (not itself, not already merged, not already
// merged elsewhere).
import { getCharacterMergeTarget, getMediaCharacters } from '../tauri/characters';
import { fetchMediaDataInternal } from '../media/media-page-data';
import type { SearchResult as ApiSearchResult } from '../search';

export interface MergeCandidate {
  external_id: string;
  name: string;
  image_url?: string | null;
}

export async function loadMergeCandidates(result: ApiSearchResult, currentId: string, alreadyMergedIds: Iterable<string>): Promise<MergeCandidate[]> {
  const cached = await getMediaCharacters(result.externalId).catch(() => []);
  let candidates: MergeCandidate[] = cached.map(item => ({
    external_id: item.external_id,
    name: item.name,
    image_url: item.image_url,
  }));
  if (!candidates.length) {
    const live = await fetchMediaDataInternal(result.externalId);
    candidates = (live?.characters ?? []).map(item => ({
      external_id: item.id || `character:${item.name}`,
      name: item.name,
      image_url: item.image,
    }));
  }
  const seen = new Set<string>();
  const alreadyAdded = new Set(alreadyMergedIds);
  const unique = candidates.filter(item => {
    if (!item.external_id || item.external_id === currentId || alreadyAdded.has(item.external_id) || seen.has(item.external_id)) return false;
    seen.add(item.external_id);
    return true;
  });
  const eligible: MergeCandidate[] = [];
  for (const item of unique) {
    const target = await getCharacterMergeTarget(item.external_id).catch(() => null);
    if (!target || target === currentId) eligible.push(item);
  }
  return eligible;
}
