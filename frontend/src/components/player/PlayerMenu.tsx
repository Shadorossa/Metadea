import { useEffect, useRef } from 'react';
import { Check } from 'lucide-react';

export interface PlayerMenuItem {
  key: string;
  label: string;
  detail?: string;
  selected: boolean;
  onSelect: () => void;
}

interface Props {
  title: string;
  items: PlayerMenuItem[];
  emptyLabel: string;
  onClose: () => void;
}

// Small popover used for audio/subtitle tracks and playback speed. Focus
// moves into the menu on open and Escape/outside click close it.
export function PlayerMenu({ title, items, emptyLabel, onClose }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    root?.querySelector<HTMLButtonElement>('button[aria-checked="true"], button')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (root && !root.contains(event.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [onClose]);

  return (
    <div ref={rootRef} className="player-menu" role="menu" aria-label={title}>
      <div className="player-menu__title">{title}</div>
      {items.length === 0 && <div className="player-menu__empty">{emptyLabel}</div>}
      {items.map(item => (
        <button
          key={item.key}
          type="button"
          role="menuitemradio"
          aria-checked={item.selected}
          className="player-menu__item"
          onClick={() => { item.onSelect(); onClose(); }}
        >
          <span className="player-menu__check" aria-hidden="true">{item.selected && <Check size={14} />}</span>
          <span className="player-menu__label">{item.label}</span>
          {item.detail && <span className="player-menu__detail">{item.detail}</span>}
        </button>
      ))}
    </div>
  );
}
