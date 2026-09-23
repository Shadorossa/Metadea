import React, { useEffect, useState } from 'react';
import { ModalShell } from '../shared/ModalShell';
import { useDebouncedCallback } from '../shared/hooks/useDebouncedCallback';
import { raSearchGames, type RaGameListEntry } from '../../lib/tauri/retro-achievements';
import { formatAppError } from '../../lib/errors/format-error';
import { getT } from '../../i18n/runtime';

interface RetroAchievementsLinkPickerProps {
  consoleId: number;
  // Pre-filled query (the entry's title).
  initialQuery: string;
  onClose: () => void;
  onPicked: (entry: RaGameListEntry) => void;
}

// Minimal manual picker: searches the console's RA game list (cached in
// Rust for a day) and hands the chosen entry back.
export function RetroAchievementsLinkPicker({ consoleId, initialQuery, onClose, onPicked }: RetroAchievementsLinkPickerProps) {
  const t = getT();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<RaGameListEntry[]>([]);
  const [loading, setLoading] = useState(initialQuery.trim() !== '');
  const [error, setError] = useState<string | null>(null);

  const runSearch = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setResults(await raSearchGames(consoleId, trimmed));
    } catch (err) {
      setError(formatAppError(err, t));
      setResults([]);
    } finally {
      setLoading(false);
    }
  };
  const [debouncedSearch] = useDebouncedCallback(runSearch, 300);

  // The first search runs with the entry's own title, no debounce; the
  // initial `loading` already reflects it so nothing is set synchronously.
  useEffect(() => {
    const trimmed = initialQuery.trim();
    if (!trimmed) return;
    let cancelled = false;
    raSearchGames(consoleId, trimmed).then(
      found => { if (!cancelled) { setResults(found); setLoading(false); } },
      err => { if (!cancelled) { setError(formatAppError(err, getT())); setResults([]); setLoading(false); } },
    );
    return () => { cancelled = true; };
  }, [consoleId, initialQuery]);

  return (
    <ModalShell
      onClose={onClose}
      label={t.retro_achievements.link_picker_title}
      overlayClassName="ra-picker-overlay"
      panelClassName="ra-picker-modal"
    >
      <div className="ra-picker-header">
        <span>{t.retro_achievements.link_picker_title}</span>
        <button type="button" className="ra-picker-close" onClick={onClose} aria-label={t.local.close_panel}>✕</button>
      </div>
      <div className="ra-picker-search-bar">
        <input
          className="ra-picker-search-input"
          type="text"
          value={query}
          placeholder={t.retro_achievements.link_picker_placeholder}
          aria-label={t.retro_achievements.link_picker_placeholder}
          onChange={event => { setQuery(event.target.value); debouncedSearch(event.target.value); }}
          autoFocus
        />
      </div>
      {loading ? (
        <p className="ra-picker-status">{t.local.searching_ellipsis}</p>
      ) : error ? (
        <p className="ra-picker-status ra-picker-status--error">{error}</p>
      ) : results.length === 0 ? (
        <p className="ra-picker-status">{t.local.no_results}</p>
      ) : (
        <ul className="ra-picker-list">
          {results.map(entry => (
            <li key={entry.id}>
              <button type="button" className="ra-picker-card" onClick={() => onPicked(entry)}>
                {entry.iconUrl ? (
                  <img src={entry.iconUrl} alt="" className="ra-picker-icon" loading="lazy" />
                ) : (
                  <span className="ra-picker-icon ra-picker-icon--placeholder" aria-hidden="true" />
                )}
                <span className="ra-picker-info">
                  <span className="ra-picker-name">{entry.title}</span>
                  <span className="ra-picker-meta">
                    {t.retro_achievements.picker_meta
                      .replace('{count}', String(entry.numAchievements))
                      .replace('{points}', String(entry.points))}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </ModalShell>
  );
}
