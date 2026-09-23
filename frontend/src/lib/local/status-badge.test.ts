import { describe, it, expect } from 'vitest';
import { getStatusBadge } from './status-badge';

describe('getStatusBadge', () => {
  it('returns null for a missing status', () => {
    expect(getStatusBadge(null)).toBeNull();
    expect(getStatusBadge(undefined)).toBeNull();
    expect(getStatusBadge('')).toBeNull();
  });

  it('maps each terminal status to its own badge', () => {
    expect(getStatusBadge('planning')).toEqual({ labelKey: 'status_planning', modifier: 'planning' });
    expect(getStatusBadge('completed')).toEqual({ labelKey: 'status_completed', modifier: 'completed' });
    expect(getStatusBadge('paused')).toEqual({ labelKey: 'status_paused', modifier: 'paused' });
    expect(getStatusBadge('dropped')).toEqual({ labelKey: 'status_dropped', modifier: 'dropped' });
  });

  it('maps every in-progress status to the same progress badge', () => {
    for (const status of ['watching', 'reading', 'playing']) {
      expect(getStatusBadge(status)).toEqual({ labelKey: 'section_in_progress', modifier: 'progress' });
    }
  });

  it('returns null for an unknown status', () => {
    expect(getStatusBadge('unknown')).toBeNull();
    expect(getStatusBadge('Completed')).toBeNull();
  });
});
