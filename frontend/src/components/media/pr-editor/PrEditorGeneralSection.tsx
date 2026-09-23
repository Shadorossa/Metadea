import type { MediaCatalogEntry } from '../../../lib/tauri/catalog';
import type { Translations } from '../../../i18n/index';
import { ALL_PLATFORMS, ALL_GENRES } from '../../../lib/media/igdb-catalog-data';
import { ChangedDot, Field } from '../../shared/PrEditorField';
import { RichTextEditor } from '../../shared/RichTextEditor';
import { SlotInput } from '../SlotInput';

interface Props {
  t: Translations;
  entry: MediaCatalogEntry;
  isFieldChanged: (field: keyof MediaCatalogEntry) => boolean;
  // Set when opened from an already-merged GitHub entry — fields known
  // locally but absent from the GitHub bundle are dimmed (see PrEditorModal's
  // nonGithubFields prop).
  isLocalOnly: (field: keyof MediaCatalogEntry) => boolean;
  onChange: (field: keyof MediaCatalogEntry, value: string | number | null) => void;
  // Whole-entry replacement, for the release-date fields that clamp
  // release_day alongside the field actually edited.
  onReplaceEntry: (next: MediaCatalogEntry) => void;
}

// Same domain-sniffing build_store_links (igdb.rs) already uses for a live
// IGDB fetch's own store_links — mirrored here so a pasted bare URL
// auto-gets its "platform|" prefix instead of the user having to type it.
// Left as-is (no prefix added) when nothing matches, or when the user
// already typed "platform|url" themselves.
function detectShopLinkPlatform(raw: string): string {
  if (raw.includes('|')) return raw;
  const url = raw.toLowerCase();
  const platform = url.includes('store.steampowered.com') ? 'steam'
    : url.includes('gog.com') ? 'gog'
    : url.includes('epicgames.com') ? 'epic'
    : (url.includes('xbox.com') || url.includes('microsoft.com/store')) ? 'xbox'
    : url.includes('playstation.com') ? 'playstation'
    : null;
  return platform ? `${platform}|${raw}` : raw;
}

// The "General" tab: the entry's own scalar fields (titles, synopsis,
// release date, counts, shop links, cover/banners, classification).
export function PrEditorGeneralSection({ t, entry, isFieldChanged, isLocalOnly, onChange, onReplaceEntry }: Props) {
  const tm = t.media;
  const pe = t.pr_editor;
  const tg = pe.general;

  const textField = (field: keyof MediaCatalogEntry, label: string) => (
    <Field label={label} changed={isFieldChanged(field)} dim={isLocalOnly(field)}>
      <input type="text" value={(entry[field] as string) || ''} onChange={e => onChange(field, e.target.value)} />
    </Field>
  );

  const numberField = (field: keyof MediaCatalogEntry, label: string, disabled = false) => (
    <Field label={label} changed={isFieldChanged(field)} small dim={isLocalOnly(field)}>
      <input type="number" value={(entry[field] as number) ?? ''} disabled={disabled}
        onChange={e => onChange(field, e.target.value ? parseInt(e.target.value, 10) : null)} />
    </Field>
  );

  const releaseDateField = (field: 'release_year' | 'release_month' | 'release_day', label: string) => {
    const daysInMonth = (month: number | null, year: number | null) =>
      month ? new Date(year ?? 2000, month, 0).getDate() : 31;
    const max = field === 'release_year' ? 9999
      : field === 'release_month' ? 12
        : daysInMonth(entry.release_month ?? null, entry.release_year ?? null);
    const min = field === 'release_year' ? 1 : 1;

    return (
      <Field label={label} changed={isFieldChanged(field)} small dim={isLocalOnly(field)}>
        <input
          type="number"
          min={min}
          max={max}
          step={1}
          value={entry[field] ?? ''}
          onChange={event => {
            const rawValue = event.target.value;
            const parsed = rawValue === '' ? null : Number.parseInt(rawValue, 10);
            const value = parsed == null || !Number.isFinite(parsed)
              ? null
              : Math.max(min, Math.min(max, parsed));
            const next = { ...entry, [field]: value };
            if (field === 'release_month' || field === 'release_year') {
              const nextMonth = field === 'release_month' ? value : entry.release_month ?? null;
              const nextYear = field === 'release_year' ? value : entry.release_year ?? null;
              const maxDay = daysInMonth(nextMonth, nextYear);
              if (next.release_day != null && next.release_day > maxDay) next.release_day = maxDay;
            }
            onReplaceEntry(next);
          }}
        />
      </Field>
    );
  };

  const primaryCountLabel = ({
    anime: tg.episodes_count,
    series: tg.episodes_count,
    movie: tg.episodes_count,
    manga: tg.chapters_count,
    comic: tg.chapters_count,
    lnovel: tg.chapters_count,
    book: tg.pages_count,
  } as Record<string, string>)[entry.type] ?? tg.total_count;
  const secondaryCountLabel = ({
    anime: tg.seasons_count,
    series: tg.seasons_count,
    manga: tg.volumes_count,
    lnovel: tg.volumes_count,
    comic: tg.volumes_count,
  } as Record<string, string>)[entry.type] ?? tg.secondary_count;

  // Options come straight from the i18n formats dictionary (media.formats) —
  // it already carries every format key both AniList (TV/MOVIE/OVA/...) and
  // IGDB (GAME/REMAKE/REMASTER/.../VISUAL_NOVEL) mappers can produce, so this
  // never drifts out of sync with what a live fetch would set automatically.
  const mediaTypesDict = t.search.types as Record<string, string>;

  const typeField = (field: keyof MediaCatalogEntry, label: string, inline = false) => {
    const currentType = entry[field] as string;
    const isGameOrVn = currentType === 'game' || currentType === 'vnovel';

    if (!isGameOrVn) {
      return (
        <Field label={label} changed={isFieldChanged(field)} dim={isLocalOnly(field)} inline={inline}>
          <input type="text" value={mediaTypesDict[currentType] || currentType || ''} disabled className="pr-editor-readonly-input" />
        </Field>
      );
    }

    return (
      <Field label={label} changed={isFieldChanged(field)} dim={isLocalOnly(field)} inline={inline}>
        <select value={currentType || ''} onChange={e => onChange(field, e.target.value || null)}>
          <option value="game">{mediaTypesDict.game}</option>
          <option value="vnovel">{mediaTypesDict.vnovel}</option>
        </select>
      </Field>
    );
  };

  const formatField = (field: keyof MediaCatalogEntry, label: string, inline = false) => (
    <Field label={label} changed={isFieldChanged(field)} dim={isLocalOnly(field)} inline={inline}>
      <select value={(entry[field] as string) || ''} onChange={e => onChange(field, e.target.value || null)}>
        <option value="">—</option>
        {Object.keys(tm.formats)
          .sort((a, b) => tm.formats[a as keyof typeof tm.formats].localeCompare(tm.formats[b as keyof typeof tm.formats]))
          .map(key => (
            <option key={key} value={key}>{tm.formats[key as keyof typeof tm.formats]}</option>
          ))}
      </select>
    </Field>
  );

  const slotField = (field: keyof MediaCatalogEntry, label: string, opts?: {
    allowed?: string[]; restrict?: boolean; preview?: boolean; fullWidth?: boolean; dotClass?: string;
    transformNewItem?: (raw: string) => string;
  }) => (
    <div className={`pr-editor-field-wrap${isLocalOnly(field) ? ' pr-editor-field--dim' : ''}`}>
      <SlotInput label={label} value={entry[field] as string | undefined} onChange={v => onChange(field, v)}
        allowedSuggestions={opts?.allowed} restrictToSuggestions={opts?.restrict}
        preview={opts?.preview} fullWidth={opts?.fullWidth} transformNewItem={opts?.transformNewItem} />
      <ChangedDot show={isFieldChanged(field)}
        className={`pr-editor-changed-dot ${opts?.dotClass ?? 'pr-editor-changed-dot--slot'}`} />
    </div>
  );

  return (
    <div className="pr-editor-body--grid pr-editor-body--grid-2col">
      <div className="pr-editor-col pr-editor-col--left">
        <div className="pr-editor-section">
          <div className="pr-editor-labeled-row">
            <span className="pr-editor-vertical-label">{tg.titles}</span>
            <div className="pr-editor-labeled-content">
              <div className="pr-editor-form-grid">
                {textField('title_main', tg.main_title)}
                {textField('title_romaji', tg.romaji_title)}
                {textField('title_native', tg.native_title)}
              </div>
            </div>
          </div>
          <div className="pr-editor-labeled-row">
            <span className="pr-editor-vertical-label">
              {tg.synopsis}
              <ChangedDot show={isFieldChanged('synopsis')} className="pr-editor-section-changed-dot" />
            </span>
            <div className="pr-editor-labeled-content">
              <div className={`pr-editor-field${isLocalOnly('synopsis') ? ' pr-editor-field--dim' : ''}`}>
                <RichTextEditor
                  value={entry.synopsis || ''}
                  onChange={html => onChange('synopsis', html)}
                  placeholder={pe.synopsis_ph}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="pr-editor-section pr-editor-section--release-progress">
          <div className="pr-editor-field-row pr-editor-field-row--release-progress">
            <div className="pr-editor-subgroup pr-editor-subgroup--vertical-label">
              <span className="pr-editor-vertical-label">{tg.release}</span>
              <div className="pr-editor-subgroup-fields">
                {releaseDateField('release_year', tg.year)}
                {releaseDateField('release_month', tg.month)}
                {releaseDateField('release_day', tg.day)}
              </div>
            </div>

            <div className="pr-editor-subgroup-divider" />

            <div className="pr-editor-subgroup pr-editor-subgroup--vertical-label">
              <span className="pr-editor-vertical-label">{tg.progress}</span>
              <div className="pr-editor-subgroup-fields">
                {numberField('total_count', primaryCountLabel, entry.type === 'movie')}
                {numberField('total_count_2', secondaryCountLabel)}
              </div>
            </div>
          </div>
        </div>

        <div className="pr-editor-section pr-editor-section--shop-links">
          <div className="pr-editor-labeled-row pr-editor-shop-links-row">
            <span className="pr-editor-vertical-label">{tg.shop_links}</span>
            <div className="pr-editor-shop-links-content">
              {/* One slot per "platform|url" pair (steam|https://...,
                  gog|https://...) - the exact format
                  usePendingLaunchers/build_store_links already parse
                  this CSV into, so a game missing its own storefront
                  links (a common gap for anything the user never opened
                  /media on, see that hook's own comment) can get them
                  added here manually instead of only ever being backfilled
                  by a live IGDB fetch. */}
              {slotField('shop_links_csv', tg.shop_links_ph, { fullWidth: true, transformNewItem: detectShopLinkPlatform })}
            </div>
          </div>
        </div>
      </div>

      <div className="pr-editor-col pr-editor-col--right">
        <div className="pr-editor-section">
          <div className="pr-editor-assets-box">
            <div className="pr-editor-labeled-row pr-editor-asset-row">
              <span className="pr-editor-vertical-label">
                {tg.cover_url}
                <ChangedDot show={isFieldChanged('cover_url')} />
              </span>
              <div className={`pr-editor-cover-section${isLocalOnly('cover_url') ? ' pr-editor-field--dim' : ''}`}>
                <div className="pr-editor-cover-uploader">
                  <div className="pr-editor-cover-preview-card">
                    {entry.cover_url ? (
                      <img className="cover-image-fill" src={entry.cover_url} alt="" />
                    ) : (
                      <span className="pr-editor-cover-placeholder">{pe.no_cover}</span>
                    )}
                  </div>
                  <input
                    type="text"
                    placeholder={pe.cover_url_placeholder}
                    value={entry.cover_url || ''}
                    onChange={e => onChange('cover_url', e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="pr-editor-labeled-row pr-editor-asset-row">
              <span className="pr-editor-vertical-label">{tg.banner_urls}</span>
              <div className="pr-editor-banner-section">
                {slotField('banners_csv', tg.banner_urls, { preview: true, fullWidth: true, dotClass: 'pr-editor-changed-dot--banner' })}
              </div>
            </div>
          </div>
        </div>

        <div className="pr-editor-section pr-editor-section--classification">
          <div className="pr-editor-labeled-row">
            <span className="pr-editor-vertical-label">{tg.classification}</span>
            <div className="pr-editor-labeled-content">
              <div className="pr-editor-classification-grid">
                {typeField('type', tg.type, true)}
                {formatField('format', tg.format, true)}
                {slotField('genres_csv', tg.genres, { allowed: ALL_GENRES, restrict: true })}
                {slotField('genres_tag_csv', tg.themes_tags)}
                {entry.type === 'game' && slotField('platforms_csv', tg.platforms, { allowed: ALL_PLATFORMS, restrict: true })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
