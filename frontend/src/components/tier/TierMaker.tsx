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

interface Ghost {
  entry: MediaCatalogEntry;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
}

const DEFAULT_TIERS: Omit<Tier, 'items'>[] = [
  { id: 's', label: 'S', color: '#ff7f7f' },
  { id: 'a', label: 'A', color: '#ffbf7f' },
  { id: 'b', label: 'B', color: '#ffdf7f' },
  { id: 'c', label: 'C', color: '#7fff7f' },
  { id: 'd', label: 'D', color: '#7fbfff' },
  { id: 'f', label: 'F', color: '#bf7fff' },
];

function CoverCard({ entry, faded, small }: { entry: MediaCatalogEntry; faded?: boolean; small?: boolean }) {
  return (
    <div
      className={`tier-card${small ? ' tier-card--sm' : ''}${faded ? ' tier-card--dragging' : ''}`}
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
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const dragSrc = useRef<{ itemId: string; fromTier: string | 'pool' } | null>(null);

  useEffect(() => {
    getAllCatalogEntries().then(entries => {
      setState(prev => ({ ...prev, pool: entries }));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Attach document-level pointer events while dragging
  useEffect(() => {
    if (!ghost) return;

    function getDropTargetId(x: number, y: number): string | null {
      const el = document.elementFromPoint(x, y);
      if (!el) return null;
      const tierEl = el.closest('[data-tier-id]') as HTMLElement | null;
      if (tierEl?.dataset.tierId) return tierEl.dataset.tierId;
      if (el.closest('[data-pool]')) return 'pool';
      return null;
    }

    function onMove(e: PointerEvent) {
      setGhost(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null);
      setDropTarget(getDropTargetId(e.clientX, e.clientY));
    }

    function onUp(e: PointerEvent) {
      const toId = getDropTargetId(e.clientX, e.clientY);
      const src = dragSrc.current;

      if (toId && src && src.fromTier !== toId) {
        const { itemId, fromTier } = src;
        setState(prev => {
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
      }

      dragSrc.current = null;
      setGhost(null);
      setDropTarget(null);
    }

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }, [ghost != null]); // eslint-disable-line react-hooks/exhaustive-deps

  const startDrag = useCallback((
    e: React.PointerEvent,
    entry: MediaCatalogEntry,
    fromTier: string | 'pool',
  ) => {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragSrc.current = { itemId: entry.id, fromTier };
    setGhost({
      entry,
      x: e.clientX,
      y: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    });
  }, []);

  const onLabelChange = (tierId: string, v: string) =>
    setState(prev => ({ ...prev, tiers: prev.tiers.map(t => t.id === tierId ? { ...t, label: v } : t) }));

  const onColorChange = (tierId: string, v: string) =>
    setState(prev => ({ ...prev, tiers: prev.tiers.map(t => t.id === tierId ? { ...t, color: v } : t) }));

  if (loading) return <div className="tier-loading">Cargando catálogo…</div>;

  const { tiers, pool } = state;
  const draggingId = dragSrc.current?.itemId ?? null;

  return (
    <div className={`tier-maker-layout${ghost ? ' tier-maker--dragging' : ''}`}>
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
                data-tier-id={tier.id}
                className={`tier-row${dropTarget === tier.id ? ' tier-row--over' : ''}`}
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
                <div className="tier-items" data-tier-id={tier.id}>
                  {tier.items.map(entry => (
                    <div
                      key={entry.id}
                      onPointerDown={e => startDrag(e, entry, tier.id)}
                      style={{ touchAction: 'none' }}
                    >
                      <CoverCard entry={entry} faded={draggingId === entry.id} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Derecha: pool */}
        <div
          data-pool="true"
          className={`tier-pool${dropTarget === 'pool' ? ' tier-pool--over' : ''}`}
        >
          <p className="tier-pool-label">
            {pool.length === 0 ? 'Todo clasificado' : `Sin clasificar (${pool.length})`}
          </p>
          <div className="tier-pool-grid" data-pool="true">
            {pool.map(entry => (
              <div
                key={entry.id}
                onPointerDown={e => startDrag(e, entry, 'pool')}
                style={{ touchAction: 'none' }}
              >
                <CoverCard entry={entry} faded={draggingId === entry.id} small />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Ghost card that follows the cursor */}
      {ghost && (
        <div
          className="tier-ghost"
          style={{
            left: ghost.x - ghost.offsetX,
            top: ghost.y - ghost.offsetY,
          }}
        >
          <CoverCard entry={ghost.entry} faded={false} />
        </div>
      )}
    </div>
  );
}
