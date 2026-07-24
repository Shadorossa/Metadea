import React, { useState } from 'react';
import { STAR_PATH } from '../../lib/media/constants';
import { getActiveRatingSystem, ratingToEmoji, type RatingSystem } from '../../lib/media/rating-utils';
import { getT } from '../../i18n/client';

interface Props {
  rating: number;
  onChange: (value: number) => void;
  system?: RatingSystem;
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

export function RatingInput({ rating, onChange, system: systemProp }: Props) {
  const system = systemProp ?? getActiveRatingSystem();

  if (system === '10-dec') {
    return (
      <input type="number" className="me-header-field-input" min={0} max={10} step={0.01}
        value={rating || ''}
        onChange={e => { let v = parseFloat(e.target.value) || 0; if (v > 10) v = 10; onChange(v); }}
        placeholder="0.00"
        style={{ width: '65px' }} />
    );
  }

  if (system === '10') {
    return (
      <input type="number" className="me-header-field-input" min={0} max={10} step={1}
        value={rating ? Math.round(rating) : ''}
        onChange={e => { let v = parseInt(e.target.value, 10) || 0; if (v > 10) v = 10; onChange(v); }}
        placeholder="0"
        style={{ width: '50px' }} />
    );
  }

  if (system === '3-emoji') {
    return <EmojiRating rating={rating} onChange={onChange} />;
  }

  return <StarRating rating={rating} onChange={onChange} />;
}
