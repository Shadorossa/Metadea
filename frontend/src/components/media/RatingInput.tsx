import React, { useState } from 'react';
import { useKeyedState } from '../shared/hooks/useKeyedState';
import { STAR_PATH } from '../../lib/media/constants';
import { getActiveRatingSystem, ratingToEmoji, type RatingSystem } from '../../lib/media/rating-utils';
import { getT } from '../../i18n/runtime';

interface Props {
  rating: number;
  onChange: (value: number) => void;
  system?: RatingSystem;
  // Only meaningful for '10-dec'/'10' — rating_2's own custom range
  // (Settings > Preferencias), never the primary rating's fixed 0-10.
  min?: number;
  max?: number;
}

function EmojiRating({ rating, onChange }: { rating: number; onChange: (v: number) => void }) {
  const { emoji: activeEmoji } = ratingToEmoji(rating);
  const te = getT().media.editor;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <button type="button" onClick={() => onChange(rating === 3 ? 0 : 3)}
        style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', opacity: activeEmoji === '😞' ? 1 : 0.4, padding: '2px' }}
        title={te.rating_sad}>😞</button>
      <button type="button" onClick={() => onChange(rating === 5.5 ? 0 : 5.5)}
        style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', opacity: activeEmoji === '😐' ? 1 : 0.4, padding: '2px' }}
        title={te.rating_neutral}>😐</button>
      <button type="button" onClick={() => onChange(rating === 8.5 ? 0 : 8.5)}
        style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', opacity: activeEmoji === '😊' ? 1 : 0.4, padding: '2px' }}
        title={te.rating_happy}>😊</button>
    </div>
  );
}

function StarRating({ rating, onChange }: { rating: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const display = hover ?? rating;
  return (
    <div className="me-header-stars" onMouseLeave={() => setHover(null)}>
      {[1, 2, 3, 4, 5].map(v => {
        const isFull = display >= v * 2;
        const isHalf = !isFull && display >= v * 2 - 1;
        return (
          <div key={v} className="me-header-star-wrap">
            <svg className="me-header-star me-header-star--bg" viewBox="0 0 24 24">
              <path d={STAR_PATH} />
            </svg>
            <div className="me-header-star-fill" style={{ width: isFull ? '100%' : isHalf ? '50%' : '0%' }}>
              <svg className="me-header-star me-header-star--fg" viewBox="0 0 24 24">
                <path d={STAR_PATH} />
              </svg>
            </div>
            <button type="button" className="me-header-star-zone me-header-star-zone--left"
              onMouseEnter={() => setHover(v * 2 - 1)}
              onClick={() => onChange(rating === v * 2 - 1 ? 0 : v * 2 - 1)} />
            <button type="button" className="me-header-star-zone me-header-star-zone--right"
              onMouseEnter={() => setHover(v * 2)}
              onClick={() => onChange(rating === v * 2 ? 0 : v * 2)} />
          </div>
        );
      })}
    </div>
  );
}

// Keeps its own text buffer instead of mirroring `rating` on every keystroke,
// so clearing the field to type a new value doesn't get immediately snapped
// back to min/max mid-edit. The value only gets parsed/clamped and reported
// to onChange once the field loses focus (or the user types something
// already-valid, so onChange fires as they go for e.g. keyboard steppers).
function NumberRatingInput({ rating, onChange, min, max, decimals }: {
  rating: number; onChange: (v: number) => void; min: number; max: number; decimals: boolean;
}) {
  const format = (v: number) => decimals ? v.toFixed(2) : String(Math.round(v));
  const [focused, setFocused] = useState(false);
  // Resynced from `rating` only while unfocused — with focus the key stays
  // put, so the user's own buffer isn't overwritten mid-edit.
  const [text, setText] = useKeyedState(focused ? 'focused' : `rating:${rating}`, format(rating));

  return (
    <input type="number" className="me-header-field-input" min={min} max={max} step={decimals ? 0.01 : 1}
      value={text}
      onFocus={() => setFocused(true)}
      onChange={e => {
        setText(e.target.value);
        const v = decimals ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
        if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
      }}
      onBlur={() => {
        setFocused(false);
        let v = decimals ? parseFloat(text) : parseInt(text, 10);
        if (!Number.isFinite(v)) v = min;
        v = Math.min(max, Math.max(min, v));
        onChange(v);
        setText(format(v));
      }}
      placeholder={decimals ? '0.00' : '0'}
      style={{ width: decimals ? '65px' : '50px' }} />
  );
}

export function RatingInput({ rating, onChange, system: systemProp, min = 0, max = 10 }: Props) {
  const system = systemProp ?? getActiveRatingSystem();

  if (system === '10-dec') {
    return <NumberRatingInput rating={rating} onChange={onChange} min={min} max={max} decimals />;
  }

  if (system === '10') {
    return <NumberRatingInput rating={rating} onChange={onChange} min={min} max={max} decimals={false} />;
  }

  if (system === '3-emoji') {
    return <EmojiRating rating={rating} onChange={onChange} />;
  }

  return <StarRating rating={rating} onChange={onChange} />;
}
