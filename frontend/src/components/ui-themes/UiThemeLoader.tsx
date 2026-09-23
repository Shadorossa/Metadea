// Mounted once in BaseLayout (transition:persist). Keeps the single
// <style id="metadea-ui-theme"> in sync with the active user theme: on
// mount, after every Astro page swap (the new <head> drops it), whenever the
// settings section announces a change, and every 2 s while the "watch for
// changes" dev toggle is on. Also owns the mod+shift+t escape hatch that
// deactivates the theme even when it has broken the layout.
import { useEffect } from 'react';
import { getT } from '../../i18n/runtime';
import { showToast } from '../../lib/dom/toast';
import { formatAppError } from '../../lib/errors/format-error';
import { getActiveUiTheme, readUiThemeCss, setActiveUiTheme } from '../../lib/tauri/ui-themes';
import {
  UI_THEME_WATCH_CHANGED_EVENT,
  emitUiThemeChanged,
  isUiThemeWatchEnabled,
  onUiThemeChanged,
} from '../../lib/ui-themes/ui-theme-events';
import { UI_THEME_WATCH_INTERVAL_MS, createDomStyleTarget, createUiThemeLoader } from '../../lib/ui-themes/ui-theme-loader';
import { useShortcuts } from '../shared/hooks/useShortcuts';

export function UiThemeLoader() {
  useEffect(() => {
    const loader = createUiThemeLoader({
      target: createDomStyleTarget(document),
      getActive: getActiveUiTheme,
      readCss: readUiThemeCss,
    });
    const sync = () => {
      loader.sync().catch(err => console.warn('[UiTheme] sync failed:', err));
    };
    sync();

    const onSwap = () => loader.reapply();
    document.addEventListener('astro:after-swap', onSwap);
    const offChanged = onUiThemeChanged(sync);

    let timer: ReturnType<typeof setInterval> | undefined;
    const applyWatch = () => {
      if (timer) clearInterval(timer);
      timer = isUiThemeWatchEnabled() ? setInterval(sync, UI_THEME_WATCH_INTERVAL_MS) : undefined;
    };
    applyWatch();
    window.addEventListener(UI_THEME_WATCH_CHANGED_EVENT, applyWatch);

    return () => {
      document.removeEventListener('astro:after-swap', onSwap);
      window.removeEventListener(UI_THEME_WATCH_CHANGED_EVENT, applyWatch);
      offChanged();
      if (timer) clearInterval(timer);
    };
  }, []);

  useShortcuts('global', [
    {
      id: 'global.ui_theme_deactivate',
      keys: 'mod+shift+t',
      description: 'shortcuts.ui_theme_deactivate',
      // An escape hatch must work wherever focus happens to be.
      allowInInputs: true,
      handler: () => {
        const t = getT();
        setActiveUiTheme(null)
          .then(() => {
            emitUiThemeChanged(null);
            showToast(t.ui_themes.deactivated_by_shortcut, 'success');
          })
          .catch(err => showToast(formatAppError(err, t), 'error'));
      },
    },
  ]);

  return null;
}
