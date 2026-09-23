import { useEffect, useMemo, useState } from 'react';
import { createTierList, deleteTierList, duplicateTierList, getAllTierLists, type TierListInfo } from '../../lib/tauri/tier-lists';
import { renameTierList } from '../../lib/tier/tier-list-actions';
import { TIER_NAME_MAX_LENGTH } from '../../lib/tier/tier-editor-state';
import { formatAppError } from '../../lib/errors/format-error';
import { showToast } from '../../lib/dom/toast';
import { getT } from '../../i18n/runtime';
import { IconTrash } from '../local/ui/icons';
import { ModalShell } from '../shared/ModalShell';
import { TierListPreview } from './TierListPreview';

// /tier — the user's tier lists, most recently edited first, each with a
// mini preview of its top rows. Create, rename, duplicate and delete here;
// everything else happens in the editor (/tier/new?id=…).

function editorHref(id: string): string {
  return `/tier/new?id=${encodeURIComponent(id)}`;
}

function formatDate(value: string): string {
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
}

export default function TierIndex() {
  const tAll = getT();
  const t = tAll.tier;
  const [lists, setLists] = useState<TierListInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'works' | 'characters'>('works');
  const [creating, setCreating] = useState(false);

  const reload = () => getAllTierLists().then(setLists).finally(() => setLoading(false));
  useEffect(() => { void reload(); }, []);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? lists.filter(l => l.name.toLowerCase().includes(q) || l.description.toLowerCase().includes(q)) : lists;
  }, [lists, filter]);

  const fail = (err: unknown) => {
    console.error('tier list action failed', err);
    showToast(`${t.action_failed} ${formatAppError(err, tAll)}`, 'error');
  };

  const run = async (id: string, action: () => Promise<unknown>) => {
    setBusyId(id);
    try { await action(); await reload(); } catch (err) { fail(err); } finally { setBusyId(null); }
  };

  const handleDelete = (list: TierListInfo) => {
    if (!confirm(t.delete_confirm)) return;
    void run(list.id, () => deleteTierList(list.id));
  };

  const handleDuplicate = (list: TierListInfo) => {
    void run(list.id, () => duplicateTierList(list.id, t.duplicate_name.replace('{name}', list.name).slice(0, TIER_NAME_MAX_LENGTH)));
  };

  const commitRename = () => {
    if (!renaming) return;
    const { id, name } = renaming;
    setRenaming(null);
    const trimmed = name.trim();
    if (!trimmed || trimmed === lists.find(l => l.id === id)?.name) return;
    void run(id, () => renameTierList(id, trimmed));
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const id = await createTierList(name, newType);
      window.location.assign(editorHref(id));
    } catch (err) {
      fail(err);
      setCreating(false);
    }
  };

  const openCreate = () => { setNewName(''); setShowCreate(true); };

  return (
    <div className="tier-index">
      <header className="tier-index-header">
        <h1 className="tier-index-title">{t.title}</h1>
        <button type="button" className="tier-btn tier-btn--primary" onClick={openCreate}>+ {t.create}</button>
      </header>

      {lists.length > 0 && (
        <input
          className="tier-index-filter"
          type="search"
          value={filter}
          placeholder={t.filter_ph}
          aria-label={t.filter_ph}
          onChange={e => setFilter(e.target.value)}
        />
      )}

      {loading ? (
        <div className="tier-state">{t.loading}</div>
      ) : lists.length === 0 ? (
        <div className="tier-state">
          <p>{t.no_saved_lists}</p>
          <button type="button" className="tier-btn tier-btn--primary" onClick={openCreate}>{t.create_first}</button>
        </div>
      ) : visible.length === 0 ? (
        <div className="tier-state"><p>{t.no_matches.replace('{query}', filter.trim())}</p></div>
      ) : (
        <ul className="tier-index-grid">
          {visible.map(list => (
            <li key={list.id} className={`tier-card${busyId === list.id ? ' tier-card--busy' : ''}`}>
              <a className="tier-card-link" href={editorHref(list.id)} aria-label={list.name}>
                <TierListPreview list={list} />
              </a>
              <div className="tier-card-info">
                {renaming?.id === list.id ? (
                  <input
                    className="tier-card-rename"
                    value={renaming.name}
                    maxLength={TIER_NAME_MAX_LENGTH}
                    aria-label={t.rename_aria}
                    autoFocus
                    onChange={e => setRenaming({ id: list.id, name: e.target.value })}
                    onBlur={commitRename}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                  />
                ) : (
                  <a className="tier-card-title" href={editorHref(list.id)}>{list.name}</a>
                )}
                <span className="tier-card-meta">
                  {list.list_type === 'characters' ? t.type_characters : t.type_works}
                  {' · '}{t.items_count.replace('{count}', String(list.item_count))}
                  {formatDate(list.updated_at) && <> {' · '}{t.updated.replace('{date}', formatDate(list.updated_at))}</>}
                </span>
                {list.is_public && <span className="tier-badge">{t.public_badge}</span>}
              </div>
              <div className="tier-card-actions" role="group" aria-label={t.card_menu}>
                <button type="button" className="tier-icon-btn" aria-label={t.rename} title={t.rename} disabled={busyId !== null}
                  onClick={() => setRenaming({ id: list.id, name: list.name })}>
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                </button>
                <button type="button" className="tier-icon-btn" aria-label={t.duplicate} title={t.duplicate} disabled={busyId !== null}
                  onClick={() => handleDuplicate(list)}>
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M8 8h11v11H8zM5 16V5h11" /></svg>
                </button>
                <button type="button" className="tier-icon-btn tier-icon-btn--danger" aria-label={t.delete_title} title={t.delete_title} disabled={busyId !== null}
                  onClick={() => handleDelete(list)}>
                  <IconTrash />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ModalShell
        open={showCreate}
        onClose={() => { if (!creating) setShowCreate(false); }}
        label={t.create_modal_title}
        overlayClassName="tier-modal-overlay"
        panelClassName="tier-modal tier-create"
      >
        <form onSubmit={e => { e.preventDefault(); void handleCreate(); }}>
          <h2 className="tier-modal-title">{t.create_modal_title}</h2>
          <label className="tier-field tier-field--wide">
            <span>{t.name_label}</span>
            <input type="text" placeholder={t.name_ph} maxLength={TIER_NAME_MAX_LENGTH} value={newName} autoFocus onChange={e => setNewName(e.target.value)} />
          </label>
          <label className="tier-field tier-field--wide">
            <span>{t.type_label}</span>
            <select value={newType} onChange={e => setNewType(e.target.value as 'works' | 'characters')}>
              <option value="works">{t.type_works}</option>
              <option value="characters">{t.type_characters}</option>
            </select>
          </label>
          <div className="tier-modal-actions">
            <button type="button" className="tier-btn" disabled={creating} onClick={() => setShowCreate(false)}>{t.create_cancel}</button>
            <button type="submit" className="tier-btn tier-btn--primary" disabled={!newName.trim() || creating}>{t.create_confirm}</button>
          </div>
        </form>
      </ModalShell>
    </div>
  );
}
