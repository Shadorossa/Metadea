import { useEffect, useState } from 'react';
import type { Translations } from '../../i18n/index';
import { useOwnerGate } from '../../lib/github/useOwnerGate';
import { getAllCatalogEntries, searchCatalog, deleteCatalogEntry, type MediaCatalogEntry } from '../../lib/tauri/catalog';
import {
  listDatabaseFiles, getFileAtRef, commitFileToMain, deleteFileFromMain, externalIdFromDatabaseFilename,
  type GitHubDirEntry,
} from '../../lib/github/api';
import { hydrateBundleIntoLocalCatalog, buildBundleFromLocal } from '../../lib/github/bundle-sync';
import type { ProposalBundle } from '../../lib/github/submitCollaborativeProposal';
import { PrEditorModal } from '../media/PrEditorModal';
import { IconPencil, IconTrash } from '../local/ui/icons';

interface Props {
  i18n: Pick<Translations, 'media' | 'discord' | 'admin'>;
}

type Source = 'local' | 'github';

interface GithubEditTarget {
  externalId: string;
  path: string;
  sha: string;
}

export function CatalogAdminPanel({ i18n }: Props) {
  const gate = useOwnerGate();
  const t = i18n.admin;

  const [source, setSource] = useState<Source>('local');

  // Local catalog state
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<MediaCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<MediaCatalogEntry | null>(null);

  // GitHub database/ state
  const [githubQuery, setGithubQuery] = useState('');
  const [githubFiles, setGithubFiles] = useState<GitHubDirEntry[]>([]);
  const [githubLoading, setGithubLoading] = useState(true);
  const [githubDeleteTarget, setGithubDeleteTarget] = useState<GitHubDirEntry | null>(null);
  const [githubBusy, setGithubBusy] = useState(false);

  // Editor state — shared between both sources; githubEditTarget is set only
  // when the entry being edited came from GitHub, so onSaved knows whether to
  // push the result back to main afterward.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [githubEditTarget, setGithubEditTarget] = useState<GithubEditTarget | null>(null);

  const isOwner = gate.state === 'owner';
  const token = gate.token;

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

  const loadGithubFiles = async () => {
    if (!token) return;
    setGithubLoading(true);
    try {
      setGithubFiles(await listDatabaseFiles(token));
    } catch (err) {
      console.error('[CatalogAdminPanel] Failed to list GitHub database files:', err);
      setGithubFiles([]);
    } finally {
      setGithubLoading(false);
    }
  };

  useEffect(() => {
    if (!isOwner) return;
    loadEntries(query);
    loadGithubFiles();
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

  const confirmDeleteLocal = async () => {
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

  const openGithubEntry = async (file: GitHubDirEntry) => {
    if (!token || githubBusy) return;
    setGithubBusy(true);
    try {
      const { content, sha } = await getFileAtRef(token, file.path, 'main');
      const bundle = JSON.parse(content) as ProposalBundle;
      await hydrateBundleIntoLocalCatalog(bundle);
      setGithubEditTarget({ externalId: bundle.media_catalog.external_id, path: file.path, sha });
      setEditingId(bundle.media_catalog.external_id);
    } catch (err) {
      console.error('[CatalogAdminPanel] Failed to open GitHub entry:', err);
      alert(t.github_open_error);
    } finally {
      setGithubBusy(false);
    }
  };

  const confirmDeleteGithub = async () => {
    if (!githubDeleteTarget || !token) return;
    try {
      const { sha } = await getFileAtRef(token, githubDeleteTarget.path, 'main');
      await deleteFileFromMain(token, githubDeleteTarget.path, sha, `Delete ${githubDeleteTarget.path} via Metadea admin panel`);
      setGithubFiles(prev => prev.filter(f => f.path !== githubDeleteTarget.path));
    } catch (err) {
      console.error('[CatalogAdminPanel] Failed to delete GitHub entry:', err);
      alert(t.github_delete_error);
    } finally {
      setGithubDeleteTarget(null);
    }
  };

  const handleEditorClose = () => {
    setEditingId(null);
    setGithubEditTarget(null);
  };

  const handleEditorSaved = async () => {
    loadEntries(query);
    if (!githubEditTarget || !token) return;
    try {
      const bundle = await buildBundleFromLocal(githubEditTarget.externalId);
      if (!bundle) return;
      await commitFileToMain(
        token,
        githubEditTarget.path,
        JSON.stringify(bundle, null, 2),
        githubEditTarget.sha,
        `Update ${githubEditTarget.path} via Metadea admin panel`,
      );
    } catch (err) {
      console.error('[CatalogAdminPanel] Failed to push edit back to GitHub:', err);
      alert(t.github_save_error);
    }
  };

  const visibleGithubFiles = githubFiles.filter(f =>
    !githubQuery.trim() || f.name.toLowerCase().includes(githubQuery.trim().toLowerCase()),
  );

  return (
    <div className="catalog-admin-panel">
      <h1 className="catalog-admin-title">{t.title}</h1>

      <div className="catalog-admin-source-toggle">
        <button
          type="button"
          className={`catalog-admin-source-btn${source === 'local' ? ' active' : ''}`}
          onClick={() => setSource('local')}
        >
          {t.source_local}
        </button>
        <button
          type="button"
          className={`catalog-admin-source-btn${source === 'github' ? ' active' : ''}`}
          onClick={() => setSource('github')}
        >
          {t.source_github}
        </button>
      </div>

      {source === 'local' && (
        <>
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
        </>
      )}

      {source === 'github' && (
        <>
          <p className="catalog-admin-hint">{t.github_hint}</p>
          <input
            type="text"
            className="catalog-admin-search"
            placeholder={t.search_placeholder}
            value={githubQuery}
            onChange={e => setGithubQuery(e.target.value)}
          />

          {githubLoading && <p className="catalog-admin-status">{t.loading}</p>}
          {!githubLoading && visibleGithubFiles.length === 0 && <p className="catalog-admin-status">{t.no_entries}</p>}

          {!githubLoading && visibleGithubFiles.length > 0 && (
            <div className="catalog-admin-list">
              {visibleGithubFiles.map(file => (
                <div key={file.path} className="catalog-admin-item">
                  <div className="catalog-admin-item-info">
                    <span className="catalog-admin-item-title">{externalIdFromDatabaseFilename(file.name)}</span>
                    <span className="catalog-admin-item-meta">{file.path}</span>
                  </div>
                  <div className="catalog-admin-item-actions">
                    <button type="button" className="catalog-admin-edit-btn" disabled={githubBusy} onClick={() => openGithubEntry(file)} title={t.edit_button}>
                      <IconPencil size={13} />
                      {t.edit_button}
                    </button>
                    <button type="button" className="catalog-admin-delete-btn" onClick={() => setGithubDeleteTarget(file)} title={t.delete_button}>
                      <IconTrash size={13} />
                      {t.delete_button}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {editingId && (
        <PrEditorModal
          externalId={editingId}
          mode="local"
          onClose={handleEditorClose}
          onSaved={handleEditorSaved}
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
              <button type="button" className="catalog-admin-confirm-delete" onClick={confirmDeleteLocal}>
                {t.delete_button}
              </button>
            </div>
          </div>
        </div>
      )}

      {githubDeleteTarget && (
        <div className="me-overlay" onClick={() => setGithubDeleteTarget(null)}>
          <div className="catalog-admin-confirm" onClick={e => e.stopPropagation()}>
            <p>{t.delete_confirm.replace('{title}', externalIdFromDatabaseFilename(githubDeleteTarget.name))}</p>
            <div className="catalog-admin-confirm-actions">
              <button type="button" className="catalog-admin-confirm-cancel" onClick={() => setGithubDeleteTarget(null)}>
                {t.cancel_button}
              </button>
              <button type="button" className="catalog-admin-confirm-delete" onClick={confirmDeleteGithub}>
                {t.delete_button}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
