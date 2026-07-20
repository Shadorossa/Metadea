import { useEffect, useState, useDeferredValue } from 'react';
import type { Translations } from '../../i18n/index';
import { useOwnerGate } from '../../lib/github/useOwnerGate';
import {
  getAllCatalogEntries, deleteCatalogEntry, getCatalogEntry, saveCatalogEntry,
  type MediaCatalogEntry,
} from '../../lib/tauri/catalog';
import {
  listDatabaseFiles, getFileAtRef, deleteFileFromMain, externalIdFromDatabaseFilename,
  type GitHubDirEntry,
} from '../../lib/github/api';
import { hydrateBundleIntoLocalCatalog, hydrateSagaChainFromGithub } from '../../lib/github/bundle-sync';
import type { ProposalBundle } from '../../lib/github/submitCollaborativeProposal';
import { fetchMediaData } from '../../lib/media/mediaService';
import { PrEditorModal } from '../media/PrEditorModal';
import { AdminAddSearch } from './AdminAddSearch';
import { CatalogEntryCard } from './CatalogEntryCard';
import { backfillMissingCatalogFields, type BackfillEntryResult, type BackfillProgress } from '../../lib/settings/catalog-backfill';
import { DIFF_FIELDS } from '../../lib/media/constants';

interface Props {
  i18n: Pick<Translations, 'media' | 'discord' | 'admin'>;
}

type Source = 'local' | 'github' | 'add';

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
  // GitHub's file listing only has raw filenames (no title, no cover) — most
  // merged entries are already synced into the local catalog (see
  // sync_community_catalog), so this maps external_id → title/cover from the
  // *full* local catalog (independent of the local tab's own search query)
  // to show something more useful than the id twice.
  const [catalogInfoMap, setCatalogInfoMap] = useState<Record<string, { title?: string; cover?: string }>>({});

  // "Add work" state
  const [addBusy, setAddBusy] = useState(false);

  // One-off backfill sweep (see catalog-backfill.ts) for rows missing the
  // fields added this session (country_code, release_end_*, title_english).
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<BackfillProgress | null>(null);
  const [backfillResults, setBackfillResults] = useState<BackfillEntryResult[] | null>(null);

  const runBackfill = async () => {
    if (backfillRunning) return;
    setBackfillRunning(true);
    setBackfillResults(null);
    setBackfillProgress(null);
    try {
      const results = await backfillMissingCatalogFields(p => setBackfillProgress(p));
      setBackfillResults(results);
      loadEntries();
    } finally {
      setBackfillRunning(false);
    }
  };

  // Editor state, shared across all three sources — every edit (whether it
  // started from the local catalog, an already-merged GitHub entry, or a
  // brand-new "Add work" pick) goes through PrEditorModal's default
  // 'proposal' mode: a branch + PR, same as any other contribution, since
  // every change here is meant to reach the shared catalog for every user,
  // not just stay on this machine.
  const [editingId, setEditingId] = useState<string | null>(null);
  // Field names present locally but absent from the GitHub bundle that was
  // actually opened — passed to PrEditorModal so it can dim them. Cleared
  // whenever the editor is opened from anywhere other than the GitHub tab
  // (local entries, "Add work"), where the concept doesn't apply.
  const [editingNonGithubFields, setEditingNonGithubFields] = useState<Set<string> | undefined>(undefined);

  const isOwner = gate.state === 'owner';
  const token = gate.token;

  // Loads the *whole* local catalog once — filtering as the user types
  // happens client-side (see visibleEntries below) instead of re-querying
  // over IPC on every keystroke, which was causing the list (and every
  // cover image in it) to reload/flicker on each character typed.
  const loadEntries = async () => {
    setLoading(true);
    try {
      setEntries(await getAllCatalogEntries());
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
    } catch (err: any) {
      // 404 means the database/ folder doesn't exist yet — not an error worth logging
      if (!String(err?.message ?? err).includes('Not Found')) {
        console.error('[CatalogAdminPanel] Failed to list GitHub database files:', err);
      }
      setGithubFiles([]);
    } finally {
      setGithubLoading(false);
    }
  };

  useEffect(() => {
    if (!isOwner) return;
    loadEntries();
    loadGithubFiles();
    getAllCatalogEntries().then(all => {
      const map: Record<string, { title?: string; cover?: string }> = {};
      for (const e of all) {
        if (e.cover_url || e.title_main) map[e.external_id] = { title: e.title_main ?? undefined, cover: e.cover_url ?? undefined };
      }
      setCatalogInfoMap(map);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner]);

  // Deferred so fast typing doesn't force a full re-filter/re-render of a
  // (potentially large) catalog on every single keystroke — the input itself
  // stays instantly responsive, the list just settles a beat behind it.
  // Both declared unconditionally, above the owner-gate early returns below
  // (Rules of Hooks — every hook must run on every render).
  const deferredQuery = useDeferredValue(query);
  const deferredGithubQuery = useDeferredValue(githubQuery);

  // Mirrors search_catalog's own match (Rust, media_catalog.rs): case-
  // insensitive substring match against title_main/title_romaji/title_native.
  const visibleEntries = (() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(e =>
      e.title_main?.toLowerCase().includes(q)
      || e.title_romaji?.toLowerCase().includes(q)
      || e.title_native?.toLowerCase().includes(q)
    );
  })();

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
      const { content } = await getFileAtRef(token, file.path, 'main');
      const bundle = JSON.parse(content) as ProposalBundle;
      // Imports the merged entry into the local DB so the rich editor has
      // something to show/edit — the actual save still goes out as a new
      // proposal PR (see the shared PrEditorModal below), not a direct
      // overwrite of this file. Saga data is now split one-file-per-member
      // upstream, so the rest of the chain (if any) needs hydrating too —
      // otherwise the editor would only see this one entry instead of the
      // whole saga, like it did back when everything lived in one file.
      // hydrateBundleIntoLocalCatalog now also live-enriches this (and every
      // saga member below) when core content is still missing — see its own
      // doc comment in bundle-sync.ts.
      await hydrateBundleIntoLocalCatalog(bundle);
      await hydrateSagaChainFromGithub(token, bundle.media_catalog.external_id).catch(err =>
        console.error('[CatalogAdminPanel] Failed to hydrate saga chain:', err));

      // Diffed against DIFF_FIELDS (the same list the editor's own "changed"
      // dots use) — a field the bundle never mentioned at all, but the local
      // row now has a real value for (from before this open, or from the
      // enrichment fetch above), is data that exists locally without being
      // on GitHub yet.
      const finalEntry = await getCatalogEntry(bundle.media_catalog.external_id).catch(() => null);
      const bundleFields = bundle.media_catalog as any;
      const localOnly = new Set<string>();
      if (finalEntry) {
        for (const [field] of DIFF_FIELDS) {
          const inBundle = bundleFields[field] !== undefined;
          const hasLocalValue = (finalEntry as any)[field];
          if (!inBundle && hasLocalValue) localOnly.add(field);
        }
      }
      setEditingNonGithubFields(localOnly);

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

  const handleEditorClose = () => { setEditingId(null); setEditingNonGithubFields(undefined); };

  const handleEditorSaved = () => {
    loadEntries();
    loadGithubFiles();
  };

  const visibleGithubFiles = githubFiles.filter(f => {
    const q = deferredGithubQuery.trim().toLowerCase();
    if (!q) return true;
    const title = catalogInfoMap[externalIdFromDatabaseFilename(f.name)]?.title;
    return f.name.toLowerCase().includes(q) || !!title?.toLowerCase().includes(q);
  });

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
        <button
          type="button"
          className={`catalog-admin-source-btn${source === 'add' ? ' active' : ''}`}
          onClick={() => setSource('add')}
        >
          {t.source_add}
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
          {!loading && visibleEntries.length === 0 && <p className="catalog-admin-status">{t.no_entries}</p>}

          {!loading && visibleEntries.length > 0 && (
            <div className="pr-editor-search-grid">
              {visibleEntries.map(entry => (
                <CatalogEntryCard
                  key={entry.external_id}
                  id={entry.external_id}
                  title={entry.title_main || entry.external_id}
                  cover={entry.cover_url}
                  editLabel={t.edit_button}
                  deleteLabel={t.delete_button}
                  onEdit={() => { setEditingNonGithubFields(undefined); setEditingId(entry.external_id); }}
                  onDelete={() => setDeleteTarget(entry)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {source === 'github' && (
        <>
          <p className="catalog-admin-hint">{t.github_hint}</p>

          <div className="catalog-backfill">
            <button
              type="button"
              className="catalog-admin-source-btn"
              onClick={runBackfill}
              disabled={backfillRunning}
            >
              {backfillRunning ? 'Revisando catálogo…' : 'Revisar cambios de catálogo'}
            </button>
            {backfillRunning && backfillProgress && (
              <p className="catalog-admin-status">
                {backfillProgress.done} / {backfillProgress.total} — {backfillProgress.current}
              </p>
            )}
            {!backfillRunning && backfillResults && (
              <div className="catalog-backfill-results">
                {backfillResults.length === 0 ? (
                  <p className="catalog-admin-status">No había nada que actualizar.</p>
                ) : (
                  backfillResults.map(entry => (
                    <div key={entry.externalId} className="catalog-backfill-entry">
                      <p className="catalog-backfill-entry-title">{entry.titleMain}</p>
                      <div className="catalog-backfill-fields">
                        {entry.fields.map(f => (
                          <span
                            key={f.field}
                            className={`catalog-backfill-field${f.changed ? ' catalog-backfill-field--changed' : ''}`}
                          >
                            {f.label}: {f.after == null || f.after === '' ? '—' : String(f.after)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

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
            <div className="pr-editor-search-grid">
              {visibleGithubFiles.map(file => {
                const fileExternalId = externalIdFromDatabaseFilename(file.name);
                const info = catalogInfoMap[fileExternalId];
                return (
                  <CatalogEntryCard
                    key={file.path}
                    id={fileExternalId}
                    title={info?.title || fileExternalId}
                    cover={info?.cover}
                    editLabel={t.edit_button}
                    deleteLabel={t.delete_button}
                    editDisabled={githubBusy}
                    onEdit={() => openGithubEntry(file)}
                    onDelete={() => setGithubDeleteTarget(file)}
                  />
                );
              })}
            </div>
          )}
        </>
      )}

      {source === 'add' && (
        <>
          {addBusy && <p className="catalog-admin-status">{t.add_fetching}</p>}
          <AdminAddSearch
            onSelect={async ({ externalId, title, coverUrl }) => {
              if (addBusy) return;
              // Only fetch/persist anything when this id has never been
              // cataloged before — an existing row may carry curated edits
              // (e.g. a manually-corrected release date) that a live refetch
              // must never reset back to whatever the API currently says.
              const existing = await getCatalogEntry(externalId).catch(() => null);
              if (!existing) {
                setAddBusy(true);
                try {
                  // Same live fetch+map+persist every normal media page does on
                  // first visit (fetchMediaData → provider mapper →
                  // persistToCatalog) — gets synopsis/dates/genres/platforms/
                  // authors/etc, not just title+cover, before opening the editor.
                  const full = await fetchMediaData(externalId).catch(() => null);
                  if (!full) {
                    const now = new Date().toISOString();
                    await saveCatalogEntry({
                      id: '',
                      external_id: externalId,
                      type: externalId.split(':')[0],
                      format: null,
                      source: externalId.startsWith('game:') || externalId.startsWith('vnovel:') ? 'igdb'
                        : externalId.startsWith('anime:') || externalId.startsWith('manga:') || externalId.startsWith('lnovel:') ? 'anilist'
                        : externalId.startsWith('movie:') || externalId.startsWith('series:') ? 'tmdb'
                        : externalId.startsWith('book:') ? 'openlibrary'
                        : externalId.startsWith('comic:') ? 'comicvine'
                        : null,
                      title_main: title,
                      title_romaji: null,
                      title_native: null,
                      cover_url: coverUrl,
                      release_year: null,
                      release_month: null,
                      release_day: null,
                      score_global: null,
                      created_at: now,
                      updated_at: now,
                    }).catch(console.error);
                  }
                } finally {
                  setAddBusy(false);
                }
              }
              setEditingNonGithubFields(undefined);
              setEditingId(externalId);
            }}
          />
        </>
      )}

      {editingId && (
        <PrEditorModal
          externalId={editingId}
          onClose={handleEditorClose}
          onSaved={handleEditorSaved}
          nonGithubFields={editingNonGithubFields}
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
