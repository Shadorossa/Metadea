// The repository's CHANGELOG.md, bundled at build time and parsed once.
// Imported lazily (dynamic import) by the "What's new" launcher so the text
// only loads when a modal is about to open.
import changelogMarkdown from '../../../../CHANGELOG.md?raw';
import { compareVersions } from './changelog-selection';
import { parseChangelog, type ChangelogRelease } from './parse-changelog';

/** Every release, newest first. */
export const CHANGELOG_RELEASES: readonly ChangelogRelease[] = parseChangelog(changelogMarkdown)
  .sort((a, b) => compareVersions(b.version, a.version));
