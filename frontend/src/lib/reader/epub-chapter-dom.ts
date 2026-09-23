// DOM side of the EPUB chapter pipeline. Rust (epub_reader/sanitize.rs)
// already rebuilt the chapter from an allowlist and replaced every URL with
// `data-epub-src` / `data-epub-href` / `data-external-href`; this module
// runs the result through DOMPurify once more (defence in depth — it is
// third-party markup going into a webview with filesystem access), turns
// the `data-epub-src` paths into asset URLs and builds the stylesheet the
// shadow root renders the chapter with.
import DOMPurify from 'dompurify';
import { FONT_STACKS, THEME_PALETTES, type ReaderPreferences } from './reader-preferences';
import { mixRgb, paperGrainDataUri, rgbToCss, type EinkPalette } from './eink-mode';

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

/** E-Ink / paper mode inputs of the chapter stylesheet. */
export interface EinkChapterStyle {
  palette: EinkPalette;
  /** Id of the page filter mirrored into the shadow root. */
  filterId: string;
}

/** A book face for long reading, system fonts only (the webview's CSP
 *  serves fonts from the app itself and none of these ship with it). */
export const EINK_SERIF_STACK = "'Iowan Old Style', 'Charter', 'Bitstream Charter', 'Bookerly', 'Literata', 'Palatino Linotype', Georgia, 'Noto Serif', serif";

/** Longest comfortable measure; pages wider than this grow side margins. */
export const EINK_MEASURE_CH = 66;

/** Paper-mode layer on top of the reader stylesheet: parchment + static
 *  grain behind the page, ink-coloured text (no colour on e-ink), a book
 *  serif when the reader is on the default serif, a ~66ch measure and the
 *  page filter on the book's images. Everything is scoped to the shadow
 *  root, so none of it reaches the app. */
export function buildEinkChapterStyles(prefs: ReaderPreferences, pageWidth: number, eink: EinkChapterStyle): string {
  const { palette } = eink;
  const paper = rgbToCss(palette.paper);
  const ink = rgbToCss(palette.ink);
  const muted = rgbToCss(mixRgb(palette.ink, palette.paper, 0.45));
  const line = rgbToCss(mixRgb(palette.paper, palette.ink, 0.3));
  const selection = rgbToCss(palette.ink, 0.16);
  const font = prefs.font === 'serif' ? EINK_SERIF_STACK : FONT_STACKS[prefs.font];
  const sidePadding = `max(${prefs.margin}px, calc((${pageWidth}px - ${EINK_MEASURE_CH}ch) / 2))`;
  return `
:host { background: ${paper} ${paperGrainDataUri(palette)} repeat; color: ${ink}; }
.epub-chapter {
  font-family: ${font}; color: ${ink};
  padding-left: ${sidePadding}; padding-right: ${sidePadding};
  letter-spacing: 0.005em; word-spacing: 0.03em;
  text-rendering: optimizeLegibility; font-kerning: normal; font-variant-ligatures: common-ligatures;
  -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
  -webkit-hyphens: auto; hyphens: auto; hyphenate-limit-chars: 6 3 2;
  orphans: 2; widows: 2;
}
.epub-viewport--scroll .epub-chapter { max-width: calc(${EINK_MEASURE_CH}ch + ${prefs.margin * 2}px); padding-left: ${prefs.margin}px; padding-right: ${prefs.margin}px; }
.epub-chapter * { color: inherit !important; background-color: transparent !important; border-color: ${line} !important; text-shadow: none !important; }
.epub-chapter a { color: ${ink} !important; text-decoration-color: ${muted}; text-underline-offset: 0.15em; }
.epub-chapter hr { border: 0; border-top: 1px solid ${line}; }
.epub-chapter img, .epub-chapter svg { filter: url(#${eink.filterId}); }
.epub-chapter ::selection { background: ${selection}; color: inherit; }
.epub-chapter :target { background: ${selection} !important; }
`;
}

/** The reader's own stylesheet for the shadow root. When the publisher's
 *  styles are on, ours only sets the chapter root so the book's rules can
 *  refine it; when they are off, ours is enforced on every element. With
 *  `eink`, the paper-mode layer goes last so it wins over both. */
export function buildReaderStyles(prefs: ReaderPreferences, pageWidth: number, pageHeight: number, columnGap: number, eink: EinkChapterStyle | null = null): string {
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
${eink ? buildEinkChapterStyles(prefs, pageWidth, eink) : ''}`;
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
