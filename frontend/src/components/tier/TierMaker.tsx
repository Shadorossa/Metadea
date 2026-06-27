import { useState, useEffect, useRef } from 'react';
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

interface DragState {
  itemId: string;
  fromTier: string | 'pool'; // tier id or 'pool'
}

function CoverCard({ entry, dragging }: { entry: MediaCatalogEntry; dragging: boolean }) {
  return (
    <div className={`tier-card${dragging ? ' tier-card--dragging' : ''}`} title={entry.title_main ?? entry.external_id}>
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
  const [tiers, setTiers] = useState<Tier[]>(
    DEFAULT_TIERS.map(t => ({ ...t, items: [] }))
  );
  const [pool, setPool] = useState<MediaCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const drag = useRef<DragState | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    getAllCatalogEntries().then(entries => {
      setPool(entries);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  function onDragStart(itemId: string, fromTier: string | 'pool') {
    drag.current = { itemId, fromTier };
    setDraggingId(itemId);
  }

  function onDragEnd() {
    drag.current = null;
    setDraggingId(null);
  }

  function removeFromSource(itemId: string, fromTier: string | 'pool'): MediaCatalogEntry | null {
    let found: MediaCatalogEntry | null = null;

    if (fromTier === 'pool') {
      setPool(prev => {
        const item = prev.find(e => e.id === itemId);
        if (item) found = item;
        return prev.filter(e => e.id !== itemId);
      });
    } else {
      setTiers(prev => prev.map(t => {
        if (t.id !== fromTier) return t;
        const item = t.items.find(e => e.id === itemId);
        if (item) found = item;
        return { ...t, items: t.items.filter(e => e.id !== itemId) };
      }));
    }
    return found;
  }

  function dropOnTier(tierId: string) {
    if (!drag.current) return;
    const { itemId, fromTier } = drag.current;
    if (fromTier === tierId) return;

    // We need the actual entry object — capture it from current state
    let entry: MediaCatalogEntry | null = null;

    setTiers(prev => {
      // Find entry in source
      if (fromTier === 'pool') {
        // We'll handle pool separately below
        return prev;
      }
      const sourceTier = prev.find(t => t.id === fromTier);
      entry = sourceTier?.items.find(e => e.id === itemId) ?? null;
      if (!entry) return prev;

      return prev.map(t => {
        if (t.id === fromTier) return { ...t, items: t.items.filter(e => e.id !== itemId) };
        if (t.id === tierId)   return { ...t, items: [...t.items, entry!] };
        return t;
      });
    });

    if (fromTier === 'pool') {
      setPool(prev => {
        const item = prev.find(e => e.id === itemId);
        if (!item) return prev;
        setTiers(ts => ts.map(t =>
          t.id === tierId ? { ...t, items: [...t.items, item] } : t
        ));
        return prev.filter(e => e.id !== itemId);
      });
    }
  }

  function dropOnPool() {
    if (!drag.current) return;
    const { itemId, fromTier } = drag.current;
    if (fromTier === 'pool') return;

    setTiers(prev => {
      const sourceTier = prev.find(t => t.id === fromTier);
      const entry = sourceTier?.items.find(e => e.id === itemId);
      if (!entry) return prev;
      setPool(p => [...p, entry]);
      return prev.map(t =>
        t.id === fromTier ? { ...t, items: t.items.filter(e => e.id !== itemId) } : t
      );
    });
  }

  function onLabelChange(tierId: string, newLabel: string) {
    setTiers(prev => prev.map(t => t.id === tierId ? { ...t, label: newLabel } : t));
  }

  function onColorChange(tierId: string, newColor: string) {
    setTiers(prev => prev.map(t => t.id === tierId ? { ...t, color: newColor } : t));
  }

  if (loading) {
    return <div className="tier-loading">Cargando catálogo…</div>;
  }

  return (
    <div className="tier-maker">
      {/* Tier rows */}
      <div className="tier-rows">
        {tiers.map(tier => (
          <div
            key={tier.id}
            className="tier-row"
            onDragOver={e => e.preventDefault()}
            onDrop={() => dropOnTier(tier.id)}
          >
            {/* Label cell */}
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

            {/* Items */}
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

      {/* Pool */}
      <div
        className="tier-pool"
        onDragOver={e => e.preventDefault()}
        onDrop={dropOnPool}
      >
        <p className="tier-pool-label">
          {pool.length === 0
            ? 'Todos los elementos están en la tier list'
            : `${pool.length} elemento${pool.length !== 1 ? 's' : ''} sin clasificar`}
        </p>
        <div className="tier-pool-grid">
          {pool.map(entry => (
            <div
              key={entry.id}
              draggable
              onDragStart={() => onDragStart(entry.id, 'pool')}
              onDragEnd={onDragEnd}
            >
              <CoverCard entry={entry} dragging={draggingId === entry.id} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
