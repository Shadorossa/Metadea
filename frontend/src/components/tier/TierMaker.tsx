import { useState, useEffect, useRef, useCallback } from 'react';
import {
  getTierList, updateTierListTiers, addItemToTierList,
  setTierListPlacements, searchCatalog,
} from '../../lib/tauri';
import type { TierDef, TierListItemFull } from '../../lib/tauri';
import { getT } from '../../i18n/client';

interface Entry {
  external_id: string;
  title_main:  string | null;
  cover_url:   string | null;
  media_type:  string | null;
}

interface Tier extends TierDef {
  items: Entry[];
}

interface State {
  id:    string | null;
  name:  string;
  type:  string;
  tiers: Tier[];
  pool:  Entry[];
}

function getTierListId(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('id');
}

function toEntry(item: TierListItemFull): Entry {
  return {
    external_id: item.external_id,
    title_main:  item.title_main,
    cover_url:   item.cover_url,
    media_type:  item.media_type,
  };
}

function CoverCard({ entry, faded, small }: { entry: Entry; faded?: boolean; small?: boolean }) {
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
  const t = getT().tier;
  const tierListId = getTierListId();

  const [state, setState] = useState<State>({ id: null, name: '', type: 'works', tiers: [], pool: [] });
  const [loading, setLoading]       = useState(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerResults, setPickerResults] = useState<Entry[]>([]);

  // Refs that don't need re-renders
  const ghostRef   = useRef<HTMLDivElement>(null);
  const dragSrc    = useRef<{ itemId: string; fromTier: string | 'pool' } | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!tierListId) { setLoading(false); return; }
    getTierList(tierListId)
      .then(detail => {
        if (!detail) { setLoading(false); return; }
        const tiers: Tier[] = detail.tiers.map(td => ({
          ...td,
          items: detail.items.filter(i => i.tier_key === td.id).map(toEntry),
        }));
        const pool = detail.items.filter(i => i.tier_key === 'pool').map(toEntry);
        setState({ id: detail.id, name: detail.name, type: detail.list_type, tiers, pool });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [tierListId]);

  // Persist the current tier/pool assignment for every item
  const persistPlacements = useCallback((next: State) => {
    if (!next.id) return;
    const placements = [
      ...next.pool.map((e, pos) => ({ external_id: e.external_id, tier_key: 'pool', position: pos })),
      ...next.tiers.flatMap(t => t.items.map((e, pos) => ({ external_id: e.external_id, tier_key: t.id, position: pos }))),
    ];
    setTierListPlacements(next.id, placements).catch(() => {});
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
      let entry: Entry | null =
        fromTier === 'pool'
          ? prev.pool.find(e => e.external_id === itemId) ?? null
          : prev.tiers.find(t => t.id === fromTier)?.items.find(e => e.external_id === itemId) ?? null;
      if (!entry) return prev;

      const newTiers = prev.tiers.map(t => {
        let items = [...t.items];
        if (t.id === fromTier) items = items.filter(e => e.external_id !== itemId);
        if (t.id === toId)     items = [...items, entry!];
        return { ...t, items };
      });
      let newPool = [...prev.pool];
      if (fromTier === 'pool') newPool = newPool.filter(e => e.external_id !== itemId);
      if (toId === 'pool')     newPool = [...newPool, entry];

      const next = { ...prev, tiers: newTiers, pool: newPool };
      persistPlacements(next);
      return next;
    });
  }, [persistPlacements]);

  const startDrag = useCallback((e: React.PointerEvent, entry: Entry, fromTier: string | 'pool') => {
    // Ignore right-click / multi-touch
    if (e.button !== undefined && e.button !== 0) return;

    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    dragSrc.current = { itemId: entry.external_id, fromTier };

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

    setDraggingId(entry.external_id);

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
    setState(prev => {
      const next = { ...prev, tiers: prev.tiers.map(t => t.id === tierId ? { ...t, label: v } : t) };
      if (next.id) updateTierListTiers(next.id, next.tiers.map(({ id, label, color }) => ({ id, label, color }))).catch(() => {});
      return next;
    });

  const onColorChange = (tierId: string, v: string) =>
    setState(prev => {
      const next = { ...prev, tiers: prev.tiers.map(t => t.id === tierId ? { ...t, color: v } : t) };
      if (next.id) updateTierListTiers(next.id, next.tiers.map(({ id, label, color }) => ({ id, label, color }))).catch(() => {});
      return next;
    });

  // ── Picker (add works) ────────────────────────────────────────────────────

  useEffect(() => {
    if (!showPicker || state.type === 'characters') return;
    const q = pickerQuery.trim();
    if (!q) { setPickerResults([]); return; }
    let cancelled = false;
    searchCatalog(q).then(results => {
      if (cancelled) return;
      const existingIds = new Set([...state.pool, ...state.tiers.flatMap(t => t.items)].map(e => e.external_id));
      setPickerResults(
        results
          .filter(r => !existingIds.has(r.external_id))
          .slice(0, 30)
          .map(r => ({ external_id: r.external_id, title_main: r.title_main ?? null, cover_url: r.cover_url ?? null, media_type: r.type }))
      );
    }).catch(() => setPickerResults([]));
    return () => { cancelled = true; };
  }, [showPicker, pickerQuery, state.type, state.pool, state.tiers]);

  const addWork = async (entry: Entry) => {
    if (!state.id) return;
    await addItemToTierList(state.id, entry.external_id).catch(() => {});
    setState(prev => ({ ...prev, pool: [...prev.pool, entry] }));
    setPickerResults(prev => prev.filter(r => r.external_id !== entry.external_id));
  };

  if (loading) return <div className="tier-loading">…</div>;

  if (!tierListId || !state.id) {
    return (
      <div className="tier-loading">
        <a href="/tier" className="tier-maker-back">{t.back}</a>
      </div>
    );
  }

  const { tiers, pool } = state;

  return (
    <div className="tier-maker-layout">
      <div className="tier-maker-header">
        <a href="/tier" className="tier-maker-back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          {t.back}
        </a>
        <span className="tier-maker-page-title">{state.name}</span>
        <button type="button" className="tier-maker-add-btn" onClick={() => setShowPicker(true)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          {t.add_works}
        </button>
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
                    <div key={entry.external_id} className="tier-card-wrap"
                      onPointerDown={e => startDrag(e, entry, tier.id)}>
                      <CoverCard entry={entry} faded={draggingId === entry.external_id} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Pool */}
          <div data-pool="true"
            className={`tier-pool${dropTarget === 'pool' ? ' tier-pool--over' : ''}`}>
            <p className="tier-pool-label">
              {pool.length === 0 ? t.pool_empty : t.pool_unclassified.replace('{count}', String(pool.length))}
            </p>
            <div className="tier-pool-grid" data-pool="true">
              {pool.map(entry => (
                <div key={entry.external_id} className="tier-card-wrap"
                  onPointerDown={e => startDrag(e, entry, 'pool')}>
                  <CoverCard entry={entry} faded={draggingId === entry.external_id} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Ghost card — positioned via direct DOM in pointermove, no React re-renders */}
      <div ref={ghostRef} className="tier-ghost" style={{ display: 'none' }}>
        {draggingId && (() => {
          const entry =
            pool.find(e => e.external_id === draggingId) ??
            tiers.flatMap(t => t.items).find(e => e.external_id === draggingId);
          return entry ? <CoverCard entry={entry} faded={false} /> : null;
        })()}
      </div>

      {showPicker && (
        <div className="tier-picker-backdrop" onClick={() => setShowPicker(false)}>
          <div className="tier-picker-modal" onClick={e => e.stopPropagation()}>
            <div className="tier-picker-header">
              <input
                className="tier-picker-search"
                type="text"
                placeholder={t.add_works_search_ph}
                value={pickerQuery}
                onChange={e => setPickerQuery(e.target.value)}
                autoFocus
              />
              <button type="button" className="tier-picker-close" onClick={() => setShowPicker(false)}>✕</button>
            </div>
            <div className="tier-picker-results">
              {state.type === 'characters'
                ? <p className="tier-picker-empty">{t.characters_soon}</p>
                : pickerResults.length === 0
                  ? <p className="tier-picker-empty">{pickerQuery.trim() ? t.add_works_no_results : ''}</p>
                  : (
                    <div className="tier-picker-grid">
                      {pickerResults.map(entry => (
                        <button key={entry.external_id} type="button" className="tier-picker-item"
                          onClick={() => addWork(entry)} title={entry.title_main ?? entry.external_id}>
                          <CoverCard entry={entry} small />
                        </button>
                      ))}
                    </div>
                  )
              }
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
