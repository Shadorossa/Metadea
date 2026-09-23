import React from 'react';
import { getT } from '../../../i18n/runtime';
import type { SortMode } from '../../../lib/local/catalog-game-linking';

// The launcher/platform section's own sort dropdown — identical in
// Videojuegos' grid and in the media sections' platform rows, which each
// kept their own copy of this markup.
export function SortModeSelect({ value, onChange }: { value: SortMode; onChange: (mode: SortMode) => void }) {
  const t = getT().local;
  return (
    <select
      className="local-sort-select"
      value={value}
      onChange={e => onChange(e.target.value as SortMode)}
      title={t.sort_title}
    >
      <option value="alpha">{t.sort_alpha}</option>
      <option value="lastPlayed">{t.sort_last_played}</option>
      <option value="playtime">{t.sort_playtime}</option>
    </select>
  );
}
