import { useEffect, useState } from 'react';
import type { Translations } from '../../i18n/index';
import { useOwnerGate } from '../../lib/github/useOwnerGate';
import { getAllCatalogEntries, searchCatalog, deleteCatalogEntry, type MediaCatalogEntry } from '../../lib/tauri/catalog';
import { PrEditorModal } from '../media/PrEditorModal';
import { IconPencil, IconTrash } from '../local/ui/icons';

interface Props {
  i18n: Pick<Translations, 'media' | 'discord' | 'admin'>;
}

export function CatalogAdminPanel({ i18n }: Props) {
  const gate = useOwnerGate();
  const t = i18n.admin;

  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<MediaCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MediaCatalogEntry | null>(null);

  const isOwner = gate.state === 'owner';

  const loadEntries = async (q: string) => {
    setLoading(true);
    try {
      const list = q.trim() ? await searchCatalog(q.trim()) : await getAllCatalogEntries();
      setEntries(list);
    } catch (err) {
      console.error('[CatalogAdminPanel] Failed to load entries:', err);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOwner) return;
    loadEntries(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner]);

  useEffect(() => {
    if (!isOwner) return;
    const handle = setTimeout(() => loadEntries(query), 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  if (gate.state === 'loading') return null;
  if (!isOwner) {
    return (
      <main className="placeholder-page">
        <h1 className="placeholder-title">{t.title}</h1>
        <p className="placeholder-text">{t.not_owner}</p>
      </main>
    );
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteCatalogEntry(deleteTarget.external_id);
      setEntries(prev => prev.filter(e => e.external_id !== deleteTarget.external_id));
    } catch (err) {
      console.error('[CatalogAdminPanel] Failed to delete entry:', err);
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="catalog-admin-panel">
      <h1 className="catalog-admin-title">{t.title}</h1>

      <input
        type="text"
        className="catalog-admin-search"
        placeholder={t.search_placeholder}
        value={query}
        onChange={e => setQuery(e.target.value)}
      />

      {loading && <p className="catalog-admin-status">{t.loading}</p>}
      {!loading && entries.length === 0 && <p className="catalog-admin-status">{t.no_entries}</p>}

      {!loading && entries.length > 0 && (
        <div className="catalog-admin-list">
          {entries.map(entry => (
            <div key={entry.external_id} className="catalog-admin-item">
              <div className="catalog-admin-item-info">
                <span className="catalog-admin-item-title">{entry.title_main || entry.external_id}</span>
                <span className="catalog-admin-item-meta">{entry.external_id}</span>
              </div>
              <div className="catalog-admin-item-actions">
                <button type="button" className="catalog-admin-edit-btn" onClick={() => setEditingId(entry.external_id)} title={t.edit_button}>
                  <IconPencil size={13} />
                  {t.edit_button}
                </button>
                <button type="button" className="catalog-admin-delete-btn" onClick={() => setDeleteTarget(entry)} title={t.delete_button}>
                  <IconTrash size={13} />
                  {t.delete_button}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editingId && (
        <PrEditorModal
          externalId={editingId}
          mode="local"
          onClose={() => setEditingId(null)}
          onSaved={() => loadEntries(query)}
        />
      )}

      {deleteTarget && (
        <div className="me-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="catalog-admin-confirm" onClick={e => e.stopPropagation()}>
            <p>{t.delete_confirm.replace('{title}', deleteTarget.title_main || deleteTarget.external_id)}</p>
            <div className="catalog-admin-confirm-actions">
              <button type="button" className="catalog-admin-confirm-cancel" onClick={() => setDeleteTarget(null)}>
                {t.cancel_button}
              </button>
              <button type="button" className="catalog-admin-confirm-delete" onClick={confirmDelete}>
                {t.delete_button}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
