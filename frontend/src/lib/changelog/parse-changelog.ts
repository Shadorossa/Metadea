// Parser for the repository's root CHANGELOG.md — the single source of truth
// for release notes. The app shows it in the "What's new" modal
// (components/changelog/) and the release workflow publishes the same section
// as the GitHub release body (.github/scripts/changelog-release-notes.mjs).
//
// Expected shape (Keep a Changelog style, English only):
//
//   ## [0.7.0] - 2026-09-23
//   ### Highlights
//   - One-line headline
//   ### Added
//   - **Area:** short list (the bold area prefix is optional)
//   ### Improved
//   - ...
//   ### Fixed
//   - <summary> — Cause: <cause>
//
// A bullet may continue on following indented lines. `## [Unreleased]` and
// unknown `###` headings are ignored. Inline markdown (bold, `code`, links)
// is kept verbatim in the text and split by `parseInline` at render time.

export interface ChangelogEntry {
  /** Bold lead-in of the bullet (`**Title** — …`), when present. */
  title?: string;
  text: string;
}

export interface ChangelogFix {
  summary: string;
  /** Empty when the bullet lacks the ` — Cause: ` part; the content test
   *  rejects that, so a shipped changelog always states a cause. */
  cause: string;
}

export interface ChangelogRelease {
  version: string;
  /** ISO date (YYYY-MM-DD) or '' when the heading has none. */
  date: string;
  highlights: string[];
  added: ChangelogEntry[];
  improved: ChangelogEntry[];
  fixed: ChangelogFix[];
}

type SectionKey = 'highlights' | 'added' | 'improved' | 'fixed';

const SECTION_BY_HEADING: Record<string, SectionKey> = {
  highlights: 'highlights',
  added: 'added',
  new: 'added',
  improved: 'improved',
  changed: 'improved',
  // Removals read as changes in the app ("External VLC playback removed").
  removed: 'improved',
  fixed: 'fixed',
};

const VERSION_HEADING = /^##\s+\[([^\]]+)\](?:\s*-\s*(\S+))?\s*$/;
const SECTION_HEADING = /^###\s+(.+?)\s*$/;
const BULLET = /^[-*]\s+(.*)$/;
const CAUSE_SEPARATOR = /\s+[—–-]{1,2}\s+Cause:\s*/;
const TITLED_ENTRY = /^\*\*(.+?)\*\*\s*(?:[—–:-]\s*)?(.*)$/;

export function parseFixBullet(text: string): ChangelogFix {
  const match = CAUSE_SEPARATOR.exec(text);
  if (!match) return { summary: text.trim(), cause: '' };
  return {
    summary: text.slice(0, match.index).trim(),
    cause: text.slice(match.index + match[0].length).trim(),
  };
}

export function parseEntryBullet(text: string): ChangelogEntry {
  const match = TITLED_ENTRY.exec(text);
  if (!match || !match[2].trim()) return { text: text.trim() };
  // `**Area:** …` keeps its colon inside the bold; the title drops it.
  return { title: match[1].trim().replace(/:$/, ''), text: match[2].trim() };
}

function emptyRelease(version: string, date: string): ChangelogRelease {
  return { version, date, highlights: [], added: [], improved: [], fixed: [] };
}

/** Parses the whole CHANGELOG.md; releases come back in file order (the
 *  file lists them newest first). */
export function parseChangelog(markdown: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  let release: ChangelogRelease | null = null;
  let section: SectionKey | null = null;
  let bullet: string | null = null;

  const flush = () => {
    if (bullet === null || !release || !section) { bullet = null; return; }
    const text = bullet.trim();
    bullet = null;
    if (!text) return;
    if (section === 'highlights') release.highlights.push(text);
    else if (section === 'fixed') release.fixed.push(parseFixBullet(text));
    else release[section].push(parseEntryBullet(text));
  };

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trimEnd();

    const versionMatch = VERSION_HEADING.exec(line);
    if (versionMatch) {
      flush();
      section = null;
      const version = versionMatch[1].trim().replace(/^v/i, '');
      if (version.toLowerCase() === 'unreleased') { release = null; continue; }
      release = emptyRelease(version, versionMatch[2] ?? '');
      releases.push(release);
      continue;
    }
    if (line.startsWith('## ') || line.startsWith('# ')) {
      flush();
      release = null;
      section = null;
      continue;
    }

    const sectionMatch = SECTION_HEADING.exec(line);
    if (sectionMatch) {
      flush();
      section = SECTION_BY_HEADING[sectionMatch[1].toLowerCase()] ?? null;
      continue;
    }

    if (!release || !section) continue;

    const bulletMatch = BULLET.exec(line);
    if (bulletMatch) {
      flush();
      bullet = bulletMatch[1];
      continue;
    }
    // Indented continuation of the current bullet; a blank line ends it.
    if (bullet !== null && /^\s+\S/.test(rawLine)) {
      bullet += ` ${line.trim()}`;
      continue;
    }
    if (!line.trim()) flush();
  }
  flush();
  return releases;
}

// ── Inline markdown ───────────────────────────────────────────────────────────

export type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Splits bullet text into plain/bold/code/link runs. Only http(s) links
 *  become links; anything else keeps its label as plain text. */
export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ kind: 'text', text: text.slice(last, index) });
    if (match[1] !== undefined) tokens.push({ kind: 'code', text: match[1] });
    else if (match[2] !== undefined) tokens.push({ kind: 'bold', text: match[2] });
    else if (/^https?:\/\//i.test(match[4])) tokens.push({ kind: 'link', text: match[3], href: match[4] });
    else tokens.push({ kind: 'text', text: match[3] });
    last = index + match[0].length;
  }
  if (last < text.length) tokens.push({ kind: 'text', text: text.slice(last) });
  return tokens;
}
