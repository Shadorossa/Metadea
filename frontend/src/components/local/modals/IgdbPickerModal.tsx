import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  igdbSearchCandidates, igdbForceByIgdbId, saveGameLink, getCatalogEntry, saveCatalogEntry,
  type LocalGame, type IgdbCandidate, type MediaCatalogEntry,
} from '../../../lib/tauri';
import { getT } from '../../../i18n/client';
import { useDebouncedCallback } from '../../../lib/shared/useDebouncedCallback';

interface IgdbPickerModalProps {
  game:     LocalGame;
  onClose:  () => void;
  // Carries the pick back up (not just "something changed") so callers can
  // optimistically reflect the new name/external_id everywhere this game
  // shows up (grid cards, sections, ...) immediately — saveGameLink only
  // ever touches local_game_links, and a freshly-picked IGDB game usually
  // has no media_catalog row yet at all (that only gets created by visiting
  // its own /media page), so there's nothing a plain "refetch the catalog"
  // would actually find.
  onPicked: (result: { externalId: string; name: string }) => void;
}

export function IgdbPickerModal({ game, onClose, onPicked }: IgdbPickerModalProps) {
  const t = getT();
  const [candidates, setCandidates] = useState<IgdbCandidate[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [applying,   setApplying]   = useState<number | null>(null);
  const [searchText, setSearchText] = useState('');
  // Closing the modal mid-search (or mid-debounce) shouldn't setState on an
  // unmounted component — every other async flow in this codebase guards
  // with a cancellation flag/cleanup, this one didn't.
  const cancelledRef                = useRef(false);
  useEffect(() => {
    return () => { cancelledRef.current = true; };
  }, []);

  const runSearch = useCallback((query: string) => {
    setLoading(true);
    setError(null);
    igdbSearchCandidates(query)
      .then(r  => { if (!cancelledRef.current) { setCandidates(r); setLoading(false); } })
      .catch(e => { if (!cancelledRef.current) { setError(String(e)); setLoading(false); } });
  }, []);

  useEffect(() => { runSearch(game.name); }, [game.name, runSearch]);

  const [debouncedSearch] = useDebouncedCallback((val: string) => runSearch(val.trim() || game.name), 500);
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchText(val);
    debouncedSearch(val);
  };

  const handlePick = async (candidate: IgdbCandidate) => {
    setApplying(candidate.id);
    try {
      // Only meaningful for an actual install — re-downloads/caches the
      // local info.json this game's OWN readGameInfo(app_id) reads. A
      // "Pendiente" with nothing installed (no app_id at all — this modal
      // used to just refuse to pick anything at all for one, via an early
      // `if (!game.app_id) return`) has no such cache to refresh; the
      // linking below already falls back to game.name as its key for
      // exactly this case.
      if (game.app_id) {
        await igdbForceByIgdbId(game.app_id, game.name, candidate.id);
      }
      // Persists the pick as the permanent match for this game — without
      // this, igdbForceByIgdbId only re-downloads the cached cover/banner;
      // the catalog link itself (external_id, used by "Ver en catálogo" and
      // the library) would still resolve through automatic Steam-ID/fuzzy
      // matching on the next scan, which could re-guess wrong again.
      // linkKey must match scan_all_games' own derivation exactly (see
      // platform_scanning.rs): app_id ?? install_path ?? name.
      const linkKey = game.app_id ?? game.install_path ?? game.name;
      const externalId = `game:${candidate.id}`;
      await saveGameLink(game.launcher, linkKey, externalId).catch(console.error);
      // Without this, the corrected name only ever lived in memory
      // (LocalLibrary's own pickedNames override) — a real reload re-read
      // media_catalog from scratch, found no row for this external_id (one
      // only ever gets created by visiting the game's own /media page), and
      // every card fell straight back to the raw scanned name (a ROM's own
      // messy filename, most visibly). Fetches whatever's already on file
      // for this id first and overlays just the identity fields this pick
      // actually determines — a blind save here would otherwise blow away
      // synposis/genres/etc. an existing row already has (save_catalog_entry
      // does a full row REPLACE, not a merge).
      const existing = await getCatalogEntry(externalId).catch(() => null);
      const catalogEntry: MediaCatalogEntry = existing
        ? { ...existing, title_main: candidate.name, cover_url: candidate.cover_url || existing.cover_url }
        : {
            id: '', external_id: externalId, type: 'game',
            title_main: candidate.name, cover_url: candidate.cover_url || null,
            release_year: candidate.year > 0 ? candidate.year : null,
            created_at: '', updated_at: '',
          };
      await saveCatalogEntry(catalogEntry).catch(console.error);
      onPicked({ externalId, name: candidate.name });
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
          <span>{t.local.select_igdb_game}</span>
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
          <div className="igdb-picker-loading">{t.local.searching_ellipsis}</div>
        ) : error ? (
          <div className="igdb-picker-loading" style={{ color: 'var(--text-danger, #f87171)' }}>Error: {error}</div>
        ) : candidates.length === 0 ? (
          <div className="igdb-picker-loading">{t.local.no_results}</div>
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
