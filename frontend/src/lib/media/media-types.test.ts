import { describe, expect, it } from 'vitest';
import { appStatusFromAniList, inProgressStatusFor } from './media-types';

describe('inProgressStatusFor', () => {
  it.each([
    ['anime', 'watching'], ['series', 'watching'], ['movie', 'watching'],
    ['manga', 'reading'], ['lnovel', 'reading'], ['book', 'reading'], ['comic', 'reading'],
    ['game', 'playing'], ['vnovel', 'playing'],
  ])('%s → %s', (type, status) => {
    expect(inProgressStatusFor(type)).toBe(status);
  });
});

describe('appStatusFromAniList', () => {
  it.each([
    ['CURRENT', 'anime', 'watching'],
    ['CURRENT', 'manga', 'reading'],
    // A re-run is still in progress, not something planned.
    ['REPEATING', 'anime', 'watching'],
    ['REPEATING', 'lnovel', 'reading'],
    ['COMPLETED', 'manga', 'completed'],
    ['PLANNING', 'anime', 'planning'],
    ['PAUSED', 'anime', 'paused'],
    ['DROPPED', 'manga', 'dropped'],
  ])('%s (%s) → %s', (status, type, expected) => {
    expect(appStatusFromAniList(status, type)).toBe(expected);
  });

  it('leaves an unknown status undefined', () => {
    expect(appStatusFromAniList('WHATEVER', 'anime')).toBeUndefined();
    expect(appStatusFromAniList(null, 'anime')).toBeUndefined();
  });
});
