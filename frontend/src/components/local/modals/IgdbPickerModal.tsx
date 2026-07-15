import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { igdbSearchCandidates, igdbForceByIgdbId, saveGameLink, type LocalGame, type IgdbCandidate } from '../../../lib/tauri';

interface IgdbPickerModalProps {
  game:     LocalGame;
  onClose:  () => void;
  onPicked: () => void;
}

export function IgdbPickerModal({ game, onClose, onPicked }: IgdbPickerModalProps) {
  const [candidates, setCandidates] = useState<IgdbCandidate[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [applying,   setApplying]   = useState<number | null>(null);
  const [searchText, setSearchText] = useState('');
  const searchTimerRef              = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback((query: string) => {
    setLoading(true);
    setError(null);
    igdbSearchCandidates(query)
      .then(r  => { setCandidates(r); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, []);

  useEffect(() => { runSearch(game.name); }, [game.name, runSearch]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchText(val);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => runSearch(val.trim() || game.name), 500);
  };

  const handlePick = async (candidate: IgdbCandidate) => {
    if (!game.app_id) return;
    setApplying(candidate.id);
    try {
      await igdbForceByIgdbId(game.app_id, game.name, candidate.id);
      // Persists the pick as the permanent match for this game — without
      // this, igdbForceByIgdbId only re-downloads the cached cover/banner;
      // the catalog link itself (external_id, used by "Ver en catálogo" and
      // the library) would still resolve through automatic Steam-ID/fuzzy
      // matching on the next scan, which could re-guess wrong again.
      // linkKey must match scan_all_games' own derivation exactly (see
      // platform_scanning.rs): app_id ?? install_path ?? name.
      const linkKey = game.app_id ?? game.install_path ?? game.name;
      await saveGameLink(game.launcher, linkKey, `game:${candidate.id}`).catch(console.error);
      onPicked();
      onClose();
    } catch (e) {
      console.error('igdb force error', e);
      setApplying(null);
    }
  };

  return createPortal(
    <div className="igdb-picker-overlay" onClick={onClose}>
      <div className="igdb-picker-modal" onClick={e => e.stopPropagation()}>
        <div className="igdb-picker-header">
          <span>Seleccionar juego en IGDB</span>
          <button className="igdb-picker-close" onClick={onClose}>✕</button>
        </div>
        <div className="igdb-picker-search-bar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            className="igdb-picker-search-input"
            type="text"
            placeholder={game.name}
            value={searchText}
            onChange={handleSearchChange}
            autoFocus
          />
          {searchText && (
            <button className="igdb-picker-search-clear" onClick={() => { setSearchText(''); runSearch(game.name); }}>✕</button>
          )}
        </div>
        {loading ? (
          <div className="igdb-picker-loading">Buscando...</div>
        ) : error ? (
          <div className="igdb-picker-loading" style={{ color: 'var(--text-danger, #f87171)' }}>Error: {error}</div>
        ) : candidates.length === 0 ? (
          <div className="igdb-picker-loading">Sin resultados</div>
        ) : (
          <div className="igdb-picker-grid">
            {candidates.map(c => (
              <button
                key={c.id}
                className={`igdb-picker-card${applying === c.id ? ' loading' : ''}`}
                onClick={() => handlePick(c)}
                disabled={applying !== null}
              >
                <img src={c.cover_url} alt={c.name} className="igdb-picker-cover" />
                <div className="igdb-picker-info">
                  <span className="igdb-picker-name">{c.name}</span>
                  <span className="igdb-picker-meta">
                    {c.year > 0 ? c.year : '—'}{c.developer ? ` · ${c.developer}` : ''}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
