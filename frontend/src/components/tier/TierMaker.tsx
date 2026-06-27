import { useState, useEffect, useRef, useCallback } from 'react';
import { getAllCatalogEntries } from '../../lib/tauri';
import type { MediaCatalogEntry } from '../../lib/tauri';

interface Tier {
  id: string;
  label: string;
  color: string;
  items: MediaCatalogEntry[];
}

interface State {
  tiers: Tier[];
  pool: MediaCatalogEntry[];
}

const DEFAULT_TIERS: Omit<Tier, 'items'>[] = [
  { id: 's', label: 'S', color: '#ff7f7f' },
  { id: 'a', label: 'A', color: '#ffbf7f' },
  { id: 'b', label: 'B', color: '#ffdf7f' },
  { id: 'c', label: 'C', color: '#7fff7f' },
  { id: 'd', label: 'D', color: '#7fbfff' },
  { id: 'f', label: 'F', color: '#bf7fff' },
];

function CoverCard({ entry, dragging, small }: { entry: MediaCatalogEntry; dragging: boolean; small?: boolean }) {
  return (
    <div
      className={`tier-card${small ? ' tier-card--sm' : ''}${dragging ? ' tier-card--dragging' : ''}`}
      title={entry.title_main ?? entry.external_id}
    >
      {entry.cover_url
        ? <img src={entry.cover_url} alt={entry.title_main ?? ''} draggable={false} />
        : (
          <div className="tier-card-placeholder">
            <span>{(entry.title_main ?? entry.external_id).slice(0, 2).toUpperCase()}</span>
          </div>
        )
      }
    </div>
  );
}

export default function TierMaker() {
  const [state, setState] = useState<State>({
    tiers: DEFAULT_TIERS.map(t => ({ ...t, items: [] })),
    pool: [],
  });
  const [loading, setLoading] = useState(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // Store drag source in ref — accessed synchronously in drop handler
  const dragSrc = useRef<{ itemId: string; fromTier: string | 'pool' } | null>(null);

  useEffect(() => {
    getAllCatalogEntries().then(entries => {
      setState(prev => ({ ...prev, pool: entries }));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleDragStart = useCallback((
    e: React.DragEvent,
    itemId: string,
    fromTier: string | 'pool',
  ) => {
    // Required for drop to fire in WebKit / Tauri WebView
    e.dataTransfer.setData('text/plain', itemId);
    e.dataTransfer.effectAllowed = 'move';
    dragSrc.current = { itemId, fromTier };
    setDraggingId(itemId);
  }, []);

  const handleDragEnd = useCallback(() => {
    dragSrc.current = null;
    setDraggingId(null);
    setDropTarget(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, toId: string | 'pool') => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(toId);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setDropTarget(null);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, toId: string | 'pool') => {
    e.preventDefault();
    setDropTarget(null);
    const src = dragSrc.current;
    if (!src || src.fromTier === toId) return;

    const { itemId, fromTier } = src;

    setState(prev => {
      // Find the entry in its current location
      let entry: MediaCatalogEntry | null = null;
      if (fromTier === 'pool') {
        entry = prev.pool.find(e => e.id === itemId) ?? null;
      } else {
        entry = prev.tiers.find(t => t.id === fromTier)?.items.find(e => e.id === itemId) ?? null;
      }
      if (!entry) return prev;

      const newTiers = prev.tiers.map(t => {
        let items = [...t.items];
        if (t.id === fromTier) items = items.filter(e => e.id !== itemId);
        if (t.id === toId)     items = [...items, entry!];
        return { ...t, items };
      });

      let newPool = [...prev.pool];
      if (fromTier === 'pool') newPool = newPool.filter(e => e.id !== itemId);
      if (toId === 'pool')     newPool = [...newPool, entry];

      return { tiers: newTiers, pool: newPool };
    });
  }, []);

  const onLabelChange = (tierId: string, v: string) =>
    setState(prev => ({ ...prev, tiers: prev.tiers.map(t => t.id === tierId ? { ...t, label: v } : t) }));

  const onColorChange = (tierId: string, v: string) =>
    setState(prev => ({ ...prev, tiers: prev.tiers.map(t => t.id === tierId ? { ...t, color: v } : t) }));

  if (loading) return <div className="tier-loading">Cargando catálogo…</div>;

  const { tiers, pool } = state;

  return (
    <div className="tier-maker-layout">
      <div className="tier-maker-header">
        <a href="/tier" className="tier-maker-back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Mis tier lists
        </a>
        <span className="tier-maker-page-title">Nueva Tier List</span>
        <div />
      </div>

      <div className="tier-maker-body">
        {/* Izquierda: tiers */}
        <div className="tier-rows-wrap">
          <div className="tier-rows">
            {tiers.map(tier => (
              <div
                key={tier.id}
                className={`tier-row${dropTarget === tier.id ? ' tier-row--over' : ''}`}
                onDragOver={e => handleDragOver(e, tier.id)}
                onDragLeave={handleDragLeave}
                onDrop={e => handleDrop(e, tier.id)}
              >
                <div className="tier-label" style={{ background: tier.color }}>
                  <input
                    className="tier-label-input"
                    value={tier.label}
                    maxLength={4}
                    onChange={e => onLabelChange(tier.id, e.target.value)}
                  />
                  <input
                    type="color"
                    className="tier-color-input"
                    value={tier.color}
                    onChange={e => onColorChange(tier.id, e.target.value)}
                  />
                </div>
                <div className="tier-items">
                  {tier.items.map(entry => (
                    <div
                      key={entry.id}
                      draggable
                      onDragStart={e => handleDragStart(e, entry.id, tier.id)}
                      onDragEnd={handleDragEnd}
                    >
                      <CoverCard entry={entry} dragging={draggingId === entry.id} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Derecha: pool */}
        <div
          className={`tier-pool${dropTarget === 'pool' ? ' tier-pool--over' : ''}`}
          onDragOver={e => handleDragOver(e, 'pool')}
          onDragLeave={handleDragLeave}
          onDrop={e => handleDrop(e, 'pool')}
        >
          <p className="tier-pool-label">
            {pool.length === 0 ? 'Todo clasificado' : `Sin clasificar (${pool.length})`}
          </p>
          <div className="tier-pool-grid">
            {pool.map(entry => (
              <div
                key={entry.id}
                draggable
                onDragStart={e => handleDragStart(e, entry.id, 'pool')}
                onDragEnd={handleDragEnd}
              >
                <CoverCard entry={entry} dragging={draggingId === entry.id} small />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
