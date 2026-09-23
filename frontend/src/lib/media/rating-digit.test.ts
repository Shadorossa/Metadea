import { describe, it, expect } from 'vitest';
import { digitToDbRating, ratingSystemAcceptsDigits } from './rating-digit';

// Same formula as rating-utils' dbRatingToStars5 (not imported: that module
// pulls the Tauri bridge in).
const dbRatingToStars5 = (rating: number) => Math.max(0, Math.min(5, rating / 2));

describe('digitToDbRating', () => {
  it('maps 1–9 to that score and 0 to 10 on the 10-point systems', () => {
    for (const system of ['10', '10-dec'] as const) {
      expect(digitToDbRating('1', system)).toBe(1);
      expect(digitToDbRating('7', system)).toBe(7);
      expect(digitToDbRating('9', system)).toBe(9);
      expect(digitToDbRating('0', system)).toBe(10);
    }
  });

  it('keeps the same 0–10 DB value for 5-star, which shows it as half stars', () => {
    expect(digitToDbRating('5', '5-star')).toBe(5);
    expect(dbRatingToStars5(digitToDbRating('5', '5-star')!)).toBe(2.5);
    expect(dbRatingToStars5(digitToDbRating('0', '5-star')!)).toBe(5);
    expect(dbRatingToStars5(digitToDbRating('1', '5-star')!)).toBe(0.5);
  });

  it('skips the emoji system and non-digit keys', () => {
    expect(digitToDbRating('5', '3-emoji')).toBeNull();
    expect(ratingSystemAcceptsDigits('3-emoji')).toBe(false);
    expect(ratingSystemAcceptsDigits('5-star')).toBe(true);
    expect(digitToDbRating('a', '10')).toBeNull();
    expect(digitToDbRating('10', '10')).toBeNull();
    expect(digitToDbRating('', '10')).toBeNull();
  });
});
