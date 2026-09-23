import { useEffect, useRef, type CSSProperties, type WheelEvent } from 'react';
import { Heart, Monitor } from 'lucide-react';
import type { BigPictureItem } from '../../lib/big-picture/categories';
import { CoverImage } from '../shared/CoverImage';

// Tiles kept mounted either side of the focus: the ones on the left slide
// out of view, the ones on the right fill the widest screen.
const TILES_BEFORE = 2;
const TILES_AFTER = 12;

interface BigPictureShelfProps {
  items: BigPictureItem[];
  focusIndex: number;
  /** Move real DOM focus onto the focused tile (browse layer on top). */
  domFocus: boolean;
  onTileClick: (index: number) => void;
  onWheelStep: (step: 1 | -1) => void;
  emptyLabel: string;
  favoriteLabel: string;
}

// The PS5 skin's game row (inspired by PS5ish — see big-picture-skin.ts):
// one line of square tiles with the focused one anchored at the left,
// larger, outlined, and its title beside it. Each tile's place is a pure
// function of its distance to the focus, written as CSS variables
// (--slot, --after) that big-picture-ps5.css turns into a transform, so
// moving focus is a single springy transform transition per tile.
export function BigPictureShelf({
  items, focusIndex, domFocus, onTileClick, onWheelStep, emptyLabel, favoriteLabel,
}: BigPictureShelfProps) {
  const focusedRef = useRef<HTMLButtonElement>(null);
  const focused = items[focusIndex] ?? null;

  useEffect(() => {
    if (domFocus) focusedRef.current?.focus({ preventScroll: true });
  }, [domFocus, focusIndex, items]);

  const lastWheel = useRef(0);
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const now = performance.now();
    if (Math.abs(delta) < 4 || now - lastWheel.current < 120) return;
    lastWheel.current = now;
    onWheelStep(delta > 0 ? 1 : -1);
  };

  const first = Math.max(0, focusIndex - TILES_BEFORE);
  const visible = items.slice(first, focusIndex + TILES_AFTER + 1);

  return (
    <div className={`bp-shelf${items.length === 0 ? ' bp-shelf--empty' : ''}`} onWheel={onWheel}>
      {items.length === 0 && <p>{emptyLabel}</p>}
      <div className="bp-shelf-track">
        {visible.map((item, i) => {
          const index = first + i;
          const offset = index - focusIndex;
          const isFocused = offset === 0;
          const progress = item.progress?.total ? Math.min(1, item.progress.current / item.progress.total) : null;
          const place = { '--slot': offset > 0 ? offset - 1 : offset, '--after': offset > 0 ? 1 : 0 } as CSSProperties;
          return (
            <button
              key={item.key}
              ref={isFocused ? focusedRef : undefined}
              type="button"
              className={`bp-tile${isFocused ? ' is-focused' : ''}${offset < 0 ? ' is-before' : ''}`}
              style={place}
              aria-label={item.title}
              aria-current={isFocused ? 'true' : undefined}
              tabIndex={isFocused ? 0 : -1}
              onClick={() => onTileClick(index)}
            >
              <span className="bp-tile-art">
                {item.cover
                  ? <CoverImage externalId={item.externalId} src={item.cover} alt="" loading={offset <= 8 ? 'eager' : 'lazy'} decoding="async" draggable={false} />
                  : <span className="bp-tile-placeholder"><Monitor size={32} aria-hidden="true" /><span>{item.title}</span></span>}
                {item.favorite && <span className="bp-tile-fav" title={favoriteLabel}><Heart size={14} fill="currentColor" aria-hidden="true" /></span>}
                {progress !== null && <span className="bp-card-progress"><span style={{ transform: `scaleX(${progress})` }} /></span>}
              </span>
            </button>
          );
        })}
        {focused && <p className="bp-shelf-label" key={focused.key} aria-hidden="true">{focused.title}</p>}
      </div>
    </div>
  );
}
