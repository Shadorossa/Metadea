// DOM side of the EPUB chapter pipeline. Rust (epub_reader/sanitize.rs)
// already rebuilt the chapter from an allowlist and replaced every URL with
// `data-epub-src` / `data-epub-href` / `data-external-href`; this module
// runs the result through DOMPurify once more (defence in depth — it is
// third-party markup going into a webview with filesystem access), turns
// the `data-epub-src` paths into asset URLs and builds the stylesheet the
// shadow root renders the chapter with.
import DOMPurify from 'dompurify';
import { FONT_STACKS, THEME_PALETTES, type ReaderPreferences } from './reader-preferences';

const FORBIDDEN_TAGS = ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'video', 'audio', 'link', 'meta', 'base', 'use'];

/** Sanitised chapter HTML → DOM nodes with image sources resolved. */
export function buildChapterFragment(html: string, wrapAsset: (path: string) => string): DocumentFragment {
  const fragment = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    USE_PROFILES: { html: true, svg: true, svgFilters: false },
    FORBID_TAGS: FORBIDDEN_TAGS,
    FORBID_ATTR: ['src', 'href', 'xlink:href', 'srcset'],
    ADD_ATTR: ['data-epub-src', 'data-epub-href', 'data-external-href', 'epub:type'],
  });
  for (const el of Array.from(fragment.querySelectorAll('[data-epub-src]'))) {
    const path = el.getAttribute('data-epub-src') ?? '';
    const url = wrapAsset(path);
    if (el.tagName.toLowerCase() === 'img') {
      el.setAttribute('src', url);
      el.setAttribute('loading', 'eager');
      el.setAttribute('draggable', 'false');
    } else {
      el.setAttribute('href', url);
    }
    el.removeAttribute('data-epub-src');
  }
  return fragment;
}

const ASSET_PLACEHOLDER = /url\(\s*"epub-asset:([^"]*)"\s*\)/g;

/** css.rs emits `url("epub-asset:<abs path>")`; the asset URL scheme is
 *  platform-specific, so it is only known here. */
export function rewriteCssAssets(css: string, wrapAsset: (path: string) => string): string {
  return css.replace(ASSET_PLACEHOLDER, (_match, path: string) => `url("${wrapAsset(path)}")`);
}

/** The reader's own stylesheet for the shadow root. When the publisher's
 *  styles are on, ours only sets the chapter root so the book's rules can
 *  refine it; when they are off, ours is enforced on every element. */
export function buildReaderStyles(prefs: ReaderPreferences, pageWidth: number, pageHeight: number, columnGap: number): string {
  const palette = THEME_PALETTES[prefs.theme];
  const font = FONT_STACKS[prefs.font];
  const align = prefs.justify ? 'justify' : 'start';
  const enforced = prefs.publisherStyles
    ? ''
    : `.epub-chapter * { font-family: inherit !important; color: inherit !important; line-height: inherit !important; background: transparent !important; text-align: inherit; }
       .epub-chapter h1, .epub-chapter h2, .epub-chapter h3, .epub-chapter h4 { text-align: start; }`;
  return `
:host { display: block; height: 100%; width: 100%; background: ${palette.background}; color: ${palette.foreground}; }
* { box-sizing: border-box; }
.epub-viewport { height: 100%; width: 100%; overflow: hidden; }
.epub-viewport--scroll { overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; }
.epub-columns { height: ${pageHeight}px; width: ${pageWidth}px; column-width: ${pageWidth}px; column-gap: ${columnGap}px; column-fill: auto; }
.epub-viewport--scroll .epub-columns { height: auto; column-width: auto; column-gap: 0; width: 100%; }
.epub-chapter { font-family: ${font}; font-size: ${prefs.fontSize}px; line-height: ${prefs.lineHeight}; color: ${palette.foreground}; text-align: ${align}; padding: 0 ${prefs.margin}px; overflow-wrap: break-word; hyphens: auto; }
.epub-viewport--scroll .epub-chapter { padding: 24px ${prefs.margin}px 96px; max-width: 900px; margin: 0 auto; }
.epub-chapter img, .epub-chapter svg { max-width: 100%; max-height: ${Math.max(100, pageHeight - 8)}px; height: auto; object-fit: contain; }
.epub-chapter a { color: ${palette.link}; text-decoration: underline; cursor: pointer; }
.epub-chapter p { margin: 0 0 0.9em; }
.epub-chapter h1, .epub-chapter h2, .epub-chapter h3 { line-height: 1.25; break-after: avoid; }
.epub-chapter pre { white-space: pre-wrap; }
.epub-chapter table { max-width: 100%; border-collapse: collapse; }
.epub-chapter :target { background: color-mix(in srgb, ${palette.link} 25%, transparent); }
${enforced}
`;
}

/** Scrolls (or, in paginated mode, reports the column of) an in-chapter
 *  fragment target. Returns the element's horizontal offset within the
 *  columns element, or null when the id is not in this chapter. */
export function fragmentOffset(chapterRoot: Element, fragment: string): { left: number; top: number } | null {
  let target: Element | null;
  try {
    target = chapterRoot.querySelector(`#${CSS.escape(fragment)}`);
  } catch {
    target = null;
  }
  if (!target) return null;
  const rootRect = chapterRoot.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  return { left: rect.left - rootRect.left, top: rect.top - rootRect.top };
}
