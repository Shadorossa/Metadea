import { describe, expect, it } from 'vitest';
import {
  chapterAt, clampPreviewLeft, exactFrameKey, frameIndexFor, isCloseEnough, nearestAvailableFrame, previewHeight, spriteStyle, spriteTile,
} from './seek-preview';

describe('frameIndexFor', () => {
  it('maps a time to the slot whose span contains it, clamped to the grid', () => {
    expect(frameIndexFor(0, 10, 144)).toBe(0);
    expect(frameIndexFor(9.99, 10, 144)).toBe(0);
    expect(frameIndexFor(10, 10, 144)).toBe(1);
    expect(frameIndexFor(1439, 10, 144)).toBe(143);
    expect(frameIndexFor(5000, 10, 144)).toBe(143);
    expect(frameIndexFor(-3, 10, 144)).toBe(0);
    expect(frameIndexFor(50, 0, 144)).toBe(0);
    expect(frameIndexFor(50, 10, 0)).toBe(0);
  });
});

describe('nearestAvailableFrame', () => {
  const having = (...indexes: number[]) => (index: number) => indexes.includes(index);

  it('returns the slot itself when present', () => {
    expect(nearestAvailableFrame(5, having(5, 6), 10)).toBe(5);
  });

  it('searches outward and prefers the earlier frame on a tie', () => {
    expect(nearestAvailableFrame(5, having(3, 7), 10)).toBe(3);
    expect(nearestAvailableFrame(5, having(8, 1), 10)).toBe(8);
    expect(nearestAvailableFrame(0, having(9), 10)).toBe(9);
  });

  it('respects the distance cap and empty grids', () => {
    expect(nearestAvailableFrame(5, having(9), 10, 2)).toBeNull();
    expect(nearestAvailableFrame(5, having(), 10)).toBeNull();
    expect(nearestAvailableFrame(0, having(0), 0)).toBeNull();
  });

  it('treats only the slot and its neighbours as close enough', () => {
    expect(isCloseEnough(4, 5)).toBe(true);
    expect(isCloseEnough(7, 5)).toBe(false);
    expect(isCloseEnough(null, 5)).toBe(false);
  });
});

describe('sprite tiles', () => {
  it('fills 10×10 sheets row by row', () => {
    expect(spriteTile(0, 10, 10)).toEqual({ sheet: 0, column: 0, row: 0 });
    expect(spriteTile(13, 10, 10)).toEqual({ sheet: 0, column: 3, row: 1 });
    expect(spriteTile(100, 10, 10)).toEqual({ sheet: 1, column: 0, row: 0 });
    expect(spriteTile(143, 10, 10)).toEqual({ sheet: 1, column: 3, row: 4 });
  });

  it('positions the background on the tile at display size', () => {
    expect(spriteStyle({ sheet: 0, column: 3, row: 1 }, 10, 200, 113)).toEqual({
      backgroundSize: '2000px auto',
      backgroundPosition: '-600px -113px',
    });
  });

  it('derives the preview height from the tile aspect', () => {
    expect(previewHeight(null)).toBe(113);
    expect(previewHeight({ tileWidth: 240, tileHeight: 136 })).toBe(113);
    expect(previewHeight({ tileWidth: 240, tileHeight: 180 })).toBe(150);
  });
});

describe('clampPreviewLeft', () => {
  // Player spans 0..1000, the bar starts at x=20.
  it('centres the preview on the pointer', () => {
    expect(clampPreviewLeft(500, 200, 20, 0, 1000)).toBe(380);
  });

  it('keeps the preview inside the player edges', () => {
    expect(clampPreviewLeft(30, 200, 20, 0, 1000)).toBe(8 - 20);
    expect(clampPreviewLeft(990, 200, 20, 0, 1000)).toBe(1000 - 8 - 200 - 20);
  });

  it('centres in the player when it is narrower than the preview', () => {
    expect(clampPreviewLeft(50, 200, 0, 0, 150)).toBe(-25);
  });
});

describe('chapterAt', () => {
  const chapters = [
    { title: 'Intro', time_secs: 0 },
    { title: 'Part A', time_secs: 90 },
    { title: 'Ending', time_secs: 1300 },
  ];

  it('returns the last chapter that started at or before the time', () => {
    expect(chapterAt(chapters, 0)?.title).toBe('Intro');
    expect(chapterAt(chapters, 89.9)?.title).toBe('Intro');
    expect(chapterAt(chapters, 90)?.title).toBe('Part A');
    expect(chapterAt(chapters, 2000)?.title).toBe('Ending');
  });

  it('returns null before the first chapter or without chapters', () => {
    expect(chapterAt([{ title: 'A', time_secs: 5 }], 2)).toBeNull();
    expect(chapterAt([], 10)).toBeNull();
  });
});

describe('exactFrameKey', () => {
  it('rounds hover times to half a second', () => {
    expect(exactFrameKey(12.24)).toBe(12);
    expect(exactFrameKey(12.26)).toBe(12.5);
  });
});
