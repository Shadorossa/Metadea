// Comic Vine issues ('Issues' tab), split out of mediaService.ts.
import { fetchComicVineIssues, fetchComicVineVolume, fetchComicVineVolumeCast } from '../search/providers/comicvine';
import { comicVineSearch, type ComicVineIssue, type ComicVineSearchPage } from '../tauri';
import { getCatalogEntry } from '../tauri/catalog';
import { unifyGenres } from './genre-unifier';
import type { MediaPageData, MediaCharacter } from './types';

// Maps to MediaRelation shape; only issues with a cover are included. The id
// carries the parent work's own base type (manga:issue-, lnovel:issue-,
// comic:issue-) so a manga's chapters stay classified as manga even though
// the actual data always comes from ComicVine — see fetchMediaDataInternal's
// generic "issue-" routing in mediaService.ts.
function issuesToRelations(issues: ComicVineIssue[], label: string, baseType: string): MediaPageData['relations'] {
  const result: MediaPageData['relations'] = [];
  for (const issue of issues) {
    const cover = issue.image?.medium_url ?? issue.image?.small_url ?? undefined;
    if (!cover) continue;
    const numberPart = issue.issue_number ? `#${issue.issue_number}` : '';
    const namePart = issue.name ? ` — ${issue.name}` : '';
    const title = (numberPart + namePart) || `#${issue.id}`;
    const relatedExternalId = `${baseType}:issue-${issue.id}`;
    result.push({ typeLabel: label, relationType: 'ISSUE', title, cover, relatedExternalId });
  }
  return result;
}

export interface ComicIssuesResult {
  relations: MediaPageData['relations'] | null;
  characters: MediaCharacter[];
  genreDots?: string;
  genreTagDots?: string;
  sourceStatus?: 'matched' | 'no-match' | 'unavailable';
}

interface VolumeResolution {
  id: number | null;
  status: 'matched' | 'no-match' | 'unavailable';
}

function normalizeComicVolumeTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Comic Vine commonly uses Hepburn macrons (Hōseki), while AniList
    // titles often spell the same long vowel as "ou" (Houseki).
    .replace(/ou/g, 'o')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function volumeTitleMatchScore(queryTitle: string, volumeTitle: string): number {
  const query = normalizeComicVolumeTitle(queryTitle);
  const candidate = normalizeComicVolumeTitle(volumeTitle);
  if (!query || !candidate) return 0;
  if (query === candidate) return 3;
  if (candidate.includes(query)) return 2;

  const queryTokens = [...new Set(query.split(' '))];
  const candidateTokens = new Set(candidate.split(' '));
  return queryTokens.every(token => candidateTokens.has(token)) ? 1 : 0;
}

// volumeId from rawId directly, or (non-comic types) by searching Comic
// Vine for a volume matching titleMain/altTitle.
async function resolveVolumeId(rawId: string, isComic: boolean, titleMain?: string, altTitle?: string, forcedVolumeId?: string | null, preferredIssueCount?: number): Promise<VolumeResolution> {
  const forcedId = Number(forcedVolumeId);
  if (forcedVolumeId && Number.isInteger(forcedId) && forcedId > 0) {
    if (preferredIssueCount && preferredIssueCount > 0) {
      const selectedVolume = await fetchComicVineVolume(forcedId).catch(() => null);
      if (!selectedVolume) return { id: null, status: 'unavailable' };
      // issue_source_id is an explicit curator mapping. Trust its title even
      // when Comic Vine uses a different localized/official name; only reject
      // it when a known total_count_2 proves its issue count is incompatible.
      if (selectedVolume.count_of_issues === preferredIssueCount) {
        return { id: forcedId, status: 'matched' };
      }
    } else {
      return { id: forcedId, status: 'matched' };
    }
  }

  if (isComic) {
    const idStr = rawId.slice(rawId.indexOf(':') + 1);
    const parsed = parseInt(idStr, 10);
    return Number.isFinite(parsed)
      ? { id: parsed, status: 'matched' }
      : { id: null, status: 'no-match' };
  }

  if (!titleMain) return { id: null, status: 'no-match' };
  const searchRes = await comicVineSearch(titleMain).catch(() => null);

  const pickBestVolume = (vols?: ComicVineSearchPage['volumes']) => {
    if (!vols || vols.length === 0) return null;
    // For manga, total_count_2 is the number of collected volumes. Never
    // guess with a nearby count: only a ComicVine result with that exact
    // count can be used as the issue source.
    const countMatched = preferredIssueCount && preferredIssueCount > 0
      ? vols.filter(v => v.count_of_issues === preferredIssueCount)
      : vols;
    if (!countMatched.length) return null;
    // Count alone cannot identify a manga: unrelated series and collected
    // editions can have the same number of issues. Prefer a real title match
    // (including Japanese long-vowel spelling variants) and refuse to guess
    // when Comic Vine only returns similarly-sized but unrelated volumes.
    const ranked = countMatched
      .map(volume => ({ volume, score: volumeTitleMatchScore(titleMain, volume.name) }))
      .filter(candidate => candidate.score > 0)
      .sort((a, b) => b.score - a.score);
    return ranked[0]?.volume ?? null;
  };

  if (!searchRes) return { id: null, status: 'unavailable' };
  let matchedVol = pickBestVolume(searchRes.volumes);
  if (!matchedVol && altTitle && altTitle !== titleMain) {
    const searchAltRes = await comicVineSearch(altTitle).catch(() => null);
    if (!searchAltRes) return { id: null, status: 'unavailable' };
    matchedVol = pickBestVolume(searchAltRes.volumes);
  }
  return matchedVol
    ? { id: matchedVol.id, status: 'matched' }
    : { id: null, status: 'no-match' };
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
  const baseType = rawId.slice(0, rawId.indexOf(':'));
  const catalogEntry = await getCatalogEntry(rawId).catch(() => null);
  const preferredIssueCount = catalogEntry?.type === 'manga' ? catalogEntry.total_count_2 ?? undefined : undefined;
  const withoutOldIssues = (Array.isArray(currentRelations) ? currentRelations : []).filter(r => r.relationType !== 'ISSUE');
  const resolution = await resolveVolumeId(rawId, isComic, titleMain, altTitle, catalogEntry?.issue_source_id, preferredIssueCount);
  if (!resolution.id) {
    return {
      relations: resolution.status === 'unavailable' ? null : withoutOldIssues,
      characters: [],
      sourceStatus: resolution.status,
    };
  }

  const issues = await fetchComicVineIssues(resolution.id).catch(() => []);
  if (!issues.length) return { relations: null, characters: [], sourceStatus: 'unavailable' };

  const cast = isComic ? await fetchComicVineVolumeCast(issues.map(i => i.id)) : { characters: [], concepts: [] };
  const characters: MediaCharacter[] = cast.characters.map(c => ({
    id: `character:co:${c.id}`,
    name: c.name,
    image: c.image?.medium_url ?? c.image?.small_url ?? undefined,
  }));
  const { core, tags } = unifyGenres(cast.concepts.map(c => c.name));
  const genreDots = isComic ? (core.join(' · ') || undefined) : undefined;
  const genreTagDots = isComic ? (tags.join(' · ') || undefined) : undefined;

  // A manga's `total_count_2` is its volume count. When ComicVine exposes a
  // larger chapter/issue run for the same title, only map the corresponding
  // number of volumes instead of showing unrelated excess issue cards.
  const mappedIssues = preferredIssueCount && preferredIssueCount > 0
    ? issues.slice(0, preferredIssueCount)
    : issues;
  const issueRelations = issuesToRelations(mappedIssues, issuesLabel, baseType);
  return {
    relations: [...withoutOldIssues, ...issueRelations],
    characters,
    genreDots,
    genreTagDots,
    sourceStatus: 'matched',
  };
}
