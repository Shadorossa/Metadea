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

function CoverCard({ entry, faded, small }: { entry: MediaCatalogEntry; faded?: boolean; small?: boolean }) {
  const name = entry.title_main ?? entry.external_id;
  return (
    <div
      className={`tier-card${small ? ' tier-card--sm' : ''}${faded ? ' tier-card--faded' : ''}`}
      title={name}
    >
      {entry.cover_url
        ? <img src={entry.cover_url} alt={name} draggable={false} />
        : <div className="tier-card-placeholder"><span>{name.slice(0, 2).toUpperCase()}</span></div>
      }
    </div>
  );
}

export default function TierMaker() {
  const [state, setState] = useState<State>({
    tiers: DEFAULT_TIERS.map(t => ({ ...t, items: [] })),
    pool: [],
  });
  const [loading, setLoading]       = useState(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // Refs that don't need re-renders
  const ghostRef   = useRef<HTMLDivElement>(null);
  const dragSrc    = useRef<{ itemId: string; fromTier: string | 'pool' } | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    getAllCatalogEntries()
      .then(entries => { setState(prev => ({ ...prev, pool: entries })); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const getDropZone = (x: number, y: number): string | null => {
    const ghost = ghostRef.current;
    if (ghost) ghost.style.display = 'none';
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (ghost) ghost.style.display = '';

    const tierEl = el?.closest('[data-tier-id]') as HTMLElement | null;
    if (tierEl?.dataset.tierId) return tierEl.dataset.tierId;
    if (el?.closest('[data-pool]')) return 'pool';
    return null;
  };

  const commitDrop = useCallback((toId: string) => {
    const src = dragSrc.current;
    if (!src || src.fromTier === toId) return;
    const { itemId, fromTier } = src;

    setState(prev => {
      let entry: MediaCatalogEntry | null =
        fromTier === 'pool'
          ? prev.pool.find(e => e.id === itemId) ?? null
          : prev.tiers.find(t => t.id === fromTier)?.items.find(e => e.id === itemId) ?? null;
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

  const startDrag = useCallback((e: React.PointerEvent, entry: MediaCatalogEntry, fromTier: string | 'pool') => {
    // Ignore right-click / multi-touch
    if (e.button !== undefined && e.button !== 0) return;

    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    dragSrc.current = { itemId: entry.id, fromTier };

    // Position ghost before showing it
    const ghost = ghostRef.current;
    if (ghost) {
      ghost.style.left    = `${rect.left}px`;
      ghost.style.top     = `${rect.top}px`;
      ghost.style.width   = `${rect.width}px`;
      ghost.style.height  = `${rect.height}px`;
      ghost.style.display = 'block';
    }

    // Prevent text selection globally while dragging
    document.body.style.userSelect    = 'none';
    document.body.style.pointerEvents = 'none';
    if (ghost) ghost.style.pointerEvents = 'auto';

    setDraggingId(entry.id);

    const onMove = (ev: PointerEvent) => {
      if (ghost) {
        ghost.style.left = `${ev.clientX - dragOffset.current.x}px`;
        ghost.style.top  = `${ev.clientY - dragOffset.current.y}px`;
      }
      setDropTarget(getDropZone(ev.clientX, ev.clientY));
    };

    const onUp = (ev: PointerEvent) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);

      document.body.style.userSelect    = '';
      document.body.style.pointerEvents = '';
      if (ghost) { ghost.style.display = 'none'; ghost.style.pointerEvents = ''; }

      const toId = getDropZone(ev.clientX, ev.clientY);
      if (toId) commitDrop(toId);

      dragSrc.current = null;
      setDraggingId(null);
      setDropTarget(null);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [commitDrop]);

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
        {/* Tiers */}
        <div className="tier-rows-wrap">
          <div className="tier-rows">
            {tiers.map(tier => (
              <div
                key={tier.id}
                data-tier-id={tier.id}
                className={`tier-row${dropTarget === tier.id ? ' tier-row--over' : ''}`}
              >
                <div className="tier-label" style={{ background: tier.color }}>
                  <input className="tier-label-input" value={tier.label} maxLength={4}
                    onChange={e => onLabelChange(tier.id, e.target.value)} />
                  <input type="color" className="tier-color-input" value={tier.color}
                    onChange={e => onColorChange(tier.id, e.target.value)} />
                </div>
                <div className="tier-items" data-tier-id={tier.id}>
                  {tier.items.map(entry => (
                    <div key={entry.id} className="tier-card-wrap"
                      onPointerDown={e => startDrag(e, entry, tier.id)}>
                      <CoverCard entry={entry} faded={draggingId === entry.id} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pool */}
        <div data-pool="true"
          className={`tier-pool${dropTarget === 'pool' ? ' tier-pool--over' : ''}`}>
          <p className="tier-pool-label">
            {pool.length === 0 ? 'Todo clasificado' : `Sin clasificar (${pool.length})`}
          </p>
          <div className="tier-pool-grid" data-pool="true">
            {pool.map(entry => (
              <div key={entry.id} className="tier-card-wrap"
                onPointerDown={e => startDrag(e, entry, 'pool')}>
                <CoverCard entry={entry} faded={draggingId === entry.id} small />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Ghost card — positioned via direct DOM in pointermove, no React re-renders */}
      <div ref={ghostRef} className="tier-ghost" style={{ display: 'none' }}>
        {draggingId && (() => {
          const entry =
            pool.find(e => e.id === draggingId) ??
            tiers.flatMap(t => t.items).find(e => e.id === draggingId);
          return entry ? <CoverCard entry={entry} faded={false} /> : null;
        })()}
      </div>
    </div>
  );
}
