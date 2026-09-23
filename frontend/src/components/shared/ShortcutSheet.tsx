// The "?" cheat sheet: every binding currently registered in the shortcut
// registry, grouped by context, rendered as key caps. Also reused by the
// Settings › Keyboard shortcuts section (KeyboardShortcutsSection.tsx) via
// ShortcutList, so both surfaces always agree.
import { Fragment, useMemo } from 'react';
import type { Translations } from '../../i18n/index';
import { getT } from '../../i18n/runtime';
import { formatShortcutKeys } from '../../lib/shared/keyboard/shortcut-keys';
import {
  SHORTCUT_CONTEXTS, listActiveShortcuts, shortcutRegistry,
  type ActiveShortcut, type ShortcutContext,
} from '../../lib/shared/keyboard/shortcut-registry';
import { ModalShell } from './ModalShell';
import { useExternalStore } from './hooks/useExternalStore';

/** Resolves a binding's dotted i18n key ('shortcuts.go_home'); falls back to
 *  the key itself so an untranslated binding is still identifiable. */
export function translateShortcutDescription(t: Translations, key: string): string {
  let value: unknown = t;
  for (const part of key.split('.')) {
    value = typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[part] : undefined;
  }
  return typeof value === 'string' ? value : key;
}

const CONTEXT_LABEL_KEY: Record<ShortcutContext, keyof Translations['shortcuts']> = {
  global: 'context_global',
  page: 'context_page',
  modal: 'context_modal',
  player: 'context_player',
};

export function ShortcutKeyCaps({ keys }: { keys: readonly string[] }) {
  return (
    <span className="shortcut-keys">
      {keys.map((spec, specIndex) => (
        <Fragment key={spec}>
          {specIndex > 0 && <span className="shortcut-keys-alt" aria-hidden="true">/</span>}
          <span className="shortcut-combo">
            {formatShortcutKeys(spec, shortcutRegistry.platform).map((cap, capIndex) => (
              <Fragment key={`${spec}-${capIndex}`}>
                {capIndex > 0 && <span className="shortcut-combo-plus" aria-hidden="true">+</span>}
                <kbd className="shortcut-kbd">{cap}</kbd>
              </Fragment>
            ))}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

/** Re-renders whenever a component registers/unregisters bindings. */
export function useActiveShortcuts(): ActiveShortcut[] {
  const version = useExternalStore(shortcutRegistry.version);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => listActiveShortcuts(), [version]);
}

export function ShortcutList({ shortcuts }: { shortcuts: readonly ActiveShortcut[] }) {
  const t = getT();
  const groups = SHORTCUT_CONTEXTS
    .map(context => ({ context, items: shortcuts.filter(s => s.context === context) }))
    .filter(group => group.items.length > 0);

  if (groups.length === 0) {
    return <p className="shortcut-list-empty">{t.shortcuts.sheet_empty}</p>;
  }

  return (
    <div className="shortcut-list">
      {groups.map(group => (
        <section className="shortcut-group" key={group.context}>
          <h4 className="shortcut-group-title">{t.shortcuts[CONTEXT_LABEL_KEY[group.context]]}</h4>
          <ul className="shortcut-rows">
            {group.items.map(item => (
              <li className={`shortcut-row${item.enabled ? '' : ' shortcut-row--disabled'}`} key={`${group.context}:${item.id}`}>
                <span className="shortcut-row-label">{translateShortcutDescription(t, item.description)}</span>
                <ShortcutKeyCaps keys={item.keys} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

interface ShortcutSheetProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutSheet({ open, onClose }: ShortcutSheetProps) {
  const t = getT();
  const shortcuts = useActiveShortcuts();
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      label={t.shortcuts.sheet_title}
      overlayClassName="shortcut-sheet-overlay"
      panelClassName="shortcut-sheet-panel"
    >
      <div className="shortcut-sheet-header">
        <h3 className="shortcut-sheet-title">{t.shortcuts.sheet_title}</h3>
        <button type="button" className="shortcut-sheet-close" onClick={onClose} aria-label={t.auth.close}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <ShortcutList shortcuts={shortcuts} />
      <p className="shortcut-sheet-hint">
        {t.shortcuts.sheet_hint}{' '}
        <a href="/guide#guide-shortcuts" onClick={onClose}>{t.guide.sheet_link}</a>
      </p>
    </ModalShell>
  );
}
