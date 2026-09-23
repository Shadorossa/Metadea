import { describe, expect, it } from 'vitest';
import { parseChangelog, parseEntryBullet, parseFixBullet, parseInline } from './parse-changelog';

const SAMPLE = [
  '# Changelog',
  '',
  'Intro text with a bullet that is not a release:',
  '- `## [X.Y.Z] - YYYY-MM-DD` sections',
  '',
  '## [Unreleased]',
  '### Added',
  '- Not shipped yet',
  '',
  '## [1.2.0] - 2026-10-01',
  '',
  '### Highlights',
  '- Big **news**',
  '',
  '### Added',
  '- **Player** — Plays videos',
  '  across two lines.',
  '- Plain entry with `code` and [a link](https://example.com)',
  '',
  '### Changed',
  '* **Faster**: pages load quicker',
  '',
  '### Deprecated',
  '- Ignored section',
  '',
  '### Fixed',
  '- Scroll was locked — Cause: a rule on `html`',
  '  disabled scrolling.',
  '- Missing cause here',
  '',
  '## [v1.1.0] - 2026-09-01',
  '### New',
  '- Older entry',
].join('\r\n');

describe('parseChangelog', () => {
  const releases = parseChangelog(SAMPLE);

  it('reads version sections in file order, skipping Unreleased and the intro', () => {
    expect(releases.map(r => r.version)).toEqual(['1.2.0', '1.1.0']);
    expect(releases[0].date).toBe('2026-10-01');
  });

  it('maps section headings, including Keep a Changelog aliases', () => {
    const [latest, older] = releases;
    expect(latest.highlights).toEqual(['Big **news**']);
    expect(latest.added).toHaveLength(2);
    expect(latest.improved).toEqual([{ title: 'Faster', text: 'pages load quicker' }]);
    expect(older.added).toEqual([{ text: 'Older entry' }]);
  });

  it('joins multi-line bullets and splits titled entries', () => {
    expect(releases[0].added[0]).toEqual({ title: 'Player', text: 'Plays videos across two lines.' });
    expect(releases[0].added[1]).toEqual({ text: 'Plain entry with `code` and [a link](https://example.com)' });
  });

  it('splits fixes into summary and cause, leaving the cause empty when absent', () => {
    expect(releases[0].fixed).toEqual([
      { summary: 'Scroll was locked', cause: 'a rule on `html` disabled scrolling.' },
      { summary: 'Missing cause here', cause: '' },
    ]);
  });

  it('shows Removed entries with the changes', () => {
    const [release] = parseChangelog(['## [2.0.0] - 2026-10-01', '### Removed', '- Old thing'].join('\n'));
    expect(release.improved).toEqual([{ text: 'Old thing' }]);
  });

  it('ignores unknown sections', () => {
    const texts = releases.flatMap(r => [...r.added, ...r.improved].map(e => e.text));
    expect(texts).not.toContain('Ignored section');
  });
});

describe('bullet helpers', () => {
  it('parseFixBullet accepts en dash and hyphen separators', () => {
    expect(parseFixBullet('A – Cause: B')).toEqual({ summary: 'A', cause: 'B' });
    expect(parseFixBullet('A - Cause: B')).toEqual({ summary: 'A', cause: 'B' });
  });

  it('parseEntryBullet reads a `**Area:**` prefix as the title', () => {
    expect(parseEntryBullet('**Player:** libmpv, exact resume')).toEqual({ title: 'Player', text: 'libmpv, exact resume' });
  });

  it('parseEntryBullet keeps a bold-only bullet as plain text', () => {
    expect(parseEntryBullet('**Only bold**')).toEqual({ text: '**Only bold**' });
  });
});

describe('parseInline', () => {
  it('splits bold, code and http links', () => {
    expect(parseInline('Use **Ctrl+K** or `?` — see [docs](https://example.com).')).toEqual([
      { kind: 'text', text: 'Use ' },
      { kind: 'bold', text: 'Ctrl+K' },
      { kind: 'text', text: ' or ' },
      { kind: 'code', text: '?' },
      { kind: 'text', text: ' — see ' },
      { kind: 'link', text: 'docs', href: 'https://example.com' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('keeps non-http link labels as plain text', () => {
    expect(parseInline('[run](javascript:alert(1))')).toEqual([
      { kind: 'text', text: 'run' },
      { kind: 'text', text: ')' },
    ]);
  });
});
