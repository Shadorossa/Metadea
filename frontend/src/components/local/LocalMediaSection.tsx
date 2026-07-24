import React, { useState } from 'react';
import { getT } from '../../i18n/client';
import type { LocalFolderEntry } from '../../lib/tauri';
import { useLocalMediaEntries } from './hooks/useLocalMediaEntries';
import { LocalMediaCard } from './cards/LocalMediaCard';
import { LocalMediaDetailPanel } from './details/LocalMediaDetailPanel';
import { IconFolder, IconPlus, IconX } from './ui/icons';
import type { CategoryId } from './utils/constants';

interface LocalMediaSectionProps {
  category:     CategoryId;
  rootFolder:   string | undefined;
  rootEntries:  LocalFolderEntry[];
  rootLoading:  boolean;
  onSetRoute:   () => void;
  onClearRoute: () => void;
}

// Shows the library entries (watching/reading/playing + planning) for a
// media category as a card grid, and — on click — opens a side panel that
// tries to match the work to a subfolder of the category's assigned local
// folder and to the file for the episode/chapter the user is currently on.
export function LocalMediaSection({ category, rootFolder, rootEntries, rootLoading, onSetRoute, onClearRoute }: LocalMediaSectionProps) {
  const t = getT();
  const { items, loading, refetch } = useLocalMediaEntries(category);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Looked up by id (rather than kept as its own object) so that after
  // refetch() runs — e.g. once auto-mark-watched saves — the panel picks up
  // the fresh progress/status without any manual sync logic.
  const selected = selectedId ? items.find(i => i.externalId === selectedId) ?? null : null;

  return (
    <div className={`local-games-container${selected ? ' with-detail' : ''}`}>
      <div className="local-main-content">
        <div className="local-content">
          <div className="local-content-header">
            <span className="local-content-count">
              {!loading ? `${items.length} obra${items.length !== 1 ? 's' : ''} en tu biblioteca` : ''}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {rootFolder && (
                <>
                  <span className="local-folder-path" style={{ fontSize: '0.7rem' }}>{rootFolder}</span>
                  <button type="button" className="local-refresh-btn" onClick={onClearRoute} title={t.local.remove_local_folder} style={{ color: 'var(--color-error, #ff6b6b)' }}>
                    <IconX />
                  </button>
                </>
              )}
              <button type="button" className="local-refresh-btn" onClick={onSetRoute} title={rootFolder ? t.local.change_folder : t.local.add_folder}>
                <IconFolder />
              </button>
            </div>
          </div>

          {loading ? (
            <div className="local-state-placeholder"><div className="spinner" /></div>
          ) : items.length === 0 ? (
            <div className="local-state-placeholder">
              <IconFolder />
              <p>No tienes obras de este tipo en biblioteca (viendo/leyendo/jugando o pendientes)</p>
            </div>
          ) : (
            <div className="local-games-grid">
              {items.map(item => (
                <LocalMediaCard key={item.externalId} item={item} onClick={i => setSelectedId(i.externalId)} />
              ))}
            </div>
          )}

          {!rootFolder && (
            <div className="local-state-placeholder" style={{ marginTop: '1rem' }}>
              <IconFolder />
              <p>{t.local.no_folder_assigned}</p>
              <span>{t.local.choose_folder_episodes_hint}</span>
              <button type="button" className="local-add-route-btn" onClick={onSetRoute}>
                <IconPlus /> Añadir ruta
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
        />
      )}
    </div>
  );
}
