import { useState } from 'react';
import type { CharacterStrings } from '../../../lib/character/character-stat-labels';
import { splitStatValue, stripTags, type CharacterStatRow } from '../../../lib/character/character-stats';
import { sanitizeStatValue } from '../../../lib/shared/text/sanitize-html';
import type { CharacterSpoilerView } from './useCharacterSpoilers';
import { SpoilerInline } from '../../spoilers/SpoilerShield';

// Stat values are inline fragments of third-party biography markup (bold,
// links, spoilers) — they go through sanitizeStatValue, never raw.
function StatValueContent({ raw }: { raw: string }) {
  const { main, sub } = splitStatValue(raw);
  return (
    <>
      <div className="media-stat-val-main" dangerouslySetInnerHTML={{ __html: sanitizeStatValue(main) }} />
      {sub && <div className="media-stat-val-sub" dangerouslySetInnerHTML={{ __html: sanitizeStatValue(sub) }} />}
    </>
  );
}

interface StatSpoiler {
  hidden: boolean;
  pending: boolean;
  onReveal: () => void;
}

function CharacterStatItem({ label, items, t, spoiler }: { label: string; items: string[]; t: CharacterStrings; spoiler?: StatSpoiler }) {
  const [index, setIndex] = useState(0);
  const isCarousel = items.length > 1;
  const step = (delta: number) => setIndex(i => (i + delta + items.length) % items.length);

  return (
    <div className="media-stat-item">
      <div className="media-stat-main-row">
        <span className="media-stat-label">{label}</span>
        <div className={`media-stat-value${spoiler?.pending ? ' spoiler-shield-pending' : ''}`}>
          {spoiler?.hidden ? (
            // Status, fate, affiliations... of a followed franchise: the
            // label stays, the value waits for a click.
            <SpoilerInline hidden onReveal={spoiler.onReveal} />
          ) : isCarousel ? (
            <div className="media-stat-carousel">
              <button type="button" className="media-stat-carousel-btn media-stat-carousel-prev" title={t.pagination_prev} aria-label={t.pagination_prev} onClick={() => step(-1)}>‹</button>
              <div className="media-stat-carousel-items">
                {items.map((val, idx) => (
                  <div
                    key={idx}
                    className={`media-stat-carousel-item ${idx === index ? 'active' : ''}`}
                    style={idx === index ? undefined : { display: 'none' }}
                    title={stripTags(val)}
                  >
                    <StatValueContent raw={val} />
                  </div>
                ))}
              </div>
              <button type="button" className="media-stat-carousel-btn media-stat-carousel-next" title={t.pagination_next} aria-label={t.pagination_next} onClick={() => step(1)}>›</button>
            </div>
          ) : (
            <StatValueContent raw={items[0]} />
          )}
        </div>
      </div>
      <div className="media-stat-divider-row">
        <div className="media-stat-divider-line"></div>
        {isCarousel && !spoiler?.hidden && <span className="media-stat-carousel-count">({index + 1}/{items.length})</span>}
      </div>
    </div>
  );
}

export function CharacterStatsList({ rows, t, spoiler }: { rows: CharacterStatRow[]; t: CharacterStrings; spoiler?: CharacterSpoilerView | null }) {
  const statSpoiler = (label: string, items: string[]): StatSpoiler | undefined => spoiler
    ? { hidden: spoiler.isStatHidden(label, items), pending: spoiler.pending, onReveal: () => spoiler.revealStat(label) }
    : undefined;
  return (
    <div className="media-stats-list" id="char-stats-list" style={{ display: rows.length > 0 ? 'block' : 'none' }}>
      {rows.map((row, idx) => row.kind === 'header'
        ? <div key={idx} className="media-stat-section-header">{row.label}</div>
        : <CharacterStatItem key={idx} label={row.label} items={row.items} t={t} spoiler={statSpoiler(row.label, row.items)} />)}
    </div>
  );
}
