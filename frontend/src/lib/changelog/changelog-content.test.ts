// Guards the repository's CHANGELOG.md (the source of the in-app "What's
// new" window and of the GitHub release notes): well-formed sections, every
// fix explains its cause, and the version being built has its notes.
import { describe, expect, it } from 'vitest';
import changelogMarkdown from '../../../../CHANGELOG.md?raw';
import tauriConf from '../../../src-tauri/tauri.conf.json';
import pkg from '../../../package.json';
import { compareVersions } from './changelog-selection';
import { parseChangelog } from './parse-changelog';

const releases = parseChangelog(changelogMarkdown);
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

describe('CHANGELOG.md', () => {
  it('has at least one release', () => {
    expect(releases.length).toBeGreaterThan(0);
  });

  it('uses semver versions and ISO dates', () => {
    for (const release of releases) {
      expect(release.version).toMatch(SEMVER);
      expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('lists versions once each, newest first', () => {
    const versions = releases.map(r => r.version);
    expect(new Set(versions).size).toBe(versions.length);
    const sorted = [...versions].sort((a, b) => compareVersions(b, a));
    expect(versions).toEqual(sorted);
  });

  it('gives every release some content', () => {
    for (const release of releases) {
      const count = release.highlights.length + release.added.length + release.improved.length + release.fixed.length;
      expect(count, `v${release.version} is empty`).toBeGreaterThan(0);
    }
  });

  it('states a cause for every fix', () => {
    const missing = releases.flatMap(release =>
      release.fixed
        .filter(fix => !fix.summary || !fix.cause)
        .map(fix => `v${release.version}: ${fix.summary}`),
    );
    expect(missing).toEqual([]);
  });

  it('has a section for the current app version (tauri.conf.json), kept in sync with package.json', () => {
    expect(pkg.version).toBe(tauriConf.version);
    expect(releases.map(r => r.version)).toContain(tauriConf.version);
  });
});
