// Settings › Preferencias › Keyboard shortcuts: read-only listing of every
// binding registered right now (the global set on this page). Bindings are
// not customisable yet; "?" opens the full sheet anywhere.
import { ShortcutList, useActiveShortcuts } from '../shared/ShortcutSheet';
import { useHydrated } from '../shared/hooks/useHydrated';

export function KeyboardShortcutsSection() {
  const shortcuts = useActiveShortcuts();
  // The registry, the locale and the platform's key caps only exist in the
  // client, so the server pass (and the hydration pass) render a fixed-size
  // placeholder and the real list fills in right after hydration.
  const hydrated = useHydrated();
  if (!hydrated) return <div className="settings-shortcuts-pending" aria-hidden="true" />;
  return <ShortcutList shortcuts={shortcuts} hideGlobalTitle />;
}
