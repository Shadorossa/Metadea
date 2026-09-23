// Settings › Plugins › UI themes (skins; PluginsTab.astro): lists the folders under
// <app data>/ui_themes, activates/deactivates one, opens the folder, drops
// the starter theme in and toggles the dev-loop watcher. The loader itself
// lives in UiThemeLoader.tsx (BaseLayout); this island only talks to Rust
// and announces changes through lib/ui-themes/ui-theme-events.
import { useEffect, useState } from 'react';
import { getT } from '../../i18n/runtime';
import { useHydrated } from '../shared/hooks/useHydrated';
import type { Translations } from '../../i18n/types';
import { showToast } from '../../lib/dom/toast';
import { formatAppError } from '../../lib/errors/format-error';
import { wrapAssetUrl } from '../../lib/tauri/bridge';
import {
  exportUiThemeStarter,
  getActiveUiTheme,
  listUiThemes,
  openUiThemesFolder,
  setActiveUiTheme,
  type UiThemeSummary,
} from '../../lib/tauri/ui-themes';
import { formatShortcutKeys } from '../../lib/shared/keyboard/shortcut-keys';
import { shortcutRegistry } from '../../lib/shared/keyboard/shortcut-registry';
import { emitUiThemeChanged, isUiThemeWatchEnabled, setUiThemeWatchEnabled } from '../../lib/ui-themes/ui-theme-events';

/** Same combo UiThemeLoader registers as `global.ui_theme_deactivate`. */
export const UI_THEME_DEACTIVATE_SHORTCUT = 'mod+shift+t';

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);
}

interface ThemeCardProps {
  theme: UiThemeSummary;
  active: boolean;
  busy: boolean;
  t: Translations;
  onActivate: (id: string) => void;
  onDeactivate: () => void;
}

function ThemeCard({ theme, active, busy, t, onActivate, onDeactivate }: ThemeCardProps) {
  const tt = t.ui_themes;
  const manifest = theme.manifest;
  const name = manifest?.name ?? theme.id;
  return (
    <li className={`ui-theme-card${active ? ' ui-theme-card--active' : ''}${theme.error ? ' ui-theme-card--broken' : ''}`} data-ui-theme-id={theme.id}>
      <div className="ui-theme-card-preview" aria-hidden={theme.previewPath ? undefined : true}>
        {theme.previewPath
          ? <img src={wrapAssetUrl(theme.previewPath)} alt={fill(tt.preview_alt, { name })} loading="lazy" />
          : <span className="ui-theme-card-preview-placeholder">{name.slice(0, 2).toUpperCase()}</span>}
      </div>
      <div className="ui-theme-card-body">
        <div className="ui-theme-card-heading">
          <span className="ui-theme-card-name">{name}</span>
          {manifest && <span className="ui-theme-card-version">v{manifest.version}</span>}
          {active && <span className="ui-theme-badge ui-theme-badge--active">{tt.active_badge}</span>}
          {theme.tier && (
            <span className={`ui-theme-badge ui-theme-badge--${theme.tier}`}>
              {theme.tier === 'full' ? tt.tier_full : tt.tier_variables}
            </span>
          )}
        </div>
        {manifest && <p className="ui-theme-card-author">{fill(tt.by_author, { author: manifest.author })}</p>}
        {manifest?.description && <p className="ui-theme-card-description">{manifest.description}</p>}
        {theme.error && (
          <p className="ui-theme-card-error" role="alert">
            <strong>{tt.manifest_error}</strong> {formatAppError(theme.error, t)}
          </p>
        )}
        <div className="ui-theme-card-actions">
          {active ? (
            <button type="button" className="btn btn--sm btn--secondary" disabled={busy} onClick={onDeactivate}>{tt.deactivate}</button>
          ) : (
            <button type="button" className="btn btn--sm btn--primary" disabled={busy || !!theme.error} onClick={() => onActivate(theme.id)}>{tt.activate}</button>
          )}
        </div>
      </div>
    </li>
  );
}

export function UiThemesSection() {
  const t = getT();
  const tt = t.ui_themes;
  const [themes, setThemes] = useState<UiThemeSummary[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [watch, setWatch] = useState(false);
  // Bumped by "Reload" and after creating the starter; the effect below owns
  // every read so there is no memoised callback for the compiler to reject.
  const [refreshKey, setRefreshKey] = useState(0);
  const reload = () => setRefreshKey(key => key + 1);
  // Locale and platform key caps are client-only: server and hydration passes
  // render a size-reserving placeholder instead of English text.
  const hydrated = useHydrated();

  useEffect(() => {
    let alive = true;
    // The persisted toggle is read here rather than in a useState initialiser
    // so the server-rendered (unchecked) markup and the first client render agree.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from localStorage
    setWatch(isUiThemeWatchEnabled());
    Promise.all([listUiThemes(), getActiveUiTheme()])
      .then(([list, active]) => {
        if (!alive) return;
        setThemes(list);
        setActiveId(active);
      })
      .catch(err => {
        if (!alive) return;
        setThemes([]);
        showToast(formatAppError(err, getT()), 'error');
      });
    return () => { alive = false; };
  }, [refreshKey]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      showToast(formatAppError(err, t), 'error');
    } finally {
      setBusy(false);
    }
  };

  const activate = (id: string) => run(async () => {
    await setActiveUiTheme(id);
    setActiveId(id);
    emitUiThemeChanged(id);
    showToast(tt.activated, 'success');
  });

  const deactivate = () => run(async () => {
    await setActiveUiTheme(null);
    setActiveId(null);
    emitUiThemeChanged(null);
    showToast(tt.deactivated, 'success');
  });

  const createStarter = () => run(async () => {
    const id = await exportUiThemeStarter();
    showToast(fill(tt.starter_created, { id }), 'success');
    reload();
  });

  const openFolder = () => run(() => openUiThemesFolder());

  const toggleWatch = (enabled: boolean) => {
    setWatch(enabled);
    setUiThemeWatchEnabled(enabled);
  };

  if (!hydrated) return <div className="ui-themes-section ui-themes-section--pending" aria-hidden="true" />;

  return (
    <div className="ui-themes-section" data-ui-hook="ui-themes-section">
      <p className="settings-hint">{tt.intro}</p>
      <p className="ui-themes-warning" role="note">
        {fill(tt.warning_full_css, { shortcut: formatShortcutKeys(UI_THEME_DEACTIVATE_SHORTCUT, shortcutRegistry.platform).join('+') })}
      </p>

      <div className="ui-themes-toolbar">
        <button type="button" className="btn btn--sm btn--secondary" disabled={busy} onClick={openFolder}>{tt.open_folder}</button>
        <button type="button" className="btn btn--sm btn--secondary" disabled={busy} onClick={createStarter}>{tt.create_starter}</button>
        <button type="button" className="btn btn--sm btn--ghost" disabled={busy} onClick={reload}>{tt.reload}</button>
        <label className="ui-themes-watch">
          <input type="checkbox" className="settings-checkbox" checked={watch} onChange={e => toggleWatch(e.target.checked)} />
          <span>{tt.watch_label}</span>
        </label>
      </div>

      {themes === null ? (
        <p className="settings-hint">{tt.loading}</p>
      ) : themes.length === 0 ? (
        <p className="settings-hint ui-themes-empty">{tt.empty}</p>
      ) : (
        <ul className="ui-theme-list">
          {themes.map(theme => (
            <ThemeCard
              key={theme.folder}
              theme={theme}
              active={theme.id === activeId}
              busy={busy}
              t={t}
              onActivate={activate}
              onDeactivate={deactivate}
            />
          ))}
        </ul>
      )}

      <p className="settings-hint">{tt.docs_hint}</p>
    </div>
  );
}
