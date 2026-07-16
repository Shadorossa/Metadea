import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { Translations } from '../../i18n/index';
import { fetchAniListSaga, type SagaEntry } from '../../lib/anilist/saga';
import { IconX } from '../local/ui/icons';
import { compareByReleaseDate, lookupLabel } from '../../lib/media/mapper-utils';
import { reconstructSagaOrder } from '../../lib/media/sagaGrouping';

import { getCachedSaga, saveCachedSaga, getSagaName, getMediaRelations } from '../../lib/tauri';
import type { MediaCatalogEntry, DbMediaRelation } from '../../lib/tauri/catalog';

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
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    const numericId = parseInt(externalId.slice(externalId.indexOf(':') + 1), 10);
    if (!numericId) { setLoadState('error'); return; }

    let cancelled = false;

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
        // Load custom saga name if available
        try {
          const customName = await getSagaName(externalId);
          if (customName) setSagaTitle(customName);
        } catch (err) {
          console.warn('[Saga] Failed to load custom saga name:', err);
        }
        return;
      }

      // Fallback: build from transitive relations in database!
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const { getCatalogEntry } = await import('../../lib/tauri/catalog');
        const transitiveIds = await invoke<string[]>('get_transitive_relation_ids', { mediaExternalId: externalId }).catch(() => [] as string[]);
        
        if (transitiveIds.length > 1) {
          const entriesData = await Promise.all(
            transitiveIds.map(async id => {
              const c = await getCatalogEntry(id).catch(() => null);
              return { id, entry: c };
            })
          );
          const validEntries = entriesData.filter(
            (x): x is { id: string; entry: MediaCatalogEntry } => x.entry !== null,
          );

          // Date sort is just the tie-break input for reconstructSagaOrder
          // below, not the final order.
          validEntries.sort((a, b) => compareByReleaseDate(
            { ...a.entry, id: a.id },
            { ...b.entry, id: b.id }
          ));

          const byId = new Map(validEntries.map(x => [x.id, x.entry]));
          const dateOrderedIds = validEntries.map(x => x.id);

          // Reconstruct the manually-curated order from SEQUEL edges (same
          // function PrEditorModal uses) instead of just showing date order.
          const relsByIndex: DbMediaRelation[][] = await Promise.all(
            dateOrderedIds.map(id => getMediaRelations(id).catch(() => [] as DbMediaRelation[]))
          );
          const orderedIds = reconstructSagaOrder(dateOrderedIds, relsByIndex);

          const sagaList: SagaEntry[] = orderedIds.map(id => {
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

          setEntries(sagaList);
          setLoadState('done');
          saveCachedSaga(sagaList).catch(err => {
            console.warn('[Saga] Failed to save to cache:', err);
          });
          // Load custom saga name if available
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

  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(onClose, 180);
  }, [onClose]);

  const firstEntry = entries[0];

  const modal = (
    <div className={`me-overlay saga-overlay${isClosing ? ' me-overlay--out' : ''}`} onClick={handleClose}>
      <div className="saga-strip-container" onClick={e => e.stopPropagation()}>
        <div className="saga-strip-header">
          <span className="saga-strip-subtitle">{t.saga_title}</span>
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
          {loadState === 'done' && (
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
        </div>

        <button type="button" className="saga-strip-close" onClick={handleClose}>
          <IconX size={20} />
        </button>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
