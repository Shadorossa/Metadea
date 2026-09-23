import { describe, it, expect } from 'vitest';
import {
  ACTIVE_END_MARGIN_SECS, ACTIVE_HYSTERESIS_SECS, anilistIdFromExternalId, classifyChapterTitle, createAutoSkipTracker,
  mergeSegments, resolveActiveSegment, segmentsFromAniskip, segmentsFromChapters, type SkipSegment,
} from './skip-segments';

const chapter = (title: string | null, time_secs: number) => ({ title, time_secs });
const seg = (kind: SkipSegment['kind'], startSecs: number, endSecs: number, source: SkipSegment['source'] = 'chapters'): SkipSegment =>
  ({ kind, source, startSecs, endSecs });

describe('classifyChapterTitle', () => {
  it('recognises English and Japanese opening/ending titles case-insensitively', () => {
    expect(classifyChapterTitle('OP')).toBe('opening');
    expect(classifyChapterTitle('Opening')).toBe('opening');
    expect(classifyChapterTitle('NCOP')).toBe('opening');
    expect(classifyChapterTitle('OP 2: Song Title')).toBe('opening');
    expect(classifyChapterTitle('オープニング')).toBe('opening');
    expect(classifyChapterTitle('ed')).toBe('ending');
    expect(classifyChapterTitle('Ending')).toBe('ending');
    expect(classifyChapterTitle('NCED')).toBe('ending');
    expect(classifyChapterTitle('エンディング')).toBe('ending');
    expect(classifyChapterTitle('Recap')).toBe('recap');
    expect(classifyChapterTitle('前回のあらすじ')).toBe('recap');
    expect(classifyChapterTitle('Preview')).toBe('preview');
    expect(classifyChapterTitle('次回予告')).toBe('preview');
  });

  it('leaves ordinary chapters alone', () => {
    expect(classifyChapterTitle('Part A')).toBeNull();
    expect(classifyChapterTitle('Operation Meteor')).toBeNull();
    expect(classifyChapterTitle('Education')).toBeNull();
    expect(classifyChapterTitle('')).toBeNull();
    expect(classifyChapterTitle(null)).toBeNull();
  });
});

describe('segmentsFromChapters', () => {
  it('runs each segment from its chapter to the next chapter start', () => {
    const chapters = [chapter('Recap', 0), chapter('Opening', 30), chapter('Part A', 120), chapter('ED', 1300), chapter('Preview', 1390)];
    const segments = segmentsFromChapters(chapters, 1420);
    expect(segments).toEqual([
      seg('recap', 0, 30), seg('opening', 30, 120), seg('ending', 1300, 1390), seg('preview', 1390, 1420),
    ]);
  });

  it('closes the last chapter with the duration and drops it when the duration is unknown', () => {
    expect(segmentsFromChapters([chapter('Part A', 0), chapter('ED', 1300)], 1420)).toEqual([seg('ending', 1300, 1420)]);
    expect(segmentsFromChapters([chapter('Part A', 0), chapter('ED', 1300)], 0)).toEqual([]);
  });

  it('sorts unsorted chapters and ignores segments shorter than the minimum', () => {
    const chapters = [chapter('OP', 90), chapter('Part A', 91), chapter('Intro', 0)];
    expect(segmentsFromChapters(chapters, 1400)).toEqual([seg('opening', 0, 90)]);
  });
});

describe('segmentsFromAniskip', () => {
  it('maps AniSkip types, including mixed ones, and drops unknown or tiny intervals', () => {
    const segments = segmentsFromAniskip([
      { skip_type: 'op', start_secs: 10, end_secs: 100 },
      { skip_type: 'mixed-ed', start_secs: 1300, end_secs: 1390 },
      { skip_type: 'recap', start_secs: 0, end_secs: 1 },
      { skip_type: 'weird', start_secs: 0, end_secs: 50 },
    ]);
    expect(segments).toEqual([seg('opening', 10, 100, 'aniskip'), seg('ending', 1300, 1390, 'aniskip')]);
  });
});

describe('mergeSegments', () => {
  it('keeps chapter segments over overlapping AniSkip ones and sorts by start', () => {
    const chapters = [seg('opening', 30, 120)];
    const aniskip = [seg('ending', 1300, 1390, 'aniskip'), seg('opening', 25, 115, 'aniskip')];
    expect(mergeSegments(chapters, aniskip)).toEqual([seg('opening', 30, 120), seg('ending', 1300, 1390, 'aniskip')]);
  });

  it('is a plain union when nothing overlaps', () => {
    expect(mergeSegments([], [seg('opening', 0, 90, 'aniskip')])).toEqual([seg('opening', 0, 90, 'aniskip')]);
    expect(mergeSegments([seg('opening', 0, 90)], [])).toEqual([seg('opening', 0, 90)]);
  });
});

describe('resolveActiveSegment', () => {
  const opening = seg('opening', 30, 120);
  const ending = seg('ending', 1300, 1390);
  const segments = [opening, ending];

  it('activates inside a segment and not in the final margin', () => {
    expect(resolveActiveSegment(segments, 29.9, null)).toBeNull();
    expect(resolveActiveSegment(segments, 30, null)).toBe(opening);
    expect(resolveActiveSegment(segments, 120 - ACTIVE_END_MARGIN_SECS, null)).toBeNull();
    expect(resolveActiveSegment(segments, 1350, null)).toBe(ending);
  });

  it('keeps the previous segment across a boundary wobble but releases it once clearly outside', () => {
    const active = resolveActiveSegment(segments, 31, null);
    expect(active).toBe(opening);
    // A tick slightly before the start (seek jitter) keeps the button.
    expect(resolveActiveSegment(segments, 30 - ACTIVE_HYSTERESIS_SECS / 2, active)).toBe(opening);
    expect(resolveActiveSegment(segments, 30 - ACTIVE_HYSTERESIS_SECS * 2, active)).toBeNull();
    // Same at the end: within the hysteresis it stays, past it goes away.
    expect(resolveActiveSegment(segments, 120 - ACTIVE_END_MARGIN_SECS + ACTIVE_HYSTERESIS_SECS / 2, active)).toBe(opening);
    expect(resolveActiveSegment(segments, 120 + 1, active)).toBeNull();
  });

  it('forgets a previous segment that no longer exists', () => {
    expect(resolveActiveSegment([ending], 31, opening)).toBeNull();
  });
});

describe('createAutoSkipTracker', () => {
  const opening = seg('opening', 30, 120);
  const ending = seg('ending', 1300, 1390);
  const segments = [opening, ending];

  it('fires once per segment, only when entering near its start', () => {
    const tracker = createAutoSkipTracker();
    expect(tracker.next(segments, 10)).toBeNull();
    expect(tracker.next(segments, 30.4)).toBe(opening);
    expect(tracker.next(segments, 30.6)).toBeNull();
    expect(tracker.next(segments, 60)).toBeNull(); // seeking back into the middle keeps it
    expect(tracker.next(segments, 1300.2)).toBe(ending);
  });

  it('ignores a segment entered from the middle and honours markHandled and reset', () => {
    const tracker = createAutoSkipTracker();
    expect(tracker.next(segments, 90)).toBeNull();
    tracker.markHandled(opening);
    expect(tracker.next(segments, 30)).toBeNull();
    tracker.reset();
    expect(tracker.next(segments, 30)).toBe(opening);
  });
});

describe('anilistIdFromExternalId', () => {
  it('extracts the AniList id only from anime rows', () => {
    expect(anilistIdFromExternalId('anime:21')).toBe(21);
    expect(anilistIdFromExternalId('series:1396')).toBeNull();
    expect(anilistIdFromExternalId('anime:')).toBeNull();
    expect(anilistIdFromExternalId(null)).toBeNull();
  });
});
