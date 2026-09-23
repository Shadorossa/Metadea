import { describe, expect, it } from 'vitest';
import type { ComicVineIssueSummary, ComicVineStoryArc, ComicVineVolumeArcs } from '../../tauri/comicvine';
// The Rust client's own response fixtures, so both sides agree on the shape.
import storyArcResponse from '../../../../src-tauri/src/fixtures/comicvine/story_arc.json';
import issuesBatchResponse from '../../../../src-tauri/src/fixtures/comicvine/issues_batch.json';
import {
  arcChoiceToStoryArc, arcNameExists, buildArcCandidates, defaultImportRange, estimateVolumeChapters,
  buildVolumeChapterIndex, mergeContiguous, needsReview, rangesOverlap, summarizeArcDescription,
} from './comicvine-arc-import';

const arrancar = storyArcResponse.results as unknown as ComicVineStoryArc;
const bleachIssues = issuesBatchResponse.results as unknown as ComicVineIssueSummary[];

function issue(id: number, number: string, description: string | null): ComicVineIssueSummary {
  return { id, issue_number: number, name: null, volume: { id: 1, name: 'Series' }, description, cover_date: null };
}

function arc(id: number, name: string, issueIds: number[]): ComicVineStoryArc {
  return {
    id, name, deck: null, description: null, image: null,
    issues: issueIds.map(issueId => ({ id: issueId, name: null })),
    first_appeared_in_issue: null, count_of_issue_appearances: issueIds.length, publisher: null,
  };
}

const volume = (arcs: ComicVineStoryArc[], issues: ComicVineIssueSummary[]): ComicVineVolumeArcs => ({ volume_id: 1, arcs, issues, complete: true });

describe('mergeContiguous / rangesOverlap', () => {
  it('merges consecutive numbers (half chapters included) and keeps gaps', () => {
    expect(mergeContiguous([5, 3, 4, 10, 11, 4, 187, 187.5, 188])).toEqual([[3, 5], [10, 11], [187, 188]]);
    expect(mergeContiguous([])).toEqual([]);
  });

  it('detects overlapping and touching ranges', () => {
    expect(rangesOverlap([1, 10], [10, 20])).toBe(true);
    expect(rangesOverlap([1, 9], [10, 20])).toBe(false);
  });
});

describe('buildArcCandidates on the Arrancar fixture', () => {
  const [candidate] = buildArcCandidates(volume([arrancar], bleachIssues), 'chapters');

  it('keeps only the issues of the scanned volume, in volume order', () => {
    expect(candidate.issues.map(i => i.number)).toEqual([21, 22, 23]);
    expect(candidate.volumeRange).toEqual([21, 23]);
  });

  it('parses each volume description into chapters and merges them', () => {
    expect(candidate.issues.map(i => i.chapters[0])).toEqual([182, 191, 200]);
    expect(candidate.chapterRange).toEqual([182, 208]);
    expect(candidate.chapterSegments).toEqual([[182, 184], [191, 193], [200, 208]]);
  });

  it('flags the non-contiguous chapters for review and carries name, cover and a short description', () => {
    expect(needsReview(candidate, 'chapters')).toBe(true);
    expect(candidate.name).toBe('Arrancar Saga');
    expect(candidate.image).toMatch(/^https:\/\/comicvine\.gamespot\.com\//);
    expect(candidate.description).toBe("Ichigo and his friends face Aizen's army of Arrancar.");
  });
});

describe('buildArcCandidates', () => {
  const issues = [
    issue(1, '1', '<ul><li>Chapter 1</li><li>Chapter 2</li><li>Chapter 3</li></ul>'),
    issue(2, '2', 'Chapters 4-6'),
    issue(3, '3', null),
    issue(4, '4', 'Capítulos 10 a 12'),
    issue(5, '5', null),
  ];

  it('sorts arcs by first chapter and detects overlaps', () => {
    const candidates = buildArcCandidates(volume([arc(20, 'Later', [2]), arc(10, 'Early', [1, 2]), arc(30, 'Elsewhere', [999])], issues), 'chapters');
    expect(candidates.map(c => c.name)).toEqual(['Early', 'Later']);
    expect(candidates[0].chapterRange).toEqual([1, 6]);
    expect(candidates[0].overlapsWith).toEqual([20]);
    expect(candidates[1].overlapsWith).toEqual([10]);
  });

  it('estimates a volume without chapters from its neighbours and flags it', () => {
    const [candidate] = buildArcCandidates(volume([arc(1, 'Middle', [3])], issues), 'chapters');
    expect(candidate.chapterRange).toEqual([7, 9]);
    expect(candidate.estimatedVolumes).toEqual([3]);
    expect(needsReview(candidate, 'chapters')).toBe(true);
  });

  it('keeps only the volume range when chapters cannot be known', () => {
    const [candidate] = buildArcCandidates(volume([arc(1, 'Tail', [5])], issues), 'chapters');
    expect(candidate.chapterRange).toBeNull();
    expect(candidate.volumeRange).toEqual([5, 5]);
    expect(candidate.unresolvedVolumes).toEqual([5]);
    expect(defaultImportRange(candidate, 'chapters')).toBeNull();
  });

  it('uses issue numbers as the range for comics', () => {
    const [candidate] = buildArcCandidates(volume([arc(1, 'Court of Owls', [1, 2, 3])], issues), 'issues');
    expect(candidate.chapterRange).toBeNull();
    expect(defaultImportRange(candidate, 'issues')).toEqual([1, 3]);
    expect(needsReview(candidate, 'issues')).toBe(false);
  });

  it('orders volume-only arcs after chaptered ones by volume', () => {
    const candidates = buildArcCandidates(volume([arc(2, 'Tail', [5]), arc(1, 'Head', [1])], issues), 'chapters');
    expect(candidates.map(c => c.name)).toEqual(['Head', 'Tail']);
  });
});

describe('estimateVolumeChapters', () => {
  it('splits a gap evenly and refuses without both neighbours', () => {
    const index = buildVolumeChapterIndex([issue(1, '1', 'Chapters 1-10'), issue(4, '4', 'Chapters 17-20')]);
    expect(estimateVolumeChapters(2, index)).toEqual([11, 12, 13]);
    expect(estimateVolumeChapters(3, index)).toEqual([14, 15, 16]);
    expect(estimateVolumeChapters(5, index)).toBeNull();
  });
});

describe('summarizeArcDescription', () => {
  it('prefers the deck and otherwise shortens the stripped description', () => {
    expect(summarizeArcDescription({ deck: 'Short.', description: '<p>Long</p>' })).toBe('Short.');
    const long = `<p>${'word '.repeat(100)}</p>`;
    const summary = summarizeArcDescription({ deck: null, description: long });
    expect(summary.length).toBeLessThanOrEqual(241);
    expect(summary.endsWith('…')).toBe(true);
    expect(summary).not.toContain('<');
  });
});

describe('arcNameExists', () => {
  it('matches names ignoring case, accents and "saga"/"arc" words', () => {
    expect(arcNameExists('Arrancar Saga', ['arrancar'])).toBe(true);
    expect(arcNameExists('Soul Society Arc', ['Sociedad de Almas'])).toBe(false);
    expect(arcNameExists('Hueco Mundo', ['Hueco  Mundo arc'])).toBe(true);
  });
});

describe('arcChoiceToStoryArc', () => {
  it('builds the same StoryArc the manual editor saves', () => {
    const storyArc = arcChoiceToStoryArc({ candidate: { name: ' Arrancar Saga ', image: 'https://x/a.jpg' }, start: 182, end: 208, useImage: true }, 'manga:30012');
    expect(storyArc).toEqual({
      id: '',
      name: 'Arrancar Saga',
      image_base64: 'https://x/a.jpg',
      items: [{ id: '', media_external_id: 'manga:30012', ep_start: 182, ep_end: 208, position: 0, group_id: null }],
      sort_order: 0,
    });
  });

  it('drops the image when asked, swaps a reversed range and nulls invalid bounds', () => {
    const storyArc = arcChoiceToStoryArc({ candidate: { name: 'X', image: 'https://x/a.jpg' }, start: 30, end: 20, useImage: false }, 'comic:1');
    expect(storyArc.image_base64).toBeNull();
    expect([storyArc.items[0].ep_start, storyArc.items[0].ep_end]).toEqual([20, 30]);
    const empty = arcChoiceToStoryArc({ candidate: { name: 'Y', image: null }, start: null, end: Number.NaN, useImage: true }, 'manga:1');
    expect([empty.items[0].ep_start, empty.items[0].ep_end]).toEqual([null, null]);
  });
});
