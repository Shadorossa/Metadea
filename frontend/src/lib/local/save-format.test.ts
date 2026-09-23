import { describe, expect, it } from 'vitest';
import { formatRelativeTime, groupSaves, parseHistoryKeep, slotLabel } from './save-format';
import type { SaveEntry } from '../tauri/saves';

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);

function entry(partial: Partial<SaveEntry>): SaveEntry {
  return {
    id: 'battery/x', kind: 'battery', name: 'x', slot: null, size: 1, modifiedMs: NOW, label: null,
    thumbnail: null, isFolder: false, shared: false, versions: [], synced: false, ...partial,
  };
}

describe('save-format', () => {
  it('formats relative times in the largest fitting unit', () => {
    expect(formatRelativeTime(NOW - 30_000, NOW, 'en')).toBe('now');
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW, 'en')).toBe('5 minutes ago');
    expect(formatRelativeTime(NOW - 3 * 3600_000, NOW, 'en')).toBe('3 hours ago');
    expect(formatRelativeTime(NOW - 24 * 3600_000, NOW, 'en')).toBe('yesterday');
    expect(formatRelativeTime(NOW - 400 * 24 * 3600_000, NOW, 'en')).toBe('last year');
  });

  it('names slots', () => {
    const labels = { slot: 'Slot {slot}', slot_auto: 'Auto', slot_resume: 'Resume' };
    expect(slotLabel('3', labels)).toBe('Slot 3');
    expect(slotLabel('auto', labels)).toBe('Auto');
    expect(slotLabel('resume', labels)).toBe('Resume');
    expect(slotLabel(null, labels)).toBeNull();
  });

  it('clamps the history size like the backend', () => {
    expect(parseHistoryKeep('7')).toBe(7);
    expect(parseHistoryKeep('0')).toBe(1);
    expect(parseHistoryKeep('999')).toBe(50);
    expect(parseHistoryKeep('abc')).toBe(5);
  });

  it('groups battery saves and states, own before shared, newest first', () => {
    const { battery, states } = groupSaves([
      entry({ id: 'states/a', kind: 'state', modifiedMs: NOW - 10 }),
      entry({ id: '@shared/battery/card', shared: true, modifiedMs: NOW }),
      entry({ id: 'battery/old', modifiedMs: NOW - 100 }),
      entry({ id: 'states/b', kind: 'state', modifiedMs: NOW }),
      entry({ id: 'battery/new', modifiedMs: NOW - 1 }),
    ]);
    expect(battery.map(e => e.id)).toEqual(['battery/new', 'battery/old', '@shared/battery/card']);
    expect(states.map(e => e.id)).toEqual(['states/b', 'states/a']);
  });
});
