import { useState, useEffect, useRef, useCallback } from 'react';
import { getAllCatalogEntries } from '../../lib/tauri';
import type { MediaCatalogEntry } from '../../lib/tauri';

interface Tier {
  id: string;
  label: string;
  color: string;
  items: MediaCatalogEntry[];
}

const DEFAULT_TIERS: Omit<Tier, 'items'>[] = [
  { id: 's', label: 'S', color: '#ff7f7f' },
  { id: 'a', label: 'A', color: '#ffbf7f' },
  { id: 'b', label: 'B', color: '#ffdf7f' },
  { id: 'c', label: 'C', color: '#7fff7f' },
  { id: 'd', label: 'D', color: '#7fbfff' },
  { id: 'f', label: 'F', color: '#bf7fff' },
];

interface DragRef {
  itemId: string;
  fromTier: string | 'pool';
}

function getEntry(tiers: Tier[], pool: MediaCatalogEntry[], itemId: string, from: string | 'pool') {
  if (from === 'pool') return pool.find(e => e.id === itemId) ?? null;
  return tiers.find(t => t.id === from)?.items.find(e => e.id === itemId) ?? null;
}

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
  const [tiers, setTiers] = useState<Tier[]>(DEFAULT_TIERS.map(t => ({ ...t, items: [] })));
  const [pool, setPool] = useState<MediaCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const drag = useRef<DragRef | null>(null);

  useEffect(() => {
    getAllCatalogEntries().then(entries => {
      setPool(entries);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const onDragStart = useCallback((itemId: string, from: string | 'pool') => {
    drag.current = { itemId, fromTier: from };
    setDraggingId(itemId);
  }, []);

  const onDragEnd = useCallback(() => {
    drag.current = null;
    setDraggingId(null);
    setDropTarget(null);
  }, []);

  const drop = useCallback((toId: string | 'pool') => {
    if (!drag.current) return;
    const { itemId, fromTier } = drag.current;
    if (fromTier === toId) { setDropTarget(null); return; }

    let captured: MediaCatalogEntry | null = null;

    setTiers(prevTiers => {
      setPool(prevPool => {
        captured = getEntry(prevTiers, prevPool, itemId, fromTier);
        if (!captured) return prevPool;

        const newTiers = prevTiers.map(t => {
          let items = [...t.items];
          if (t.id === fromTier) items = items.filter(e => e.id !== itemId);
          if (t.id === toId)     items = [...items, captured!];
          return { ...t, items };
        });
        setTimeout(() => setTiers(newTiers), 0);

        let newPool = fromTier === 'pool' ? prevPool.filter(e => e.id !== itemId) : [...prevPool];
        if (toId === 'pool') newPool = [...newPool, captured];
        return newPool;
      });
      return prevTiers;
    });

    setDropTarget(null);
  }, []);

  const onLabelChange = (tierId: string, v: string) =>
    setTiers(prev => prev.map(t => t.id === tierId ? { ...t, label: v } : t));

  const onColorChange = (tierId: string, v: string) =>
    setTiers(prev => prev.map(t => t.id === tierId ? { ...t, color: v } : t));

  if (loading) return <div className="tier-loading">Cargando catálogo…</div>;

  return (
    <div className="tier-maker-layout">
      {/* Header de la página */}
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
                onDragOver={e => { e.preventDefault(); setDropTarget(tier.id); }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={() => drop(tier.id)}
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
                      onDragStart={() => onDragStart(entry.id, tier.id)}
                      onDragEnd={onDragEnd}
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
          onDragOver={e => { e.preventDefault(); setDropTarget('pool'); }}
          onDragLeave={() => setDropTarget(null)}
          onDrop={() => drop('pool')}
        >
          <p className="tier-pool-label">
            {pool.length === 0 ? 'Todo clasificado' : `Sin clasificar (${pool.length})`}
          </p>
          <div className="tier-pool-grid">
            {pool.map(entry => (
              <div
                key={entry.id}
                draggable
                onDragStart={() => onDragStart(entry.id, 'pool')}
                onDragEnd={onDragEnd}
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
