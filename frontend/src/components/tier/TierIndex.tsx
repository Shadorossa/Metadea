import { useState, useEffect } from 'react';
import { getAllTierLists, getAllCatalogEntries, createTierList, deleteTierList } from '../../lib/tauri';
import type { TierListInfo, MediaCatalogEntry } from '../../lib/tauri';
import { getT } from '../../i18n/client';
import { HOF_GRADIENTS } from '../../lib/profile/hof';

export default function TierIndex() {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => { setIsMounted(true); }, []);

  const t = getT().tier;

  const [search, setSearch]     = useState('');
  const [lists, setLists]       = useState<TierListInfo[]>([]);
  const [catalogMap, setCatalogMap] = useState<Map<string, MediaCatalogEntry>>(new Map());
  const [loading, setLoading]   = useState(true);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName]       = useState('');
  const [newType, setNewType]       = useState<'works' | 'characters'>('works');
  const [creating, setCreating]     = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = () => {
    Promise.all([getAllTierLists(), getAllCatalogEntries().catch(() => [] as MediaCatalogEntry[])])
      .then(([tierLists, catalog]) => {
        setLists(tierLists);
        setCatalogMap(new Map(catalog.map(e => [e.external_id, e])));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(load, []);

  const handleDelete = async (list: TierListInfo, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`¿Eliminar la tier list "${list.name}"? Esta acción no se puede deshacer.`)) return;
    setDeletingId(list.id);
    try {
      await deleteTierList(list.id);
      setLists(prev => prev.filter(l => l.id !== list.id));
    } catch (err) {
      console.error('delete_tier_list error', err);
    } finally {
      setDeletingId(null);
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const id = await createTierList(name, newType);
      window.location.href = `/tier/new?id=${encodeURIComponent(id)}`;
    } catch (e) {
      console.error('create_tier_list error', e);
      setCreating(false);
    }
  };

  return (
    <div className="tier-index">
      <div className="tier-index-header">
        <h1 suppressHydrationWarning className="tier-index-title">{t.title}</h1>
        <button type="button" className="tier-index-create-btn" onClick={() => setShowCreate(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          {t.create}
        </button>
      </div>

      <div className="tier-index-search-wrap">
        <svg className="tier-index-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="22" y2="22"/>
        </svg>
        <input
          className="tier-index-search"
          type="text"
          placeholder={t.search_ph}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {search ? (
        <div className="tier-index-empty">
          <p>{t.search_soon}</p>
        </div>
      ) : loading ? (
        <div className="tier-loading">…</div>
      ) : lists.length === 0 ? (
        <div className="tier-index-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.25">
            <rect x="3" y="3" width="18" height="5" rx="1"/>
            <rect x="3" y="10" width="18" height="5" rx="1"/>
            <rect x="3" y="17" width="18" height="5" rx="1"/>
          </svg>
          <p>{t.no_saved_lists}</p>
          <button type="button" className="tier-index-create-btn" onClick={() => setShowCreate(true)}>
            {t.create_first}
          </button>
        </div>
      ) : (
        <div className="tier-index-grid">
          {lists.map(list => (
            <a key={list.id} className="tier-index-card" href={`/tier/new?id=${encodeURIComponent(list.id)}`}>
              <button
                type="button"
                className="tier-index-card-delete-btn"
                onClick={e => handleDelete(list, e)}
                disabled={deletingId === list.id}
                title={t.delete_title}
                aria-label={t.delete_title}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  <line x1="10" y1="11" x2="10" y2="17"/>
                  <line x1="14" y1="11" x2="14" y2="17"/>
                </svg>
              </button>
              <div className="tier-index-card-collage">
                {list.preview_ids.length > 0
                  ? list.preview_ids.map((id, i) => {
                      const meta = catalogMap.get(id);
                      const cover = meta?.cover_url;
                      const fallback = HOF_GRADIENTS[meta?.type ?? 'anime'] ?? 'linear-gradient(160deg,#374151,#1f2937)';
                      return cover
                        ? <img key={i} className="tier-index-card-collage-img" src={cover} alt="" loading="lazy" />
                        : <div key={i} className="tier-index-card-collage-img tier-index-card-collage-fallback" style={{ background: fallback }} />;
                    })
                  : <span className="tier-index-card-empty-icon">🏆</span>
                }
              </div>
              <div className="tier-index-card-info">
                <span className="tier-index-card-title">{list.name}</span>
                <span className="tier-index-card-meta">
                  {list.list_type === 'characters' ? t.type_characters : t.type_works} · {list.item_count}
                </span>
              </div>
            </a>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="tier-create-backdrop" onClick={() => !creating && setShowCreate(false)}>
          <div className="tier-create-modal" onClick={e => e.stopPropagation()}>
            <h3 className="tier-create-modal-title">{t.create_modal_title}</h3>

            <label className="tier-create-label">{t.name_label}</label>
            <input
              className="tier-create-input"
              type="text"
              placeholder={t.name_ph}
              maxLength={60}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              autoFocus
            />

            <label className="tier-create-label">{t.type_label}</label>
            <select
              className="tier-create-input"
              value={newType}
              onChange={e => setNewType(e.target.value as 'works' | 'characters')}
            >
              <option value="works">{t.type_works}</option>
              <option value="characters">{t.type_characters}</option>
            </select>

            <div className="tier-create-actions">
              <button type="button" className="tier-create-btn tier-create-btn--primary"
                disabled={!newName.trim() || creating} onClick={handleCreate}>
                {t.create_confirm}
              </button>
              <button type="button" className="tier-create-btn tier-create-btn--ghost"
                disabled={creating} onClick={() => setShowCreate(false)}>
                {t.create_cancel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
