import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ModalShell } from '../shared/ModalShell';
import type { Translations } from '../../i18n/index';
import type { SagaEntry } from '../../lib/anilist/saga';
import { IconX } from '../local/ui/icons';
import { lookupLabel } from '../../lib/media/mappers/mapper-utils';
import { motion } from 'motion/react';
import { loadSagaChain, loadSagaArcs, loadSagaAlternativeGroups } from '../../lib/media/saga/saga-loader';
import type { StoryArc } from '../../lib/tauri/story-arcs';
import { wrapAssetUrl } from '../../lib/tauri/bridge';
import { toMediumCover } from '../../lib/media/small-cover';
import { SagaCompletionBar } from './saga/SagaCompletionBar';
import { useSpoilerShield } from '../spoilers/hooks/useSpoilerShield';
import { SpoilerChip } from '../spoilers/SpoilerShield';
import { chainToRelations } from '../../lib/spoilers/spoiler-franchises';
import { spoilerItemKey } from '../../lib/spoilers/spoiler-reveals';

interface Props {
  externalId: string; // the entry the user opened the viewer from, e.g. "anime:123"
  i18n: Translations['media'];
  onClose: () => void;
}

type LoadState = 'loading' | 'done' | 'error';

function splitAlternativeTitles(entries: SagaEntry[]): { root: string; variants: string[] } | null {
  const titles = entries.map(entry => entry.title.trim());
  if (titles.length < 2) return null;

  const first = titles[0];
  const commonLength = titles.slice(1).reduce((length, title) => {
    let shared = 0;
    while (shared < length && shared < title.length && first[shared].toLowerCase() === title[shared].toLowerCase()) shared++;
    return shared;
  }, first.length);
  const root = first.slice(0, commonLength).trim().replace(/[\s:|/–—-]+$/u, '');
  if (!root) return null;

  const variants = titles.map(title => title.slice(root.length).trim().replace(/^[\s:|/–—-]+/u, ''));
  return variants.every(Boolean) ? { root, variants } : null;
}

export function SagaViewerModal({ externalId, i18n, onClose }: Props) {
  const t = i18n;
  const [entries, setEntries] = useState<SagaEntry[]>([]);
  const [panels, setPanels] = useState<SagaEntry[][]>([]);
  const [hoveredAlternativeId, setHoveredAlternativeId] = useState<string | null>(null);
  const [activeAlternativeId, setActiveAlternativeId] = useState<string | null>(null);
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

      Promise.all([loadSagaArcs(chain.entries), loadSagaAlternativeGroups(chain.entries)]).then(([{ arcs, arcItemMeta }, groupedPanels]) => {
        if (cancelled) return;
        setSagaArcs(arcs);
        setPanels(groupedPanels);
        setArcItemMeta(prev => ({ ...prev, ...arcItemMeta }));
        setArcsFullyChecked(true);
      }).catch(() => {
        if (!cancelled) {
          setPanels(chain.entries.map(entry => [entry]));
          setArcsFullyChecked(true);
        }
      });
    }).catch(() => {
      if (cancelled) return;
      setLoadState('error');
      setArcsFullyChecked(true);
    });
    return () => { cancelled = true; };
  }, [externalId]);

  // Spoiler shield: arcs past the user's progress get their name and image
  // blurred; with "hide covers" on, so do the covers of later seasons the
  // user hasn't reached. The viewer's own order is the chain order.
  const chainIds = entries.map(entry => entry.externalId);
  const spoilerRelations = useMemo(() => chainToRelations(entries.map(entry => entry.externalId)), [entries]);
  const { evaluator: spoilers, isRevealed, reveal } = useSpoilerShield({ extraRelations: spoilerRelations });
  const isEntryCoverHidden = (id: string) => {
    const earlier = chainIds.slice(0, Math.max(0, chainIds.indexOf(id)));
    return !!spoilers && spoilers.isCoverHidden(id, earlier) && !isRevealed(spoilerItemKey.cover(id));
  };
  const isArcHidden = (arc: StoryArc) => !!spoilers && spoilers.isArcHidden(arc.items) && !isRevealed(spoilerItemKey.arc(arc.id));

  const firstEntry = entries[0];
  const showFormatTooltips = new Set(
    entries.map(entry => entry.format?.trim().toLocaleUpperCase()).filter(Boolean),
  ).size > 1;

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
    return type === 'anime' ? t.stat_episodes : t.stat_chapters;
  }
  function formatItemRange(item: { ep_start: number | null; ep_end: number | null }): string | null {
    if (item.ep_start != null && item.ep_end != null) return `${item.ep_start}-${item.ep_end}`;
    if (item.ep_start != null) return `${item.ep_start}+`;
    return null;
  }

  const modal = (
    <ModalShell
      onClose={onClose}
      label={t.saga_title}
      overlayClassName="me-overlay saga-overlay"
      panelClassName="saga-strip-container"
      overlayComponent={motion.div}
      overlayProps={{
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.18, ease: 'easeOut' },
      }}
      panelComponent={motion.div}
      panelProps={{
        initial: { opacity: 0, scale: 0.98, y: 12 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.98, y: 12 },
        transition: { duration: 0.2, ease: [0.25, 0, 0.15, 1] },
      }}
    >
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
        {loadState === 'done' && <SagaCompletionBar members={panels} i18n={t} />}
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
                {t.saga_arcs_tab}
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
              {panels.map(panel => {
                if (panel.length > 1) {
                  const titleParts = splitAlternativeTitles(panel);
                  const isPanelActive = panel.some(entry => entry.externalId === activeAlternativeId);
                  const sharedYear = panel[0].year != null && panel.every(entry => entry.year === panel[0].year)
                    ? panel[0].year
                    : null;
                  return (
                <div key={panel.map(item => item.externalId).join('|')} className="saga-strip-item saga-strip-item--alternatives">
                  {(() => {
                    const backgroundEntry = panel.find(item => item.externalId === hoveredAlternativeId)
                      ?? panel.find(item => item.externalId === externalId)
                      ?? panel[0];
                    return (
                      <div className="saga-strip-item-bg">
                        {backgroundEntry.cover && (
                          <img
                            key={backgroundEntry.externalId}
                            className={isEntryCoverHidden(backgroundEntry.externalId) ? 'spoiler-blur' : undefined}
                            src={toMediumCover(backgroundEntry.cover)}
                            alt=""
                          />
                        )}
                        <div className="saga-strip-item-overlay" />
                      </div>
                    );
                  })()}
                  <div
                    className="saga-strip-alternative-stage"
                    onMouseMove={e => {
                      const bounds = e.currentTarget.getBoundingClientRect();
                      const position = Math.min(panel.length - 1, Math.floor(((e.clientX - bounds.left) / bounds.width) * panel.length));
                      const hoveredEntry = panel[position];
                      if (hoveredEntry) {
                        setHoveredAlternativeId(hoveredEntry.externalId);
                        setActiveAlternativeId(hoveredEntry.externalId);
                      }
                    }}
                    onMouseLeave={() => setActiveAlternativeId(null)}
                  >
                    {panel.map(entry => {
                      const isCurrent = entry.externalId === externalId;
                      const isExpanded = activeAlternativeId === entry.externalId;
                      const isCollapsed = isPanelActive && !isExpanded;
                      return (
                        <div
                          key={entry.externalId}
                          className={`saga-strip-alternative-pane-wrap${isExpanded ? ' saga-strip-alternative-pane-wrap--expanded' : ''}${isCollapsed ? ' saga-strip-alternative-pane-wrap--collapsed' : ''}`}
                        >
                          {showFormatTooltips && entry.format && (
                            <span className="saga-strip-format-tooltip">
                              {lookupLabel(t.formats, entry.format, entry.format)}
                            </span>
                          )}
                          <a
                            className={`saga-strip-alternative-pane${isCurrent ? ' saga-strip-alternative-pane--current' : ''}`}
                            href={`/media?id=${encodeURIComponent(entry.externalId)}`}
                            onMouseEnter={() => {
                              setHoveredAlternativeId(entry.externalId);
                              setActiveAlternativeId(entry.externalId);
                            }}
                            onClick={e => { if (isCurrent) e.preventDefault(); }}
                            aria-label={entry.title}
                          >
                            {isCurrent && <span className="saga-strip-item-current-indicator" />}
                            {entry.cover
                              ? <img className={`saga-strip-alternative-half-image${isEntryCoverHidden(entry.externalId) ? ' spoiler-blur' : ''}`} src={toMediumCover(entry.cover)} alt="" loading="lazy" />
                              : <div className="saga-strip-item-cover-fallback" />}
                          </a>
                        </div>
                      );
                    })}
                  </div>
                  <div className="saga-strip-alternative-variants">
                    {panel.map((entry, index) => (
                      <span key={entry.externalId} className="saga-strip-item-title">
                        {titleParts ? titleParts.variants[index] : entry.title}
                      </span>
                    ))}
                  </div>
                  {(titleParts || sharedYear) && (
                    <div className="saga-strip-alternative-footer">
                      <span className="saga-strip-item-title">{titleParts?.root ?? ''}</span>
                      <span className="saga-strip-item-year">{sharedYear ?? ''}</span>
                    </div>
                  )}
                </div>
                  );
                }
                return panel.map(entry => {
                const isCurrent = entry.externalId === externalId;
                const coverHidden = isEntryCoverHidden(entry.externalId);
                return (
                  <a
                    key={entry.externalId}
                    className={`saga-strip-item${isCurrent ? ' saga-strip-item--current' : ''}`}
                    href={`/media?id=${encodeURIComponent(entry.externalId)}`}
                    onClick={e => { if (isCurrent) e.preventDefault(); }}
                  >
                    <div className={`saga-strip-item-bg${coverHidden ? ' spoiler-blur' : ''}`}>
                      {entry.cover && <img src={toMediumCover(entry.cover)} alt="" />}
                      <div className="saga-strip-item-overlay" />
                    </div>

                    {isCurrent && <span className="saga-strip-item-current-indicator" />}

                    <div className="saga-strip-cover-wrap">
                      {showFormatTooltips && entry.format && (
                        <span className="saga-strip-format-tooltip">
                          {lookupLabel(t.formats, entry.format, entry.format)}
                        </span>
                      )}
                      <div className={`saga-strip-item-cover${coverHidden ? ' spoiler-blur' : ''}`}>
                        {entry.cover
                          ? <img className="cover-image-fill" src={toMediumCover(entry.cover)} alt="" loading="lazy" />
                          : <div className="saga-strip-item-cover-fallback" />}
                      </div>
                      {coverHidden && entry.cover && (
                        <SpoilerChip element="span" onReveal={() => reveal(spoilerItemKey.cover(entry.externalId))} />
                      )}
                    </div>

                    <div className="saga-strip-item-info">
                      <span className="saga-strip-item-title">{entry.title}</span>
                      <div className="saga-strip-item-meta-row">
                        {entry.year && <span className="saga-strip-item-year">{entry.year}</span>}
                      </div>
                    </div>
                  </a>
                );
                });
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
                const arcHidden = isArcHidden(arc);
                return (
                  <div
                    key={arc.id}
                    className="saga-strip-item saga-strip-item--arc"
                    onMouseEnter={e => {
                      if (arcHidden) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      setHoveredArcId(arc.id);
                      setHoverPanelPos({ top: rect.top, left: rect.right + 12 });
                    }}
                    onMouseLeave={() => { setHoveredArcId(null); setHoverPanelPos(null); }}
                  >
                    <div className={`saga-strip-item-bg${arcHidden ? ' spoiler-blur' : ''}`}>
                      {arc.image_base64 && <img src={wrapAssetUrl(arc.image_base64)} alt="" />}
                      <div className="saga-strip-item-overlay" />
                    </div>

                    <div className={`saga-strip-item-cover${arcHidden ? ' spoiler-blur' : ''}`}>
                      {arc.image_base64
                        ? <img className="cover-image-fill" src={wrapAssetUrl(arc.image_base64)} alt="" loading="lazy" />
                        : <div className="saga-strip-item-cover-fallback" />}
                    </div>

                    <div className="saga-strip-item-info">
                      <span className={`saga-strip-item-title${arcHidden ? ' spoiler-blur-text' : ''}`} aria-hidden={arcHidden || undefined}>{arc.name}</span>
                      <div className="saga-strip-item-meta-row">
                        {range && <span className="saga-strip-item-year">{range}</span>}
                        {!single && <span className="saga-strip-item-badge">{arc.items.length} obras</span>}
                      </div>
                    </div>
                    {arcHidden && <SpoilerChip onReveal={() => reveal(spoilerItemKey.arc(arc.id))} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>
          </>
        )}

        <button type="button" className="saga-strip-close" onClick={onClose}>
          <IconX size={20} />
        </button>
    </ModalShell>
  );

  const hoveredArc = sagaArcs.find(a => a.id === hoveredArcId);

  return (
    <>
      {modal}
      {hoveredArc && hoverPanelPos && createPortal(
        <div className="saga-arc-hover-panel" style={{ top: hoverPanelPos.top, left: hoverPanelPos.left }}>
          {hoveredArc.items.map(item => {
            const itemRange = formatItemRange(item);
            const meta = metaForId(item.media_external_id);
            return (
              <div key={item.id} className="saga-arc-hover-row">
                {meta.cover
                  ? <img className="saga-arc-hover-row-cover" src={toMediumCover(meta.cover)} alt="" />
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
