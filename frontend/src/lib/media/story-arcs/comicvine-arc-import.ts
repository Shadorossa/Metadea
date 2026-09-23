// Comic Vine story arcs → Metadea story-arc proposals for one work. A
// manga's arcs become chapter ranges (parsed from each tankōbon's
// description, see comicvine-chapters.ts); a comic's become issue ranges.
// When a volume lists no chapters, its chapters are estimated from the
// neighbouring volumes that do (flagged), else the arc keeps only its volume
// range (flagged for review: a story-arc item has no unit field, so it is
// imported without a range unless the curator types one).
import type { ComicVineIssueSummary, ComicVineStoryArc, ComicVineVolumeArcs } from '../../tauri/comicvine';
import type { StoryArc } from '../../tauri/story-arcs';
import { htmlToLines, parseChapterNumbers, parseIssueNumber } from './comicvine-chapters';

export type ArcImportUnit = 'chapters' | 'issues';
export type Range = [number, number];

export interface ArcIssueChapters {
  issueId: number;
  /** The issue (tankōbon volume / comic issue) number. */
  number: number | null;
  chapters: number[];
  chapterSource: 'listed' | 'estimated' | 'none';
}

export interface ComicVineArcCandidate {
  id: number;
  name: string;
  description: string;
  image: string | null;
  issues: ArcIssueChapters[];
  chapterSegments: Range[];
  chapterRange: Range | null;
  volumeSegments: Range[];
  volumeRange: Range | null;
  /** Volumes whose chapters were estimated from neighbouring volumes. */
  estimatedVolumes: number[];
  /** Volumes with no chapter data at all. */
  unresolvedVolumes: number[];
  /** Ids of other candidates whose range overlaps this one's. */
  overlapsWith: number[];
}

const DESCRIPTION_MAX = 240;

/** Maximal runs of consecutive numbers (a gap of at most 1, so "187, 187.5,
 *  188" is one run). */
export function mergeContiguous(numbers: number[]): Range[] {
  const sorted = [...new Set(numbers.filter(Number.isFinite))].sort((a, b) => a - b);
  const segments: Range[] = [];
  for (const n of sorted) {
    const last = segments[segments.length - 1];
    if (last && n - last[1] <= 1) last[1] = n;
    else segments.push([n, n]);
  }
  return segments;
}

export function spanOf(segments: Range[]): Range | null {
  return segments.length ? [segments[0][0], segments[segments.length - 1][1]] : null;
}

export const rangesOverlap = (a: Range, b: Range): boolean => a[0] <= b[1] && b[0] <= a[1];

/** Short plain-text summary: the deck, else the description's first lines. */
export function summarizeArcDescription(arc: Pick<ComicVineStoryArc, 'deck' | 'description'>): string {
  const text = arc.deck?.trim() || htmlToLines(arc.description).join(' ');
  if (text.length <= DESCRIPTION_MAX) return text;
  const cut = text.slice(0, DESCRIPTION_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > DESCRIPTION_MAX / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Chapters per volume number, for every issue whose description lists them. */
export function buildVolumeChapterIndex(issues: ComicVineIssueSummary[]): Map<number, number[]> {
  const index = new Map<number, number[]>();
  for (const issue of issues) {
    const number = parseIssueNumber(issue.issue_number);
    if (number == null) continue;
    const chapters = parseChapterNumbers(issue.description);
    if (chapters.length) index.set(number, chapters);
  }
  return index;
}

/** A volume's chapters spread evenly over the gap between the nearest
 *  earlier and later volumes that list theirs; null without both. */
export function estimateVolumeChapters(volume: number, index: Map<number, number[]>): number[] | null {
  if (!Number.isInteger(volume)) return null;
  let prev: number | null = null;
  let next: number | null = null;
  for (const known of index.keys()) {
    if (known < volume && (prev == null || known > prev)) prev = known;
    if (known > volume && (next == null || known < next)) next = known;
  }
  const prevChapters = prev == null ? undefined : index.get(prev);
  const nextChapters = next == null ? undefined : index.get(next);
  if (prev == null || next == null || !prevChapters?.length || !nextChapters?.length) return null;
  const firstFree = Math.floor(prevChapters[prevChapters.length - 1]) + 1;
  const lastFree = Math.ceil(nextChapters[0]) - 1;
  const gapVolumes = next - prev - 1;
  const freeChapters = lastFree - firstFree + 1;
  if (gapVolumes < 1 || freeChapters < gapVolumes) return null;
  const perVolume = freeChapters / gapVolumes;
  const offset = volume - prev - 1;
  const start = firstFree + Math.round(offset * perVolume);
  const end = firstFree + Math.round((offset + 1) * perVolume) - 1;
  const chapters: number[] = [];
  for (let n = start; n <= end; n++) chapters.push(n);
  return chapters;
}

function arcIssueChapters(issue: ComicVineIssueSummary, unit: ArcImportUnit, index: Map<number, number[]>): ArcIssueChapters {
  const number = parseIssueNumber(issue.issue_number);
  if (unit === 'issues') return { issueId: issue.id, number, chapters: [], chapterSource: 'none' };
  const listed = parseChapterNumbers(issue.description);
  if (listed.length) return { issueId: issue.id, number, chapters: listed, chapterSource: 'listed' };
  const estimated = number != null ? estimateVolumeChapters(number, index) : null;
  return estimated
    ? { issueId: issue.id, number, chapters: estimated, chapterSource: 'estimated' }
    : { issueId: issue.id, number, chapters: [], chapterSource: 'none' };
}

// The range an overlap check or sort uses: chapters for manga when known,
// else the volume/issue range.
function comparableRange(candidate: ComicVineArcCandidate): { unit: 'chapters' | 'volumes'; range: Range } | null {
  if (candidate.chapterRange) return { unit: 'chapters', range: candidate.chapterRange };
  if (candidate.volumeRange) return { unit: 'volumes', range: candidate.volumeRange };
  return null;
}

/** Fills each candidate's `overlapsWith` (same unit only). */
export function detectOverlaps(candidates: ComicVineArcCandidate[]): ComicVineArcCandidate[] {
  return candidates.map(candidate => {
    const own = comparableRange(candidate);
    const overlapsWith = own
      ? candidates
          .filter(other => other.id !== candidate.id)
          .filter(other => {
            const theirs = comparableRange(other);
            return theirs != null && theirs.unit === own.unit && rangesOverlap(own.range, theirs.range);
          })
          .map(other => other.id)
      : [];
    return { ...candidate, overlapsWith };
  });
}

const volumeNumbers = (issues: ArcIssueChapters[], source: ArcIssueChapters['chapterSource']): number[] =>
  issues.flatMap(issue => (issue.chapterSource === source && issue.number != null ? [issue.number] : []));

function compareCandidates(a: ComicVineArcCandidate, b: ComicVineArcCandidate): number {
  if (a.chapterRange && b.chapterRange) return a.chapterRange[0] - b.chapterRange[0] || a.chapterRange[1] - b.chapterRange[1];
  const va = a.volumeRange?.[0] ?? Number.POSITIVE_INFINITY;
  const vb = b.volumeRange?.[0] ?? Number.POSITIVE_INFINITY;
  return va - vb || a.name.localeCompare(b.name);
}

/** One candidate per arc that has at least one issue in the scanned volume,
 *  sorted by first chapter (else first volume), overlaps detected. */
export function buildArcCandidates(data: ComicVineVolumeArcs, unit: ArcImportUnit): ComicVineArcCandidate[] {
  const byId = new Map(data.issues.map(issue => [issue.id, issue]));
  const index = unit === 'chapters' ? buildVolumeChapterIndex(data.issues) : new Map<number, number[]>();
  const candidates: ComicVineArcCandidate[] = [];

  for (const arc of data.arcs) {
    const inVolume = arc.issues.map(ref => byId.get(ref.id)).filter((issue): issue is ComicVineIssueSummary => issue != null);
    if (inVolume.length === 0) continue;
    const issues = inVolume
      .map(issue => arcIssueChapters(issue, unit, index))
      .sort((a, b) => (a.number ?? Number.POSITIVE_INFINITY) - (b.number ?? Number.POSITIVE_INFINITY));
    const chapterSegments = mergeContiguous(issues.flatMap(issue => issue.chapters));
    const volumeSegments = mergeContiguous(issues.map(issue => issue.number).filter((n): n is number => n != null));
    candidates.push({
      id: arc.id,
      name: arc.name?.trim() || `ComicVine ${arc.id}`,
      description: summarizeArcDescription(arc),
      image: arc.image?.medium_url || arc.image?.small_url || null,
      issues,
      chapterSegments,
      chapterRange: spanOf(chapterSegments),
      volumeSegments,
      volumeRange: spanOf(volumeSegments),
      estimatedVolumes: volumeNumbers(issues, 'estimated'),
      unresolvedVolumes: unit === 'chapters' ? volumeNumbers(issues, 'none') : [],
      overlapsWith: [],
    });
  }

  return detectOverlaps(candidates.sort(compareCandidates));
}

const normalizeArcName = (name: string) => name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(saga|arc|arco)\b/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Whether a Metadea arc with (roughly) this name already exists. */
export function arcNameExists(name: string, existingNames: string[]): boolean {
  const target = normalizeArcName(name);
  return target !== '' && existingNames.some(existing => normalizeArcName(existing) === target);
}

/** The range an arc is imported with: chapters (whole numbers) for manga,
 *  issue numbers for comics; null when unknown (volume-only manga arc). */
export function defaultImportRange(candidate: ComicVineArcCandidate, unit: ArcImportUnit): Range | null {
  const range = unit === 'chapters' ? candidate.chapterRange : candidate.volumeRange;
  return range ? [Math.floor(range[0]), Math.ceil(range[1])] : null;
}

/** Whether a candidate needs a curator's look before it is trusted. */
export function needsReview(candidate: ComicVineArcCandidate, unit: ArcImportUnit): boolean {
  if (unit === 'issues') return candidate.volumeRange == null || candidate.overlapsWith.length > 0;
  return candidate.chapterRange == null
    || candidate.estimatedVolumes.length > 0
    || candidate.unresolvedVolumes.length > 0
    || candidate.chapterSegments.length > 1
    || candidate.overlapsWith.length > 0;
}

export interface ArcImportChoice {
  candidate: Pick<ComicVineArcCandidate, 'name' | 'image'>;
  start: number | null;
  end: number | null;
  useImage: boolean;
}

/** The new StoryArc (same shape the manual editor saves) for one work. */
export function arcChoiceToStoryArc(choice: ArcImportChoice, mediaExternalId: string): StoryArc {
  const clean = (value: number | null) => (value != null && Number.isFinite(value) && value > 0 ? Math.round(value) : null);
  let start = clean(choice.start);
  let end = clean(choice.end);
  if (start != null && end != null && end < start) [start, end] = [end, start];
  return {
    id: '',
    name: choice.candidate.name.trim(),
    image_base64: choice.useImage ? choice.candidate.image : null,
    items: [{ id: '', media_external_id: mediaExternalId, ep_start: start, ep_end: end, position: 0, group_id: null }],
    sort_order: 0,
  };
}
