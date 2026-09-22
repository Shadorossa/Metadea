import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  igdbSearchCandidates, igdbForceByIgdbId, saveGameLink, getCatalogEntry, saveCatalogEntry,
  searchCatalog,
  type LocalGame, type IgdbCandidate, type MediaCatalogEntry,
} from '../../../lib/tauri';
import { getT } from '../../../i18n/client';
import { useDebouncedCallback } from '../../../lib/shared/useDebouncedCallback';

interface IgdbPickerModalProps {
  game:     LocalGame;
  onClose:  () => void;
  onPicked: (result: { externalId: string; name: string }) => void;
}

function getCandidateBadge(c: IgdbCandidate): { label: string; className: string } | null {
  if (c.type === 'vnovel' || c.externalId?.startsWith('vnovel:')) {
    return { label: 'VN', className: 'vn' };
  }
  if (c.category === 3) {
    return { label: 'Bundle', className: 'bundle' };
  }
  if (c.category === 11) {
    return { label: 'Port', className: 'port' };
  }
  if (c.category === 8) {
    return { label: 'Remake', className: 'remake' };
  }
  if (c.category === 9) {
    return { label: 'Remaster', className: 'remaster' };
  }
  if (c.category === 10) {
    return { label: 'Expanded', className: 'expanded' };
  }
  if (c.source === 'database') {
    return { label: 'DB', className: 'db' };
  }
  return null;
}

export function IgdbPickerModal({ game, onClose, onPicked }: IgdbPickerModalProps) {
  const t = getT();
  const [candidates, setCandidates] = useState<IgdbCandidate[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [applying,   setApplying]   = useState<number | null>(null);
  const [searchText, setSearchText] = useState('');
  const cancelledRef                = useRef(false);

  useEffect(() => {
    return () => { cancelledRef.current = true; };
  }, []);

  const runSearch = useCallback((query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      setCandidates([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    Promise.allSettled([
      igdbSearchCandidates(trimmed),
      searchCatalog(trimmed),
    ]).then(([igdbRes, catalogRes]) => {
      if (cancelledRef.current) return;

      const igdbItems: IgdbCandidate[] = igdbRes.status === 'fulfilled' ? igdbRes.value : [];
      const catalogRaw: MediaCatalogEntry[] = catalogRes.status === 'fulfilled' ? catalogRes.value : [];

      const catalogItems: IgdbCandidate[] = catalogRaw
        .filter(c => c.type === 'vnovel' || c.type === 'game')
        .map(c => {
          const numId = Number(c.external_id?.split(':')[1]) || 0;
          return {
            id: numId,
            name: c.title_main || c.external_id,
            year: c.release_year || 0,
            cover_url: c.cover_url || '',
            developer: c.type === 'vnovel' ? 'Visual Novel' : 'Base de datos',
            category: null,
            externalId: c.external_id,
            type: c.type,
            source: 'database' as const,
          };
        });

      const combined: IgdbCandidate[] = [];
      const seenKeys = new Set<string>();

      for (const item of catalogItems) {
        const key = item.externalId || (item.id ? `${item.type || 'vnovel'}:${item.id}` : item.name);
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          if (item.id) seenKeys.add(`id:${item.id}`);
          combined.push(item);
        }
      }

      for (const item of igdbItems) {
        const idKey = `id:${item.id}`;
        const gameKey = `game:${item.id}`;
        const vnKey = `vnovel:${item.id}`;
        if (seenKeys.has(idKey) || seenKeys.has(gameKey) || seenKeys.has(vnKey)) {
          if (item.developer) {
            const existing = combined.find(c => c.id === item.id);
            if (existing && (!existing.developer || existing.developer === 'Visual Novel' || existing.developer === 'Base de datos')) {
              existing.developer = item.developer;
            }
          }
          continue;
        }

        seenKeys.add(idKey);
        combined.push({
          ...item,
          source: 'igdb',
        });
      }

      setCandidates(combined);
      setLoading(false);

      if (igdbRes.status === 'rejected' && combined.length === 0) {
        setError(String(igdbRes.reason));
      }
    });
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
      if (game.app_id && candidate.id > 0) {
        await igdbForceByIgdbId(game.app_id, game.name, candidate.id);
      }
      const linkKey = game.app_id ?? game.install_path ?? game.name;

      let externalId = candidate.externalId;
      if (!externalId) {
        const vnId = `vnovel:${candidate.id}`;
        const existingVn = await getCatalogEntry(vnId).catch(() => null);
        if (existingVn || candidate.type === 'vnovel') {
          externalId = vnId;
        } else {
          externalId = `game:${candidate.id}`;
        }
      }

      await saveGameLink(game.launcher, linkKey, externalId).catch(console.error);

      const existing = await getCatalogEntry(externalId).catch(() => null);
      const isVn = externalId.startsWith('vnovel:');
      const catalogEntry: MediaCatalogEntry = existing
        ? { ...existing, title_main: candidate.name, cover_url: candidate.cover_url || existing.cover_url }
        : {
            id: '',
            external_id: externalId,
            type: isVn ? 'vnovel' : 'game',
            title_main: candidate.name,
            cover_url: candidate.cover_url || null,
            release_year: candidate.year > 0 ? candidate.year : null,
            created_at: '',
            updated_at: '',
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
            {candidates.map(c => {
              const badge = getCandidateBadge(c);
              const cardKey = c.externalId || `${c.id}-${c.name}`;
              return (
                <button
                  key={cardKey}
                  className={`igdb-picker-card${applying === c.id ? ' loading' : ''}`}
                  onClick={() => handlePick(c)}
                  disabled={applying !== null}
                >
                  {c.cover_url ? (
                    <img src={c.cover_url} alt={c.name} className="igdb-picker-cover" />
                  ) : (
                    <div className="igdb-picker-cover igdb-picker-cover-placeholder" />
                  )}
                  <div className="igdb-picker-info">
                    <div className="igdb-picker-name-row">
                      <span className="igdb-picker-name">{c.name}</span>
                      {badge && (
                        <span className={`igdb-picker-badge ${badge.className}`}>
                          {badge.label}
                        </span>
                      )}
                    </div>
                    <span className="igdb-picker-meta">
                      {c.year > 0 ? c.year : '—'}{c.developer ? ` · ${c.developer}` : ''}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
