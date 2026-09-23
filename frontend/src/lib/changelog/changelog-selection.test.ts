import { describe, expect, it } from 'vitest';
import { compareVersions, decideChangelogLaunch } from './changelog-selection';

const RELEASES = [{ version: '0.9.0' }, { version: '0.8.0' }, { version: '0.7.0' }];

describe('compareVersions', () => {
  it('compares numerically, not lexically', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareVersions('0.7.0', '0.7.0')).toBe(0);
    expect(compareVersions('v1.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.6.9', '0.7.0')).toBe(-1);
  });

  it('sorts a pre-release below its release', () => {
    expect(compareVersions('0.7.0-beta', '0.7.0')).toBe(-1);
    expect(compareVersions('0.7.0', '0.7.0-beta')).toBe(1);
    expect(compareVersions('0.7.0-alpha', '0.7.0-beta')).toBe(-1);
  });
});

describe('decideChangelogLaunch', () => {
  const decide = (runningVersion: string, lastSeenVersion: string | null, hasPriorData = true) =>
    decideChangelogLaunch({ runningVersion, lastSeenVersion, hasPriorData, releases: RELEASES });

  it('only records the version on a fresh install', () => {
    expect(decide('0.9.0', null, false)).toEqual({ kind: 'store' });
  });

  it('shows only the running version when updating from a pre-changelog build', () => {
    expect(decide('0.8.0', null)).toEqual({ kind: 'show', releases: [{ version: '0.8.0' }] });
  });

  it('does nothing when the running version was already seen, or on a downgrade', () => {
    expect(decide('0.8.0', '0.8.0')).toEqual({ kind: 'none' });
    expect(decide('0.7.0', '0.8.0')).toEqual({ kind: 'none' });
  });

  it('shows every skipped version up to the running one, newest first', () => {
    expect(decide('0.9.0', '0.7.0')).toEqual({ kind: 'show', releases: [{ version: '0.9.0' }, { version: '0.8.0' }] });
    expect(decide('0.8.0', '0.6.0')).toEqual({ kind: 'show', releases: [{ version: '0.8.0' }, { version: '0.7.0' }] });
  });

  it('records without showing when a newer version has no changelog section', () => {
    expect(decide('0.9.1', '0.9.0')).toEqual({ kind: 'store' });
    expect(decide('0.9.1', null)).toEqual({ kind: 'store' });
  });
});
