import { useEffect, useRef } from 'react';
import { TIER_PALETTE, isHexColor } from '../../lib/tier/tier-palette';
import type { Translations } from '../../i18n/types';

// The gear menu of one row: colour (TierMaker palette + custom picker) and
// the row actions. A plain popover: focus moves into it on open, Escape or
// a click outside closes it and focus returns to the gear button.

export type TierRowAction = 'add_above' | 'add_below' | 'move_up' | 'move_down' | 'to_pool' | 'clear' | 'delete';

interface Props {
  color: string;
  isFirst: boolean;
  isLast: boolean;
  hasItems: boolean;
  t: Translations['tier'];
  onColor: (color: string) => void;
  onAction: (action: TierRowAction) => void;
  onClose: () => void;
}

export function TierRowMenu({ color, isFirst, isLast, hasItems, t, onColor, onAction, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('button, input')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      // The gear toggles the menu itself; a pointerdown on it must not
      // close-then-reopen.
      const scope = panelRef.current?.parentElement ?? panelRef.current;
      if (scope && !scope.contains(event.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [onClose]);

  const act = (action: TierRowAction) => { onAction(action); onClose(); };
  const actions: Array<{ action: TierRowAction; label: string; disabled?: boolean; danger?: boolean }> = [
    { action: 'add_above', label: t.row_add_above },
    { action: 'add_below', label: t.row_add_below },
    { action: 'move_up', label: t.row_move_up, disabled: isFirst },
    { action: 'move_down', label: t.row_move_down, disabled: isLast },
    { action: 'to_pool', label: t.row_to_pool, disabled: !hasItems },
    { action: 'clear', label: t.row_clear, disabled: !hasItems, danger: true },
    { action: 'delete', label: t.row_delete, danger: true },
  ];

  return (
    <div
      ref={panelRef}
      className="tier-row-menu"
      role="dialog"
      aria-label={t.row_settings}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
      }}
    >
      <div className="tier-row-menu-section">
        <span className="tier-row-menu-heading">{t.row_color}</span>
        <div className="tier-row-menu-swatches">
          {TIER_PALETTE.map(swatch => (
            <button
              key={swatch}
              type="button"
              className={`tier-swatch${swatch === color.toLowerCase() ? ' tier-swatch--active' : ''}`}
              style={{ background: swatch }}
              aria-label={swatch}
              aria-pressed={swatch === color.toLowerCase()}
              onClick={() => onColor(swatch)}
            />
          ))}
        </div>
        <label className="tier-row-menu-custom">
          <input type="color" value={isHexColor(color) ? color : '#ffffff'} onChange={event => onColor(event.target.value)} />
          <span>{t.row_custom_color}</span>
        </label>
      </div>
      <div className="tier-row-menu-section" role="group">
        {actions.map(({ action, label, disabled, danger }) => (
          <button
            key={action}
            type="button"
            className={`tier-row-menu-item${danger ? ' tier-row-menu-item--danger' : ''}`}
            disabled={disabled}
            onClick={() => act(action)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
