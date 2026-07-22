// Comic Vine issues ('Issues' tab), split out of mediaService.ts.
import { fetchComicVineIssues, fetchComicVineVolumeCast } from '../search/providers/comicvine';
import { comicVineSearch, type ComicVineIssue, type ComicVineSearchPage } from '../tauri';
import { unifyGenres } from './genre-unifier';
import type { MediaPageData, MediaCharacter } from './types';

// Maps to MediaRelation shape; only issues with a cover are included.
// Not clickable for manga (ComicVine issues shown just as visual context
// there, not real navigable entries) — comics keep their normal link.
function issuesToRelations(issues: ComicVineIssue[], label: string, clickable: boolean): MediaPageData['relations'] {
  const result: MediaPageData['relations'] = [];
  for (const issue of issues) {
    const cover = issue.image?.medium_url ?? issue.image?.small_url ?? undefined;
    if (!cover) continue;
    const numberPart = issue.issue_number ? `#${issue.issue_number}` : '';
    const namePart = issue.name ? ` — ${issue.name}` : '';
    const title = (numberPart + namePart) || `#${issue.id}`;
    if (!clickable) {
      result.push({ typeLabel: label, relationType: 'ISSUE', title, cover });
      continue;
    }
    const relatedExternalId = `comic:issue-${issue.id}`;
    result.push({ typeLabel: label, relationType: 'ISSUE', title, cover, url: `/media?id=${relatedExternalId}`, relatedExternalId });
  }
  return result;
}

export interface ComicIssuesResult {
  relations: MediaPageData['relations'] | null;
  characters: MediaCharacter[];
  genreDots?: string;
  genreTagDots?: string;
}

// volumeId from rawId directly, or (non-comic types) by searching Comic
// Vine for a volume matching titleMain/altTitle.
async function resolveVolumeId(rawId: string, isComic: boolean, titleMain?: string, altTitle?: string): Promise<number | null> {
  if (isComic) {
    const idStr = rawId.slice(rawId.indexOf(':') + 1);
    const parsed = parseInt(idStr, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (!titleMain) return null;
  const searchRes = await comicVineSearch(titleMain).catch(() => null);

  const pickBestVolume = (vols?: ComicVineSearchPage['volumes']) => {
    if (!vols || vols.length === 0) return null;
    const lowerTitle = titleMain.toLowerCase().trim();
    const exact = vols.find(v => v.name.toLowerCase().trim() === lowerTitle);
    if (exact) return exact;
    const contains = vols.find(v => v.name.toLowerCase().includes(lowerTitle) || lowerTitle.includes(v.name.toLowerCase()));
    if (contains) return contains;
    const sorted = [...vols].sort((a, b) => (b.count_of_issues ?? 0) - (a.count_of_issues ?? 0));
    return sorted[0];
  };

  let matchedVol = pickBestVolume(searchRes?.volumes);
  if (!matchedVol && altTitle && altTitle !== titleMain) {
    const searchAltRes = await comicVineSearch(altTitle).catch(() => null);
    matchedVol = pickBestVolume(searchAltRes?.volumes);
  }
  return matchedVol?.id ?? null;
}

// All issues for a comic volume plus the full cast/genres aggregated across
// them — the volume's own character_credits is usually just a first-issue
// sample. Runs once per comic; results get persisted.
export async function fetchComicIssues(
  rawId: string,
  currentRelations: MediaPageData['relations'],
  issuesLabel: string,
  titleMain?: string,
  altTitle?: string,
): Promise<ComicIssuesResult> {
  const isComic = rawId.startsWith('comic:');
  const isManga = rawId.startsWith('manga:');
  const volumeId = await resolveVolumeId(rawId, isComic, titleMain, altTitle);
  if (!volumeId) return { relations: null, characters: [] };

  const issues = await fetchComicVineIssues(volumeId).catch(() => []);
  if (!issues.length) return { relations: null, characters: [] };

  const cast = isComic ? await fetchComicVineVolumeCast(issues.map(i => i.id)) : { characters: [], concepts: [] };
  const characters: MediaCharacter[] = cast.characters.map(c => ({
    id: `character:comicvine:${c.id}`,
    name: c.name,
    image: c.image?.medium_url ?? c.image?.small_url ?? undefined,
  }));
  const { core, tags } = unifyGenres(cast.concepts.map(c => c.name));
  const genreDots = isComic ? (core.join(' · ') || undefined) : undefined;
  const genreTagDots = isComic ? (tags.join(' · ') || undefined) : undefined;

  const issueRelations = issuesToRelations(issues, issuesLabel, !isManga);
  if (!issueRelations.length) return { relations: null, characters, genreDots, genreTagDots };
  const withoutOld = (Array.isArray(currentRelations) ? currentRelations : []).filter(r => r.relationType !== 'ISSUE');
  return { relations: [...withoutOld, ...issueRelations], characters, genreDots, genreTagDots };
}
