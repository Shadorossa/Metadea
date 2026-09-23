import {
  FONT_SIZE_RANGE,
  LINE_HEIGHT_RANGE,
  MARGIN_RANGE,
  READER_FONTS,
  READER_THEMES,
  normalizeReaderPreferences,
  type ReaderFont,
  type ReaderPreferences,
  type ReaderTheme,
} from '../../lib/reader/reader-preferences';
import { IconX } from '../local/ui/icons';
import { getT } from '../../i18n/runtime';

interface Props {
  prefs: ReaderPreferences;
  onChange: (prefs: ReaderPreferences) => void;
  onClose: () => void;
}

// Font family names are data (the bundled families' own names), not UI copy;
// the two system stacks are translated.
const BUNDLED_FONT_NAMES: Partial<Record<ReaderFont, string>> = {
  lora: 'Lora',
  baskerville: 'Libre Baskerville',
  alegreya: 'Alegreya',
  inter: 'Inter',
};

// Typography/theme/mode panel of the EPUB reader (the gear button).
export function EpubTypographyPanel({ prefs, onChange, onClose }: Props) {
  const t = getT().reader;
  const update = (patch: Partial<ReaderPreferences>) => onChange(normalizeReaderPreferences({ ...prefs, ...patch }));
  const fontLabel = (font: ReaderFont): string =>
    font === 'serif' ? t.epub_font_serif : font === 'sans' ? t.epub_font_sans : (BUNDLED_FONT_NAMES[font] ?? font);
  const themeLabel: Record<ReaderTheme, string> = {
    paper: t.epub_theme_paper,
    sepia: t.epub_theme_sepia,
    dark: t.epub_theme_dark,
    black: t.epub_theme_black,
  };

  return (
    <aside className="epub-panel epub-panel--settings" aria-label={t.epub_settings_title}>
      <div className="epub-panel-header">
        <span className="epub-panel-title">{t.epub_settings_title}</span>
        <button type="button" className="comic-reader-header-btn" onClick={onClose} aria-label={t.close_title} title={t.close_title}>
          <IconX />
        </button>
      </div>
      <div className="epub-panel-scroll epub-settings">
        <label className="epub-setting">
          <span>{t.epub_flow}</span>
          <div className="epub-segmented" role="group" aria-label={t.epub_flow}>
            <button type="button" className={prefs.flow === 'paginated' ? 'is-active' : ''} aria-pressed={prefs.flow === 'paginated'} onClick={() => update({ flow: 'paginated' })}>{t.epub_flow_paginated}</button>
            <button type="button" className={prefs.flow === 'scroll' ? 'is-active' : ''} aria-pressed={prefs.flow === 'scroll'} onClick={() => update({ flow: 'scroll' })}>{t.epub_flow_scroll}</button>
          </div>
        </label>

        <label className="epub-setting">
          <span>{t.epub_font}</span>
          <select value={prefs.font} onChange={e => update({ font: e.target.value as ReaderFont })}>
            {READER_FONTS.map(font => (
              <option key={font} value={font}>{fontLabel(font)}</option>
            ))}
          </select>
        </label>

        <label className="epub-setting">
          <span>{t.epub_font_size} · {prefs.fontSize}px</span>
          <input type="range" min={FONT_SIZE_RANGE.min} max={FONT_SIZE_RANGE.max} step={FONT_SIZE_RANGE.step} value={prefs.fontSize} onChange={e => update({ fontSize: Number(e.target.value) })} />
        </label>

        <label className="epub-setting">
          <span>{t.epub_line_height} · {prefs.lineHeight.toFixed(1)}</span>
          <input type="range" min={LINE_HEIGHT_RANGE.min} max={LINE_HEIGHT_RANGE.max} step={LINE_HEIGHT_RANGE.step} value={prefs.lineHeight} onChange={e => update({ lineHeight: Number(e.target.value) })} />
        </label>

        <label className="epub-setting">
          <span>{t.epub_margin} · {prefs.margin}px</span>
          <input type="range" min={MARGIN_RANGE.min} max={MARGIN_RANGE.max} step={MARGIN_RANGE.step} value={prefs.margin} onChange={e => update({ margin: Number(e.target.value) })} />
        </label>

        <div className="epub-setting">
          <span>{t.epub_theme}</span>
          <div className="epub-segmented" role="group" aria-label={t.epub_theme}>
            {READER_THEMES.map(theme => (
              <button
                key={theme}
                type="button"
                className={`epub-theme-swatch epub-theme-swatch--${theme}${prefs.theme === theme ? ' is-active' : ''}`}
                aria-pressed={prefs.theme === theme}
                onClick={() => update({ theme })}
              >
                {themeLabel[theme]}
              </button>
            ))}
          </div>
        </div>

        <label className="epub-setting epub-setting--toggle">
          <input type="checkbox" checked={prefs.justify} onChange={e => update({ justify: e.target.checked })} />
          <span>{t.epub_justify}</span>
        </label>

        <label className="epub-setting epub-setting--toggle">
          <input type="checkbox" checked={prefs.publisherStyles} onChange={e => update({ publisherStyles: e.target.checked })} />
          <span>{t.epub_publisher_styles}</span>
        </label>

        <p className="epub-shortcuts-hint">{t.epub_shortcuts_hint}</p>
      </div>
    </aside>
  );
}
