// Skip segments (opening / ending / recap / preview) of the episode that is
// playing, and the pure decisions around them: which chapter titles count,
// how AniSkip's results merge with chapters, when the "Skip" button is
// active and when auto-skip fires. No React, no Tauri — everything here is
// unit-tested with plain numbers.

import type { PlayerChapter } from './player-status';
import type { AniskipSegment } from '../tauri/aniskip';

export type SkipSegmentKind = 'opening' | 'ending' | 'recap' | 'preview';
export type SkipSegmentSource = 'chapters' | 'aniskip';

export interface SkipSegment {
  kind: SkipSegmentKind;
  source: SkipSegmentSource;
  startSecs: number;
  endSecs: number;
}

// A segment shorter than this is noise (a mistitled chapter, a 0-length
// AniSkip vote) and never produces a button.
export const MIN_SEGMENT_SECS = 3;
// The button hides this long before the segment's end: skipping the last
// second of an opening is pointless and the seek would land on the same
// frame the user is about to see anyway.
export const ACTIVE_END_MARGIN_SECS = 1;
// Hysteresis around a segment's bounds: once active, the segment stays
// active while the position is within this margin outside it, so a status
// tick that lands a few hundred milliseconds early or late does not blink
// the button off and on at the boundary.
export const ACTIVE_HYSTERESIS_SECS = 0.75;
// Auto-skip only fires when the position enters the segment near its start
// — a user who seeks into the middle of an opening on purpose keeps it.
export const AUTO_SKIP_ENTRY_WINDOW_SECS = 2;

// Chapter titles that mark a segment, matched case-insensitively against
// the whole trimmed title or a leading word. Order matters: `NCOP` must be
// tested before the generic `OP` prefix would be.
const CHAPTER_TITLE_RULES: Array<{ kind: SkipSegmentKind; pattern: RegExp }> = [
  { kind: 'opening', pattern: /^(?:nc)?op(?:ening)?(?:\s*\d+)?(?:\s*[:\-–(].*)?$/i },
  { kind: 'opening', pattern: /^(?:オープニング|オープニングテーマ|主題歌)/ },
  { kind: 'opening', pattern: /^(?:intro|theme song|opening theme|op theme)\b/i },
  { kind: 'ending', pattern: /^(?:nc)?(?:ed|ending)(?:\s*\d+)?(?:\s*[:\-–(].*)?$/i },
  { kind: 'ending', pattern: /^(?:エンディング|エンディングテーマ)/ },
  { kind: 'ending', pattern: /^(?:outro|ending theme|ed theme|end credits|credits)\b/i },
  { kind: 'recap', pattern: /^(?:recap|previously)\b/i },
  { kind: 'recap', pattern: /^(?:前回|あらすじ)/ },
  { kind: 'preview', pattern: /^(?:preview|next episode|next time)\b/i },
  { kind: 'preview', pattern: /^(?:次回|予告)/ },
];

export function classifyChapterTitle(title: string | null | undefined): SkipSegmentKind | null {
  const trimmed = (title ?? '').trim();
  if (!trimmed) return null;
  for (const rule of CHAPTER_TITLE_RULES) {
    if (rule.pattern.test(trimmed)) return rule.kind;
  }
  return null;
}

// A chapter's segment runs from its start to the next chapter's start (or
// the file's end for the last one). Chapters without a recognised title
// still bound the previous one.
export function segmentsFromChapters(chapters: PlayerChapter[], durationSecs: number): SkipSegment[] {
  const sorted = [...chapters].sort((a, b) => a.time_secs - b.time_secs);
  const segments: SkipSegment[] = [];
  sorted.forEach((chapter, index) => {
    const kind = classifyChapterTitle(chapter.title);
    if (!kind) return;
    const next = sorted[index + 1];
    const endSecs = next ? next.time_secs : durationSecs > chapter.time_secs ? durationSecs : NaN;
    if (!Number.isFinite(endSecs)) return;
    const segment = { kind, source: 'chapters' as const, startSecs: Math.max(0, chapter.time_secs), endSecs };
    if (isUsableSegment(segment)) segments.push(segment);
  });
  return segments;
}

const ANISKIP_KIND: Record<string, SkipSegmentKind> = {
  'op': 'opening', 'mixed-op': 'opening', 'ed': 'ending', 'mixed-ed': 'ending', 'recap': 'recap',
};

export function segmentsFromAniskip(results: AniskipSegment[]): SkipSegment[] {
  return results.flatMap(result => {
    const kind = ANISKIP_KIND[result.skip_type];
    if (!kind) return [];
    const segment = { kind, source: 'aniskip' as const, startSecs: Math.max(0, result.start_secs), endSecs: result.end_secs };
    return isUsableSegment(segment) ? [segment] : [];
  });
}

export function isUsableSegment(segment: Pick<SkipSegment, 'startSecs' | 'endSecs'>): boolean {
  return Number.isFinite(segment.startSecs) && Number.isFinite(segment.endSecs)
    && segment.endSecs - segment.startSecs >= MIN_SEGMENT_SECS;
}

export function segmentsOverlap(a: Pick<SkipSegment, 'startSecs' | 'endSecs'>, b: Pick<SkipSegment, 'startSecs' | 'endSecs'>): boolean {
  return a.startSecs < b.endSecs && b.startSecs < a.endSecs;
}

// Chapters win: they come from the file itself, so an AniSkip interval that
// overlaps any chapter-derived segment is dropped. The result is sorted by
// start time.
export function mergeSegments(primary: SkipSegment[], secondary: SkipSegment[]): SkipSegment[] {
  const kept = secondary.filter(candidate => !primary.some(existing => segmentsOverlap(existing, candidate)));
  return [...primary, ...kept].sort((a, b) => a.startSecs - b.startSecs);
}

export function segmentKey(segment: SkipSegment): string {
  return `${segment.source}:${segment.kind}:${segment.startSecs.toFixed(1)}`;
}

// The segment the "Skip" button should offer at `positionSecs`, given the
// one offered a tick ago (for the hysteresis). Entering needs the position
// strictly inside [start, end - margin); leaving happens only once the
// position is clearly outside.
export function resolveActiveSegment(segments: SkipSegment[], positionSecs: number, previous: SkipSegment | null): SkipSegment | null {
  if (previous && segments.some(segment => segmentKey(segment) === segmentKey(previous))) {
    const stillInside = positionSecs >= previous.startSecs - ACTIVE_HYSTERESIS_SECS
      && positionSecs < previous.endSecs - ACTIVE_END_MARGIN_SECS + ACTIVE_HYSTERESIS_SECS;
    if (stillInside) return previous;
  }
  return segments.find(segment =>
    positionSecs >= segment.startSecs && positionSecs < segment.endSecs - ACTIVE_END_MARGIN_SECS,
  ) ?? null;
}

// Once-per-segment auto-skip: the first tick that lands inside the entry
// window of a segment not yet handled asks for a skip; every later tick for
// that segment (including after an Undo) is ignored until `reset()`.
export interface AutoSkipTracker {
  // Returns the segment to skip now, or null.
  next(segments: SkipSegment[], positionSecs: number): SkipSegment | null;
  // Marks a segment as handled without skipping (Undo keeps it that way).
  markHandled(segment: SkipSegment): void;
  reset(): void;
}

export function createAutoSkipTracker(): AutoSkipTracker {
  const handled = new Set<string>();
  return {
    next(segments, positionSecs) {
      for (const segment of segments) {
        const key = segmentKey(segment);
        if (handled.has(key)) continue;
        const insideEntryWindow = positionSecs >= segment.startSecs
          && positionSecs < Math.min(segment.startSecs + AUTO_SKIP_ENTRY_WINDOW_SECS, segment.endSecs - ACTIVE_END_MARGIN_SECS);
        if (insideEntryWindow) {
          handled.add(key);
          return segment;
        }
      }
      return null;
    },
    markHandled(segment) {
      handled.add(segmentKey(segment));
    },
    reset() {
      handled.clear();
    },
  };
}

// AniList catalog ids are `anime:<id>`; anything else has no MAL mapping.
export function anilistIdFromExternalId(externalId: string | null | undefined): number | null {
  const match = (externalId ?? '').match(/^anime:(\d+)$/);
  return match ? Number(match[1]) : null;
}
