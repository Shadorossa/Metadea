// Mounted once in BaseLayout (transition:persist): installs the single
// window keydown dispatcher, owns the app-wide `global` bindings and hosts
// the "?" shortcut sheet. Page-specific bindings register themselves through
// useShortcuts from whatever island owns them (LibrarySection, SearchIsland,
// QuickSearchOverlay…).
import { useCallback, useEffect, useState } from 'react';
import { installShortcutDispatcher, type ShortcutBinding } from '../../lib/shared/keyboard/shortcut-registry';
import { useShortcuts } from './hooks/useShortcuts';
import { ShortcutSheet } from './ShortcutSheet';

export const OPEN_QUICK_SEARCH_EVENT = 'metadea:open-quick-search';
/** Settings › Keyboard shortcuts dispatches this to open the sheet. */
export const TOGGLE_SHORTCUT_SHEET_EVENT = 'metadea:toggle-shortcut-sheet';

// mod+1 … mod+6, in the navbar's left-to-right order (see Navbar.astro).
const NAV_ROUTES: ReadonlyArray<{ id: string; description: string; href: string }> = [
  { id: 'global.go_home', description: 'shortcuts.go_home', href: '/home' },
  { id: 'global.go_local', description: 'shortcuts.go_local', href: '/local' },
  { id: 'global.go_profile', description: 'shortcuts.go_profile', href: '/profile' },
  { id: 'global.go_search', description: 'shortcuts.go_search', href: '/search' },
  { id: 'global.go_notifications', description: 'shortcuts.go_notifications', href: '/notifications' },
  { id: 'global.go_settings', description: 'shortcuts.go_settings', href: '/settings' },
];

async function navigateTo(href: string): Promise<void> {
  const { navigate } = await import('astro:transitions/client');
  navigate(href);
}

export function GlobalShortcuts() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const toggleSheet = useCallback(() => setSheetOpen(open => !open), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  useEffect(() => installShortcutDispatcher(), []);

  useEffect(() => {
    window.addEventListener(TOGGLE_SHORTCUT_SHEET_EVENT, toggleSheet);
    return () => window.removeEventListener(TOGGLE_SHORTCUT_SHEET_EVENT, toggleSheet);
  }, [toggleSheet]);

  const bindings: ShortcutBinding[] = [
    {
      id: 'global.open_quick_search',
      keys: ['mod+k', '/'],
      description: 'shortcuts.open_quick_search',
      handler: () => window.dispatchEvent(new CustomEvent(OPEN_QUICK_SEARCH_EVENT)),
    },
    ...NAV_ROUTES.map((route, index) => ({
      id: route.id,
      // Settings also answers to the conventional mod+, — one sheet row.
      keys: route.href === '/settings' ? [`mod+${index + 1}`, 'mod+,'] : `mod+${index + 1}`,
      description: route.description,
      handler: () => { navigateTo(route.href); },
    })),
    {
      id: 'global.history_back',
      keys: 'alt+arrowleft',
      description: 'shortcuts.history_back',
      handler: () => window.history.back(),
    },
    {
      id: 'global.history_forward',
      keys: 'alt+arrowright',
      description: 'shortcuts.history_forward',
      handler: () => window.history.forward(),
    },
    {
      id: 'global.toggle_sheet',
      keys: '?',
      description: 'shortcuts.toggle_sheet',
      handler: toggleSheet,
    },
  ];
  useShortcuts('global', bindings);

  return <ShortcutSheet open={sheetOpen} onClose={closeSheet} />;
}
