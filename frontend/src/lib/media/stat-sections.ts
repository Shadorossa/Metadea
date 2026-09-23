// Stat labels can carry a section tag as "Label [Section] rest", used to
// group related stats (e.g. character characteristics parsed from Fandom
// wikis) under a header. Shared between MediaPage.tsx (React) and
// character.astro (vanilla DOM) so both group/label stats identically.

export interface ParsedStatLabel {
  /** Section name to group this stat under, or null if it has none. */
  section: string | null;
  /** The label with the "[Section]" tag stripped out. */
  cleanLabel: string;
}

const TRAILING_COLON_RE = /[:：\s]+$/;

export function parseStatSectionLabel(rawLabel: string): ParsedStatLabel {
  const match = rawLabel.match(/^(.*?)\s*\[(.*?)\]\s*(.*?)$/);
  if (!match) {
    return { section: null, cleanLabel: rawLabel.trim().replace(TRAILING_COLON_RE, '') };
  }
  const section = match[2].replace(TRAILING_COLON_RE, '').trim();
  const cleanLabel = `${match[1]} ${match[3]}`.trim().replace(TRAILING_COLON_RE, '');
  return { section: section || null, cleanLabel };
}

/** Tracks the currently-open section across a sequential pass over stats, so
 *  callers can decide whether to render a header before the current stat. */
export class StatSectionTracker {
  private current: string | null = null;

  /** Returns the section header to render before this stat, or null if none
   *  is needed (same section as the previous stat, or no section at all). */
  next(section: string | null): string | null {
    if (!section) {
      this.current = null;
      return null;
    }
    if (section.toLowerCase() === this.current?.toLowerCase()) {
      return null;
    }
    this.current = section;
    return section;
  }
}
