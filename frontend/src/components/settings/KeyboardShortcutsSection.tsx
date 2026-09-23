// Settings › Preferencias › Keyboard shortcuts: read-only listing of every
// binding registered right now (the global set on this page), plus a button
// that opens the same "?" sheet. Bindings are not customisable yet.
import { getT } from '../../i18n/runtime';
import { TOGGLE_SHORTCUT_SHEET_EVENT } from '../shared/GlobalShortcuts';
import { ShortcutList, useActiveShortcuts } from '../shared/ShortcutSheet';
import { useHydrated } from '../shared/hooks/useHydrated';

export function KeyboardShortcutsSection() {
  const t = getT().shortcuts;
  const shortcuts = useActiveShortcuts();
  // The registry, the locale and the platform's key caps only exist in the
  // client, so the server pass (and the hydration pass) render a fixed-size
  // placeholder and the real list fills in right after hydration.
  const hydrated = useHydrated();
  if (!hydrated) return <div className="settings-shortcuts-pending" aria-hidden="true" />;
  return (
    <>
      <p className="settings-hint">{t.settings_hint}</p>
      <ShortcutList shortcuts={shortcuts} />
      <div className="settings-shortcuts-actions">
        <button
          type="button"
          className="settings-shortcuts-open-btn"
          onClick={() => window.dispatchEvent(new CustomEvent(TOGGLE_SHORTCUT_SHEET_EVENT))}
        >
          {t.settings_open_sheet}
        </button>
      </div>
    </>
  );
}
