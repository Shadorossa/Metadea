import { describe, expect, it } from 'vitest';
import { isRejectedToken } from './search';

describe('isRejectedToken', () => {
  it('recognises AniList rejecting an expired or revoked token', () => {
    expect(isRejectedToken(400, { errors: [{ message: 'Invalid token' }] })).toBe(true);
    expect(isRejectedToken(401, { errors: [{ message: 'Unauthorized.' }] })).toBe(true);
  });

  it('ignores other failures', () => {
    expect(isRejectedToken(200, null)).toBe(false);
    expect(isRejectedToken(429, { errors: [{ message: 'Too Many Requests.' }] })).toBe(false);
    expect(isRejectedToken(400, { errors: [{ message: 'Variable "$type" got invalid value' }] })).toBe(false);
  });
});
