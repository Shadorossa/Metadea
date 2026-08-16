import React, { useState, useEffect, useMemo } from 'react';
import { getT } from '../../i18n/client';
import type { LocalFolderEntry } from '../../lib/tauri';
import { useLocalMediaEntries, type LocalMediaItem } from './hooks/useLocalMediaEntries';
import { isInProgressStatus } from '../../lib/constants/media';
import { LocalMediaCard } from './cards/LocalMediaCard';
import { LocalMediaDetailPanel } from './details/LocalMediaDetailPanel';
import { IconFolder, IconPlus, IconX } from './ui/icons';
import type { CategoryId } from './utils/constants';

// null = no release date on file at all (never resolved a catalog entry, or
// the catalog entry itself has no release_year). Same "planning has nothing
// of its own to sort by" gap LibrarySection's own releaseTimestamp works
// around, reused here for the same reason.
function releaseTimestamp(item: LocalMediaItem): number | null {
  const meta = item.catalogEntry;
  if (!meta?.release_year) return null;
  return new Date(meta.release_year, (meta.release_month ?? 1) - 1, meta.release_day ?? 1).getTime();
}

// "Sin estrenar" — no release date on record at all, or one that hasn't
// happened yet — regardless of whether the library entry itself says
// watching or planning; either way there's nothing to actually watch/read
// yet, so it doesn't belong grouped in with things that ARE out already.
function isNotReleasedYet(item: LocalMediaItem): boolean {
  const ts = releaseTimestamp(item);
  return ts === null || ts > Date.now();
}

interface LocalMediaSectionProps {
  category:     CategoryId;
  rootFolder:   string | undefined;
  rootEntries:  LocalFolderEntry[];
  rootLoading:  boolean;
  onSetRoute:   () => void;
  onClearRoute: () => void;
  onRootRefresh: () => Promise<void>;
  // The same tab-bar search box games already used, now shared by every
  // media category too instead of being videojuegos-only.
  filterName:   string;
}

// Shows the library entries (watching/reading/playing + planning) for a
// media category as a card grid, and — on click — opens a side panel that
// tries to match the work to a subfolder of the category's assigned local
// folder and to the file for the episode/chapter the user is currently on.
export function LocalMediaSection({ category, rootFolder, rootEntries, rootLoading, onSetRoute, onClearRoute, onRootRefresh, filterName }: LocalMediaSectionProps) {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => { setIsMounted(true); }, []);

  const t = getT();
  const p = t.profile;
  const { items: allItems, loading, refetch } = useLocalMediaEntries(category);
  const items = useMemo(() => {
    const q = filterName.trim().toLowerCase();
    return q ? allItems.filter(i => i.title.toLowerCase().includes(q)) : allItems;
  }, [allItems, filterName]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? allItems.find(i => i.externalId === selectedId) ?? null : null;

  // Same three-way split the profile's own library sections use (see
  // LibrarySection.tsx's sectionsData) — grouped and labeled the same way,
  // for visual consistency between "your library" and "your local files".
  // "Sin estrenar" is checked first and takes priority over watching/
  // planning: nothing without a release date, or a future one, actually has
  // anything to watch/read yet regardless of which status it's tracked
  // under.
  const sections = useMemo(() => {
    const notReleased = items.filter(isNotReleasedYet);
    const released = items.filter(i => !isNotReleasedYet(i));
    return [
      { title: p.section_in_progress, items: released.filter(i => isInProgressStatus(i.status)) },
      { title: p.section_planning, items: released.filter(i => i.status === 'planning') },
      { title: 'Sin estrenar', items: notReleased },
    ].filter(s => s.items.length > 0);
  }, [items, p]);

  return (
    <div className={`local-games-container${selected ? ' with-detail' : ''}`}>
      <div className="local-main-content">
        <div className="local-content">
          <div className="local-content-header">
            <span className="local-content-count">
              {!loading ? (items.length !== 1 ? (isMounted ? t.local.media_count_plural : '{count} obras en tu biblioteca').replace('{count}', String(items.length)) : (isMounted ? t.local.media_count_singular : '{count} obra en tu biblioteca').replace('{count}', String(items.length))) : ''}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {rootFolder && (
                <>
                  <span className="local-folder-path" style={{ fontSize: '0.7rem' }}>{rootFolder}</span>
                  <button type="button" className="local-refresh-btn" onClick={onClearRoute} title={isMounted ? t.local.remove_local_folder : 'Quitar carpeta local'} style={{ color: 'var(--color-error, #ff6b6b)' }}>
                    <IconX />
                  </button>
                </>
              )}
              <button type="button" className="local-refresh-btn" onClick={onSetRoute} title={isMounted ? (rootFolder ? t.local.change_folder : t.local.add_folder) : (rootFolder ? 'Cambiar carpeta' : 'Añadir carpeta')}>
                <IconFolder />
              </button>
            </div>
          </div>

          {loading ? (
            <div className="local-state-placeholder"><div className="spinner" /></div>
          ) : items.length === 0 ? (
            <div className="local-state-placeholder">
              <IconFolder />
              <p>{isMounted ? t.local.empty_category_media : 'No tienes obras de este tipo en biblioteca (viendo/leyendo/jugando o pendientes)'}</p>
            </div>
          ) : (
            <div className="library-sections-list">
              {sections.map(sec => (
                <div className="library-section" key={sec.title}>
                  <h3 className="library-section-title">{sec.title}</h3>
                  <div className="local-games-grid">
                    {sec.items.map(item => (
                      <LocalMediaCard key={item.externalId} item={item} onClick={i => setSelectedId(i.externalId)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!rootFolder && (
            <div className="local-state-placeholder" style={{ marginTop: '1rem' }}>
              <IconFolder />
              <p>{isMounted ? t.local.no_folder_assigned : 'Sin carpeta asignada'}</p>
              <span>{isMounted ? t.local.choose_folder_episodes_hint : 'Elige una carpeta para poder detectar tus episodios/capítulos locales'}</span>
              <button type="button" className="local-add-route-btn" onClick={onSetRoute}>
                <IconPlus /> {isMounted ? t.local.add_route : 'Añadir ruta'}
              </button>
            </div>
          )}
        </div>
      </div>

      {selected && (
        <LocalMediaDetailPanel
          item={selected}
          rootFolder={rootFolder}
          rootEntries={rootEntries}
          rootLoading={rootLoading}
          onClose={() => setSelectedId(null)}
          onProgressSaved={refetch}
          onRootRefresh={onRootRefresh}
        />
      )}
    </div>
  );
}
