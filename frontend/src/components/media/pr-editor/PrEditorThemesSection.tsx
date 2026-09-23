import type { MediaCatalogEntry } from '../../../lib/tauri/catalog';
import type { MediaTheme } from '../../../lib/tauri/themes';
import type { Translations } from '../../../i18n/index';
import { PrEditorThemeCard } from './PrEditorThemeCard';

interface Props {
  t: Translations;
  entry: MediaCatalogEntry;
  themePreview: MediaTheme[];
  themePreviewLoading: boolean;
}

// Read-only preview of an anime's opening/ending themes.
export function PrEditorThemesSection({ t, entry, themePreview, themePreviewLoading }: Props) {
  const tm = t.media;
  const pe = t.pr_editor;
  return (
    <div className="pr-editor-section">
      <h3 className="pr-editor-section-title">{tm.section_themes}</h3>
      <div className="media-relations-grid pr-editor-theme-preview-grid">
        {themePreview.map(theme => (
          <PrEditorThemeCard
            key={`${theme.external_id}-${theme.theme_type}-${theme.sequence}-${theme.slug}`}
            theme={theme}
            fallbackUrl={entry.banners_csv?.split(',')[0]?.trim() || entry.cover_url || undefined}
          />
        ))}
        {themePreviewLoading && <div className="pr-editor-search-loading">{pe.loading_themes}</div>}
        {!themePreviewLoading && themePreview.length === 0 && <div className="pr-editor-search-empty">{pe.no_themes_available}</div>}
      </div>
    </div>
  );
}
