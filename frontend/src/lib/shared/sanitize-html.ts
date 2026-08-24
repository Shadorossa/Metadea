// Central sanitization for any HTML/text that ultimately comes from a
// third-party API (AniList, TMDB, IGDB, ComicVine, OpenLibrary) before it's
// ever handed to dangerouslySetInnerHTML or a raw .innerHTML assignment.
// AniList in particular allows real HTML in its bios/descriptions (bold,
// line breaks, spoiler tags) by design — this isn't a theoretical risk, the
// field already contains third-party markup on purpose.
import DOMPurify from 'dompurify';

// For fields meant to contain real markup (AniList/TMDB/IGDB/ComicVine
// descriptions, character biographies) — strips <script>, event handler
// attributes (onerror, onclick, ...), javascript:/data: URIs, iframes, etc.,
// while keeping harmless formatting tags (b, i, br, span, a, ul, li, ...).
export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return '';
  return DOMPurify.sanitize(html);
}

// For short inline fragments (a character's "Datos" stat values, extracted
// from bolded lines in their biography) — same trusted-markup allowance as
// sanitizeHtml, minus <img> and the style attribute. AniList bios sometimes
// embed a floated character portrait inline via `<img style="float:right">`
// in the middle of a bolded stat line; in a synopsis-length paragraph that
// reads fine, but a single stat value is one or two short lines, so a
// floated image (often broken/unreachable outside AniList's own page origin
// anyway) instead pushed the actual text into a narrow wrapped column and
// inflated the row's height for nothing worth showing.
export function sanitizeStatValue(html: string | null | undefined): string {
  if (!html) return '';
  return DOMPurify.sanitize(html, { FORBID_TAGS: ['img'], FORBID_ATTR: ['style'] });
}

// For plain-text values (names, titles, labels) that get interpolated into
// an HTML string template rather than set via .textContent — turns a value
// like `<img src=x onerror=alert(1)>` into inert entities instead of markup.
export function escapeHtml(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// For URLs interpolated into a src/href attribute — a plain string escape
// isn't enough there, since `javascript:alert(1)` or `data:text/html,...`
// need the whole value rejected, not just its quote characters. Only
// http(s) and the app's own asset:// protocol are ever legitimate here.
export function safeUrl(url: string | null | undefined): string {
  if (!url) return '';
  const trimmed = url.trim();
  if (/^(https?:|asset:)/i.test(trimmed)) return escapeHtml(trimmed);
  return '';
}
