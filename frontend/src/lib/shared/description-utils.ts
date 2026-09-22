// Unified description handling utilities consolidating scattered formatting
// logic from anilist-mapper.ts, comicvine-mapper.ts, and openlibrary-mapper.ts

// Strip all HTML tags from a string (used for descriptions from providers
// that don't support/need markup). Falsy input yields empty string.
export function stripHtml(html: string | null | undefined): string {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, '');
}

// Format a description by handling newlines and optional source attribution.
// Used by AniList mapper — adds source-specific styling for bolded sections.
export function formatDescription(
  text: string | null | undefined,
  sourceLabel?: string
): string {
  if (!text) return '';
  let formatted = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n');
  if (sourceLabel) {
    formatted = `${formatted}\n\nSource: ${sourceLabel}`;
  }
  return formatted;
}

// Extract description from a union-typed field (used when a provider returns
// multiple possible description formats). Takes first non-null/non-empty value.
export function extractDescription(
  ...candidates: (string | null | undefined)[]
): string | undefined {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}
