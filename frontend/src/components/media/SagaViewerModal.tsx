import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Translations } from '../../i18n/index';
import { fetchAniListSaga, type SagaEntry } from '../../lib/anilist/saga';
import { IconX } from '../local/ui/icons';
import { compareByReleaseDate, lookupLabel } from '../../lib/media/mapper-utils';
import { reconstructSagaOrder } from '../../lib/media/sagaGrouping';
import { useClosingTransition } from '../../lib/shared/useClosingTransition';

import { getCachedSaga, saveCachedSaga, getSagaName, getMediaRelations } from '../../lib/tauri';
import { getCatalogEntry, type MediaCatalogEntry, type DbMediaRelation } from '../../lib/tauri/catalog';
import { getStoryArcsForMedia, type StoryArc } from '../../lib/tauri/story-arcs';

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

  useEffect(() => {
    const numericId = parseInt(externalId.slice(externalId.indexOf(':') + 1), 10);
    if (!numericId) { setLoadState('error'); return; }

    let cancelled = false;

    // Reconstructs the manually-curated order from SEQUEL edges (same
    // function PrEditorModal uses) instead of just release-date order. Null
    // if this isn't part of a multi-entry saga at all.
    async function reconstructFromRelations(): Promise<SagaEntry[] | null> {
      const { invoke } = await import('@tauri-apps/api/core');
      const { getCatalogEntry } = await import('../../lib/tauri/catalog');
      const transitiveIds = await invoke<string[]>('get_transitive_relation_ids', { mediaExternalId: externalId }).catch(() => [] as string[]);
      if (transitiveIds.length <= 1) return null;

      const entriesData = await Promise.all(
        transitiveIds.map(async id => ({ id, entry: await getCatalogEntry(id).catch(() => null) }))
      );
      const validEntries = entriesData.filter(
        (x): x is { id: string; entry: MediaCatalogEntry } => x.entry !== null,
      );

      // Date sort is just the tie-break input for reconstructSagaOrder below.
      validEntries.sort((a, b) => compareByReleaseDate(
        { ...a.entry, id: a.id },
        { ...b.entry, id: b.id }
      ));

      const byId = new Map(validEntries.map(x => [x.id, x.entry]));
      const dateOrderedIds = validEntries.map(x => x.id);
      const relsByIndex: DbMediaRelation[][] = await Promise.all(
        dateOrderedIds.map(id => getMediaRelations(id).catch(() => [] as DbMediaRelation[]))
      );
      const orderedIds = reconstructSagaOrder(dateOrderedIds, relsByIndex);

      return orderedIds.map(id => {
        const entry = byId.get(id)!;
        return {
          externalId: id,
          title: entry.title_main || id,
          cover: entry.cover_url || null,
          format: entry.format || null,
          mediaType: entry.type || 'game',
          year: entry.release_year ?? null,
          month: entry.release_month ?? null,
          day: entry.release_day ?? null,
        };
      });
    }

    const sameOrder = (a: SagaEntry[], b: SagaEntry[]) =>
      a.length === b.length && a.every((e, i) => e.externalId === b[i].externalId);

    async function loadSaga() {
      let cached: SagaEntry[] | null = null;
      try {
        cached = await getCachedSaga(externalId);
      } catch (err) {
        console.warn('[Saga] Failed to read from cache:', err);
      }

      if (cancelled) return;

      if (cached && cached.length > 0) {
        setEntries(cached);
        setLoadState('done');
        try {
          const customName = await getSagaName(externalId);
          if (customName) setSagaTitle(customName);
        } catch (err) {
          console.warn('[Saga] Failed to load custom saga name:', err);
        }

        // The cache doesn't get invalidated when relations change elsewhere
        // (e.g. a saga reorder saved before this fix existed) — reconcile
        // against the real relations in the background and correct it if
        // it's out of date.
        reconstructFromRelations().then(fresh => {
          if (cancelled || !fresh || sameOrder(fresh, cached!)) return;
          setEntries(fresh);
          saveCachedSaga(fresh).catch(() => {});
        }).catch(err => console.warn('[Saga] Background reconcile failed:', err));
        return;
      }

      try {
        const sagaList = await reconstructFromRelations();
        if (sagaList) {
          setEntries(sagaList);
          setLoadState('done');
          saveCachedSaga(sagaList).catch(err => {
            console.warn('[Saga] Failed to save to cache:', err);
          });
          try {
            const customName = await getSagaName(externalId);
            if (customName) setSagaTitle(customName);
          } catch (err) {
            console.warn('[Saga] Failed to load custom saga name:', err);
          }
          return;
        }
      } catch (err) {
        console.warn('[Saga] Failed to load transitive relations:', err);
      }

      if (!externalId.startsWith('anime:') && !externalId.startsWith('manga:')) {
        setLoadState('error');
        return;
      }

      try {
        const result = await fetchAniListSaga(numericId);
        if (cancelled) return;

        if (result.length > 0) {
          setEntries(result);
          setLoadState('done');
          // Load custom saga name if available
          try {
            const customName = await getSagaName(externalId);
            if (customName) setSagaTitle(customName);
          } catch (err) {
            console.warn('[Saga] Failed to load custom saga name:', err);
          }
          saveCachedSaga(result).catch(err => {
            console.warn('[Saga] Failed to save to cache:', err);
          });
        } else {
          setLoadState('error');
        }
      } catch (err) {
        if (!cancelled) setLoadState('error');
      }
    }

    loadSaga();

    return () => { cancelled = true; };
  }, [externalId]);

  // Fetches every entry's own arcs in parallel once the chain itself is
  // known, then dedupes by arc id — an arc with items in several entries
  // (e.g. Sennen Kessen-hen's 4 parts) would otherwise show up once per
  // entry it touches instead of once overall.
  useEffect(() => {
    if (entries.length === 0) return;
    let cancelled = false;
    Promise.all(entries.map(e => getStoryArcsForMedia(e.externalId).catch(() => [] as StoryArc[])))
      .then(async perEntryArcs => {
        if (cancelled) return;
        const byId = new Map<string, StoryArc>();
        for (const arcs of perEntryArcs) {
          for (const arc of arcs) byId.set(arc.id, arc);
        }
        const arcs = [...byId.values()];
        setSagaArcs(arcs);

        const knownIds = new Set(entries.map(e => e.externalId));
        const missingIds = new Set<string>();
        for (const arc of arcs) {
          for (const item of arc.items) {
            if (!knownIds.has(item.media_external_id)) missingIds.add(item.media_external_id);
          }
        }
        if (missingIds.size === 0) return;
        const metaEntries = await Promise.all(
          [...missingIds].map(async id => [id, await getCatalogEntry(id).catch(() => null)] as const)
        );
        if (cancelled) return;
        setArcItemMeta(prev => {
          const next = { ...prev };
          for (const [id, entry] of metaEntries) {
            if (entry) next[id] = { title: entry.title_main || id, cover: entry.cover_url || null };
          }
          return next;
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [entries]);

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
