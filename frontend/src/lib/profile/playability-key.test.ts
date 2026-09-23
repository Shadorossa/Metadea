import { describe, expect, it } from 'vitest';
import { buildInProgressIdsKey } from './playability-key';

const entry = (external_id: string, status: string | null) => ({ external_id, status });

describe('buildInProgressIdsKey', () => {
  it('is empty for a missing or empty library', () => {
    expect(buildInProgressIdsKey(null)).toBe('');
    expect(buildInProgressIdsKey([])).toBe('');
  });

  it('only includes in-progress entries', () => {
    const key = buildInProgressIdsKey([
      entry('game:1', 'playing'),
      entry('game:2', 'completed'),
      entry('anime:3', 'watching'),
      entry('manga:4', 'reading'),
      entry('game:5', 'playing'),
      entry('game:6', 'planning'),
      entry('game:7', null),
    ]);
    expect(key.split('|')).toEqual(['anime:3', 'game:1', 'game:5', 'manga:4']);
  });

  it('is stable across reordering and unrelated field changes', () => {
    const a = buildInProgressIdsKey([entry('game:1', 'playing'), entry('game:2', 'playing'), entry('game:3', 'completed')]);
    const b = buildInProgressIdsKey([entry('game:2', 'playing'), entry('game:3', 'dropped'), entry('game:1', 'playing')]);
    expect(a).toBe(b);
  });

  it('changes when the in-progress set changes', () => {
    const before = buildInProgressIdsKey([entry('game:1', 'playing'), entry('game:2', 'planning')]);
    const after = buildInProgressIdsKey([entry('game:1', 'playing'), entry('game:2', 'playing')]);
    expect(before).not.toBe(after);
    expect(buildInProgressIdsKey([entry('game:1', 'completed')])).toBe('');
  });
});
