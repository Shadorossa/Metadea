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

function getEntry(tiers: Tier[], pool: MediaCatalogEntry[], itemId: string, fromTier: string | 'pool') {
  if (fromTier === 'pool') return pool.find(e => e.id === itemId) ?? null;
  return tiers.find(t => t.id === fromTier)?.items.find(e => e.id === itemId) ?? null;
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

interface Props {
  onClose: () => void;
}

export default function TierMaker({ onClose }: Props) {
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

  const onDragStart = useCallback((itemId: string, fromTier: string | 'pool') => {
    drag.current = { itemId, fromTier };
    setDraggingId(itemId);
  }, []);

  const onDragEnd = useCallback(() => {
    drag.current = null;
    setDraggingId(null);
    setDropTarget(null);
  }, []);

  const moveTo = useCallback((toId: string | 'pool') => {
    if (!drag.current) return;
    const { itemId, fromTier } = drag.current;
    if (fromTier === toId) return;

    setTiers(prevTiers => {
      setPool(prevPool => {
        const entry = getEntry(prevTiers, prevPool, itemId, fromTier);
        if (!entry) return prevPool;

        // Build new pool
        let newPool = fromTier === 'pool'
          ? prevPool.filter(e => e.id !== itemId)
          : prevPool;
        if (toId === 'pool') newPool = [...newPool, entry];

        // Build new tiers (after pool update, before return)
        const newTiers = prevTiers.map(t => {
          let items = t.items;
          if (t.id === fromTier) items = items.filter(e => e.id !== itemId);
          if (t.id === toId)     items = [...items, entry];
          return { ...t, items };
        });
        // Trigger tiers update
        setTimeout(() => setTiers(newTiers), 0);

        return newPool;
      });
      return prevTiers; // will be overwritten by setTimeout above
    });
  }, []);

  // Cleaner state update: avoid nested setStates
  const drop = useCallback((toId: string | 'pool') => {
    if (!drag.current) return;
    const { itemId, fromTier } = drag.current;
    if (fromTier === toId) { setDropTarget(null); return; }

    // Snapshot both states atomically via functional updates
    let captured: MediaCatalogEntry | null = null;

    setTiers(prev => {
      if (fromTier !== 'pool') {
        const src = prev.find(t => t.id === fromTier);
        captured = src?.items.find(e => e.id === itemId) ?? null;
      }
      return prev.map(t => {
        let items = [...t.items];
        if (t.id === fromTier) items = items.filter(e => e.id !== itemId);
        if (t.id === toId && captured) items = [...items, captured];
        return { ...t, items };
      });
    });

    setPool(prev => {
      const fromPool = fromTier === 'pool';
      const toPool   = toId === 'pool';
      let entry = captured;
      if (fromPool) entry = prev.find(e => e.id === itemId) ?? null;
      if (!entry) return prev;
      let next = fromPool ? prev.filter(e => e.id !== itemId) : prev;
      if (toPool) next = [...next, entry];
      // If moving from tier to tier, also capture entry now
      if (!fromPool && !toPool) captured = entry;
      return next;
    });

    // When moving from tier to tier, captured is set in setTiers, but setPool doesn't add to tier
    // The above handles all cases: pool→tier, tier→pool, tier→tier
    setDropTarget(null);
  }, []);

  const onLabelChange = (tierId: string, v: string) =>
    setTiers(prev => prev.map(t => t.id === tierId ? { ...t, label: v } : t));

  const onColorChange = (tierId: string, v: string) =>
    setTiers(prev => prev.map(t => t.id === tierId ? { ...t, color: v } : t));

  return (
    <div className="tier-overlay">
      {/* Header */}
      <div className="tier-overlay-header">
        <span className="tier-overlay-title">Nueva Tier List</span>
        <button className="tier-overlay-close" onClick={onClose} title="Cerrar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div className="tier-overlay-body">
        {/* Left: tier rows */}
        <div className="tier-rows-wrap">
          {loading
            ? <div className="tier-loading">Cargando catálogo…</div>
            : (
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
            )
          }
        </div>

        {/* Right: pool */}
        <div
          className={`tier-pool${dropTarget === 'pool' ? ' tier-pool--over' : ''}`}
          onDragOver={e => { e.preventDefault(); setDropTarget('pool'); }}
          onDragLeave={() => setDropTarget(null)}
          onDrop={() => drop('pool')}
        >
          <p className="tier-pool-label">
            {pool.length === 0
              ? 'Todo clasificado'
              : `Sin clasificar (${pool.length})`}
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
