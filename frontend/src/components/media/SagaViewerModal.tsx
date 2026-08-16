import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Translations } from '../../i18n/index';
import type { SagaEntry } from '../../lib/anilist/saga';
import { IconX } from '../local/ui/icons';
import { lookupLabel } from '../../lib/media/mapper-utils';
import { useClosingTransition } from '../../lib/shared/useClosingTransition';
import { loadSagaChain, loadSagaArcs } from '../../lib/media/sagaData';
import type { StoryArc } from '../../lib/tauri/story-arcs';

interface Props {
  externalId: string; // the entry the user opened the viewer from, e.g. "anime:123"
  i18n: Translations['media'];
  onClose: () => void;
}

type LoadState = 'loading' | 'done' | 'error';

export function SagaViewerModal({ externalId, i18n, onClose }: Props) {
  const t = i18n;
  const [entries, setEntries] = useState<SagaEntry[]>([]);
  const [sagaTitle, setSagaTitle] = useState<string>('');
  const [loadState, setLoadState] = useState<LoadState>('loading');
  // Every Arcos Argumentales (see PrEditorStoryArcsSection) touching any
  // member of this saga, deduped by id — rendered as its own second strip
  // below the main saga-order one, same card style, instead of trying to
  // annotate each saga card individually.
  const [sagaArcs, setSagaArcs] = useState<StoryArc[]>([]);
  // Title/cover for arc items whose media isn't itself one of this saga's
  // entries (e.g. a manga source pulled in alongside its anime adaptation
  // when the arc was built) — the saga chain alone doesn't know about those.
  const [arcItemMeta, setArcItemMeta] = useState<Record<string, { title: string; cover: string | null }>>({});
  // Toggled via the header's own tab buttons — the two rows used to always
  // show stacked, which read as too cramped once a saga had any arcs at
  // all; only one shows at a time now, each getting the body's full height.
  const [activeTab, setActiveTab] = useState<'saga' | 'arcs'>('saga');
  const [hoveredArcId, setHoveredArcId] = useState<string | null>(null);
  // Viewport coordinates (not a plain position:absolute offset) — the arc
  // cards live in a horizontally-scrollable, overflow:hidden row, which
  // would just clip an absolutely-positioned panel instead of letting it
  // escape to the right. Rendered via a portal straight to <body> below.
  const [hoverPanelPos, setHoverPanelPos] = useState<{ top: number; left: number } | null>(null);
  const { isClosing, close: handleClose } = useClosingTransition(onClose);

  // Whether every saga member's own arcs have been checked at least once —
  // gates the strip's first paint (see `modal` JSX) so whether the Arcos
  // Argumentales tab exists is fully decided before anything is shown,
  // instead of it popping into an already-settled header once this
  // resolves. An arc doesn't have to touch the specific entry the viewer
  // was opened from — a single-entry "quick check" tried earlier missed
  // exactly that case (an arc on some *other* saga member), which is
  // why this waits for the whole chain's own arcs instead.
  const [arcsFullyChecked, setArcsFullyChecked] = useState(false);

  // loadSagaChain/loadSagaArcs (lib/media/sagaData.ts) memoize their promises
  // per key — MediaPage already calls prefetchSagaData() as soon as a page
  // with a saga loads, so by the time this modal mounts (user clicked the
  // Saga button) both of these are typically already resolved, and this
  // effect just reads the cached result instead of starting a fresh fetch.
  useEffect(() => {
    let cancelled = false;
    loadSagaChain(externalId).then(chain => {
      if (cancelled) return;
      if (!chain.ok) { setLoadState('error'); return; }
      setEntries(chain.entries);
      if (chain.sagaTitle) setSagaTitle(chain.sagaTitle);
      setLoadState('done');

      loadSagaArcs(chain.entries).then(({ arcs, arcItemMeta }) => {
        if (cancelled) return;
        setSagaArcs(arcs);
        setArcItemMeta(prev => ({ ...prev, ...arcItemMeta }));
        setArcsFullyChecked(true);
      }).catch(() => { if (!cancelled) setArcsFullyChecked(true); });
    }).catch(() => {
      if (cancelled) return;
      setLoadState('error');
      setArcsFullyChecked(true);
    });
    return () => { cancelled = true; };
  }, [externalId]);

  const firstEntry = entries[0];

  // Arc items usually point at one of this saga's own entries, but can also
  // point at something pulled in alongside it (e.g. a manga source) that
  // isn't itself part of the chain — arcItemMeta covers those.
  function metaForId(id: string): { title: string; cover: string | null } {
    const entry = entries.find(e => e.externalId === id);
    if (entry) return { title: entry.title, cover: entry.cover };
    return arcItemMeta[id] ?? { title: id, cover: null };
  }
  function unitLabelForId(id: string): string {
    const type = id.split(':')[0];
    return type === 'anime' ? 'Episodios' : 'Capítulos';
  }
  function formatItemRange(item: { ep_start: number | null; ep_end: number | null }): string | null {
    if (item.ep_start != null && item.ep_end != null) return `${item.ep_start}-${item.ep_end}`;
    if (item.ep_start != null) return `${item.ep_start}+`;
    return null;
  }

  const modal = (
    <div className={`me-overlay saga-overlay${isClosing ? ' me-overlay--out' : ''}`} onClick={handleClose}>
      <div className="saga-strip-container" onClick={e => e.stopPropagation()}>
        {!arcsFullyChecked ? (
          // Whether the Arcos Argumentales tab exists at all isn't decided
          // yet — holding off the header/body until it is means the tab is
          // either there from this container's very first real paint, or
          // never shows up having popped in later. The backdrop/overlay
          // itself still opens immediately (see `modal`'s own root above);
          // only this inner content waits.
          <div className="saga-strip-status"><div className="spinner" /></div>
        ) : (
          <>
        <div className="saga-strip-header">
          <button
            type="button"
            className={`saga-strip-tab${activeTab === 'saga' ? ' saga-strip-tab--active' : ''}`}
            onClick={() => setActiveTab('saga')}
          >
            {t.saga_title}
          </button>
          {sagaArcs.length > 0 && (
            <>
              <span className="saga-strip-divider saga-strip-divider--tabs">·</span>
              <button
                type="button"
                className={`saga-strip-tab${activeTab === 'arcs' ? ' saga-strip-tab--active' : ''}`}
                onClick={() => setActiveTab('arcs')}
              >
                Arcos Argumentales
              </button>
            </>
          )}
          <span className="saga-strip-divider">·</span>
          <span className="saga-strip-title">{sagaTitle || firstEntry?.title}</span>
        </div>

        <div className="saga-strip-body">
          {loadState === 'loading' && (
            <div className="saga-strip-status">{t.saga_loading}</div>
          )}
          {loadState === 'error' && (
            <div className="saga-strip-status">{t.saga_error}</div>
          )}
          {loadState === 'done' && activeTab === 'saga' && (
            <div className="saga-strip-list">
              {entries.map(entry => {
                const isCurrent = entry.externalId === externalId;
                return (
                  <a
                    key={entry.externalId}
                    className={`saga-strip-item${isCurrent ? ' saga-strip-item--current' : ''}`}
                    href={`/media?id=${encodeURIComponent(entry.externalId)}`}
                    onClick={e => { if (isCurrent) e.preventDefault(); }}
                  >
                    <div className="saga-strip-item-bg">
                      {entry.cover && <img src={entry.cover} alt="" />}
                      <div className="saga-strip-item-overlay" />
                    </div>

                    {isCurrent && <span className="saga-strip-item-current-indicator" />}

                    <div className="saga-strip-item-cover">
                      {entry.cover
                        ? <img src={entry.cover} alt="" loading="lazy" />
                        : <div className="saga-strip-item-cover-fallback" />}
                    </div>

                    <div className="saga-strip-item-info">
                      <span className="saga-strip-item-title">{entry.title}</span>
                      <div className="saga-strip-item-meta-row">
                        {entry.format && <span className="saga-strip-item-badge">{lookupLabel(t.formats, entry.format, entry.format)}</span>}
                        {entry.year && <span className="saga-strip-item-year">{entry.year}</span>}
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          )}

          {/* Same card style as the saga order tab, just a different data
              set — its own tab (only shown at all once there's at least one
              arc) instead of always stacking both under the saga order. */}
          {loadState === 'done' && activeTab === 'arcs' && sagaArcs.length > 0 && (
            <div className="saga-strip-list saga-strip-list--arcs">
              {sagaArcs.map(arc => {
                const single = arc.items.length === 1 ? arc.items[0] : null;
                const range = single && single.ep_start != null && single.ep_end != null
                  ? `${single.ep_start}-${single.ep_end}`
                  : single && single.ep_start != null ? `${single.ep_start}+`
                  : null;
                return (
                  <div
                    key={arc.id}
                    className="saga-strip-item saga-strip-item--arc"
                    onMouseEnter={e => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setHoveredArcId(arc.id);
                      setHoverPanelPos({ top: rect.top, left: rect.right + 12 });
                    }}
                    onMouseLeave={() => { setHoveredArcId(null); setHoverPanelPos(null); }}
                  >
                    <div className="saga-strip-item-bg">
                      {arc.image_base64 && <img src={arc.image_base64} alt="" />}
                      <div className="saga-strip-item-overlay" />
                    </div>

                    <div className="saga-strip-item-cover">
                      {arc.image_base64
                        ? <img src={arc.image_base64} alt="" loading="lazy" />
                        : <div className="saga-strip-item-cover-fallback" />}
                    </div>

                    <div className="saga-strip-item-info">
                      <span className="saga-strip-item-title">{arc.name}</span>
                      <div className="saga-strip-item-meta-row">
                        {range && <span className="saga-strip-item-year">{range}</span>}
                        {!single && <span className="saga-strip-item-badge">{arc.items.length} obras</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
          </>
        )}

        <button type="button" className="saga-strip-close" onClick={handleClose}>
          <IconX size={20} />
        </button>
      </div>
    </div>
  );

  const hoveredArc = sagaArcs.find(a => a.id === hoveredArcId);

  return (
    <>
      {createPortal(modal, document.body)}
      {hoveredArc && hoverPanelPos && createPortal(
        <div className="saga-arc-hover-panel" style={{ top: hoverPanelPos.top, left: hoverPanelPos.left }}>
          {hoveredArc.items.map(item => {
            const itemRange = formatItemRange(item);
            const meta = metaForId(item.media_external_id);
            return (
              <div key={item.id} className="saga-arc-hover-row">
                {meta.cover
                  ? <img className="saga-arc-hover-row-cover" src={meta.cover} alt="" />
                  : <div className="saga-arc-hover-row-cover saga-arc-hover-row-cover--fallback" />}
                <div className="saga-arc-hover-row-text">
                  <span className="saga-arc-hover-row-title">{meta.title}</span>
                  {itemRange && (
                    <span className="saga-arc-hover-row-range">{unitLabelForId(item.media_external_id)} {itemRange}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
