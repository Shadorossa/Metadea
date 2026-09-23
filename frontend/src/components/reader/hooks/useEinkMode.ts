import { useCallback, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useShortcuts } from '../../shared/hooks/useShortcuts';
import {
  buildEinkFilter,
  einkChromeVars,
  einkPalette,
  normalizeEinkPreferences,
  serializeEinkFilter,
  type EinkPalette,
  type EinkPreferences,
  type EinkReaderKind,
} from '../../../lib/reader/eink-mode';
import { readEinkPreferences, saveEinkPreferences } from '../../../lib/storage/reader-eink';

export interface EinkMode {
  prefs: EinkPreferences;
  update: (patch: Partial<EinkPreferences>) => void;
  toggle: () => void;
  palette: EinkPalette;
  /** Id of the page filter, unique per reader instance (and per shadow root). */
  filterId: string;
  /** `<filter>` markup for the inline `<defs>` (only rendered while enabled). */
  filterMarkup: string;
  /** CSS custom properties for the reader panel while E-Ink is on. */
  panelStyle: CSSProperties | undefined;
}

// E-Ink / paper mode state of one reader: its persisted preferences (one
// blob per reader type), the palette and filter derived from them, and the
// `E` shortcut. Registered in the modal context so it shadows a media
// page's own `E` (open the editor) while the reader is on top.
export function useEinkMode(kind: EinkReaderKind): EinkMode {
  const [prefs, setPrefs] = useState<EinkPreferences>(() => readEinkPreferences(kind));
  const prefsRef = useRef(prefs);

  const update = useCallback((patch: Partial<EinkPreferences>) => {
    const next = normalizeEinkPreferences({ ...prefsRef.current, ...patch });
    prefsRef.current = next;
    setPrefs(next);
    saveEinkPreferences(kind, next);
  }, [kind]);
  const toggle = useCallback(() => update({ enabled: !prefsRef.current.enabled }), [update]);

  useShortcuts('modal', [{
    id: 'reader.toggle_eink',
    keys: 'e',
    description: 'shortcuts.reader_toggle_eink',
    handler: toggle,
  }]);

  const reactId = useId();
  const filterId = `eink-page-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const palette = useMemo(() => einkPalette(prefs.warmth, prefs.brightness), [prefs.warmth, prefs.brightness]);
  const filterMarkup = useMemo(() => serializeEinkFilter(buildEinkFilter({ id: filterId, palette })), [filterId, palette]);
  const panelStyle = useMemo<CSSProperties | undefined>(
    () => (prefs.enabled ? ({ ...einkChromeVars(palette), '--eink-filter': `url(#${filterId})` } as CSSProperties) : undefined),
    [prefs.enabled, palette, filterId],
  );

  return { prefs, update, toggle, palette, filterId, filterMarkup, panelStyle };
}
