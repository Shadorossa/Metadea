import React from 'react';
import { ArrowDownWideNarrow, ArrowUpWideNarrow } from 'lucide-react';
import { getT } from '../../../i18n/runtime';
import type { SortDirection, SortMode } from '../../../lib/local/catalog-game-linking';

// The launcher/platform section's own sort dropdown — identical in
// Videojuegos' grid and in the media sections' platform rows, which each
// kept their own copy of this markup.
export function SortModeSelect({ value, onChange, direction, onDirectionChange }: {
  value: SortMode;
  onChange: (mode: SortMode) => void;
  direction: SortDirection;
  onDirectionChange: (direction: SortDirection) => void;
}) {
  const t = getT().local;
  const DirectionIcon = direction === 'descending' ? ArrowDownWideNarrow : ArrowUpWideNarrow;
  return (
    <div className="local-sort-control">
      <button
        type="button"
        className="local-sort-direction-btn"
        onClick={() => onDirectionChange(direction === 'ascending' ? 'descending' : 'ascending')}
        title={direction === 'ascending' ? t.sort_ascending : t.sort_descending}
        aria-label={direction === 'ascending' ? t.sort_ascending : t.sort_descending}
      >
        <DirectionIcon size={14} aria-hidden="true" />
      </button>
      <select
        className="local-sort-select"
        value={value}
        onChange={e => onChange(e.target.value as SortMode)}
        title={t.sort_title}
      >
        <option value="alpha">{t.sort_alpha}</option>
        <option value="lastPlayed">{t.sort_last_played}</option>
        <option value="playtime">{t.sort_playtime}</option>
        <option value="shortestToBeat">{t.sort_shortest_to_beat}</option>
      </select>
    </div>
  );
}
