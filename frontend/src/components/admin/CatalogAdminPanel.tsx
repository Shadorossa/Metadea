import { useEffect, useState, useDeferredValue } from 'react';
import type { Translations } from '../../i18n/index';
import { useOwnerGate } from '../../lib/github/useOwnerGate';
import {
  getAllCatalogEntries, deleteCatalogEntry, getCatalogEntry, saveCatalogEntry,
  getAllSagas, getCommunitySagas, deleteSaga, type MediaCatalogEntry, type SagaListEntry,
} from '../../lib/tauri/catalog';
import { getAllCharacters, deleteCharacter, getCommunityCharacters, type CharacterEntry } from '../../lib/tauri/characters';
import {
  listDatabaseFiles, getFileAtRef, deleteFileFromMain, externalIdFromDatabaseFilename,
  type GitHubDirEntry,
} from '../../lib/github/api';
import { hydrateBundleIntoLocalCatalog, hydrateSagaChainFromGithub } from '../../lib/github/bundle-sync';
import type { ProposalBundle } from '../../lib/github/submitCollaborativeProposal';
import { fetchMediaData } from '../../lib/media/mediaService';
import { PrEditorModal } from '../media/PrEditorModal';
import { CharacterSearchPopup } from '../media/CharacterSearchPopup';
import { AdminAddSearch } from './AdminAddSearch';
import { CatalogEntryCard } from './CatalogEntryCard';
import { IconTrash } from '../local/ui/icons';
import { backfillMissingCatalogFields, type BackfillEntryResult, type BackfillProgress } from '../../lib/settings/catalog-backfill';
import { DIFF_FIELDS } from '../../lib/media/constants';

interface Props {
  i18n: Pick<Translations, 'media' | 'discord' | 'admin'>;
}

type Source = 'local' | 'github' | 'add';
// Neither saga nor character has its own per-file GitHub representation the
// way a media entry does (one database/*.json each) — 'github' instead reads
// a one-shot download of the community database.db for both (get_community_
// characters/get_community_sagas), read-only, never merged into local.
type Entity = 'media' | 'saga' | 'character';

export function CatalogAdminPanel({ i18n }: Props) {
  const gate = useOwnerGate();
  const t = i18n.admin;

  const [source, setSource] = useState<Source>('local');
  const [entity, setEntity] = useState<Entity>('media');

  // Local catalog state
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<MediaCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<MediaCatalogEntry | null>(null);

  // Sagas state — a text list that expands in place to show member works
  // (see visibleSagas' render below), not a card grid with an edit modal.
  const [sagaQuery, setSagaQuery] = useState('');
  const [sagas, setSagas] = useState<SagaListEntry[]>([]);
  const [sagaLoading, setSagaLoading] = useState(true);
  const [sagaDeleteTarget, setSagaDeleteTarget] = useState<SagaListEntry | null>(null);
  const [expandedSagaId, setExpandedSagaId] = useState<string | null>(null);

  // GitHub's own sagas (read-only peek at the community database.db, not the
  // local one) — fetched on demand, same reasoning as githubCharacters below.
  const [githubSagas, setGithubSagas] = useState<SagaListEntry[]>([]);
  const [githubSagasLoading, setGithubSagasLoading] = useState(false);
  const [githubSagasError, setGithubSagasError] = useState(false);

  // Characters state
  const [characterQuery, setCharacterQuery] = useState('');
  const [characters, setCharacters] = useState<CharacterEntry[]>([]);
  const [characterLoading, setCharacterLoading] = useState(true);
  const [characterDeleteTarget, setCharacterDeleteTarget] = useState<CharacterEntry | null>(null);
  const [characterSearchOpen, setCharacterSearchOpen] = useState(false);

  // GitHub's own characters (read-only peek at the community database.db,
  // not the local one) — fetched on demand, not on mount, since it's a
  // network download rather than a local IPC read.
  const [githubCharacters, setGithubCharacters] = useState<CharacterEntry[]>([]);
  const [githubCharactersLoading, setGithubCharactersLoading] = useState(false);
  const [githubCharactersError, setGithubCharactersError] = useState(false);

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

  const loadSagas = async () => {
    setSagaLoading(true);
    try {
      setSagas(await getAllSagas());
    } catch (err) {
      console.error('[CatalogAdminPanel] Failed to load sagas:', err);
      setSagas([]);
    } finally {
      setSagaLoading(false);
    }
  };

  const loadCharacters = async () => {
    setCharacterLoading(true);
    try {
      setCharacters(await getAllCharacters());
    } catch (err) {
      console.error('[CatalogAdminPanel] Failed to load characters:', err);
      setCharacters([]);
    } finally {
      setCharacterLoading(false);
    }
  };

  useEffect(() => {
    if (!isOwner) return;
    loadEntries();
    loadGithubFiles();
    loadSagas();
    loadCharacters();
    getAllCatalogEntries().then(all => {
      const map: Record<string, { title?: string; cover?: string }> = {};
      for (const e of all) {
        if (e.cover_url || e.title_main) map[e.external_id] = { title: e.title_main ?? undefined, cover: e.cover_url ?? undefined };
      }
      setCatalogInfoMap(map);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner]);

  // Fetched on demand, the first time this tab combination is actually visited.
  useEffect(() => {
    if (!isOwner || entity !== 'character' || source !== 'github') return;
    if (githubCharacters.length > 0 || githubCharactersLoading) return;
    setGithubCharactersLoading(true);
    setGithubCharactersError(false);
    getCommunityCharacters()
      .then(setGithubCharacters)
      .catch(err => {
        console.error('[CatalogAdminPanel] Failed to load GitHub characters:', err);
        setGithubCharactersError(true);
      })
      .finally(() => setGithubCharactersLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner, entity, source]);

  useEffect(() => {
    if (!isOwner || entity !== 'saga' || source !== 'github') return;
    if (githubSagas.length > 0 || githubSagasLoading) return;
    setGithubSagasLoading(true);
    setGithubSagasError(false);
    getCommunitySagas()
      .then(setGithubSagas)
      .catch(err => {
        console.error('[CatalogAdminPanel] Failed to load GitHub sagas:', err);
        setGithubSagasError(true);
      })
      .finally(() => setGithubSagasLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner, entity, source]);

  // Deferred so fast typing doesn't force a full re-filter/re-render of a
  // (potentially large) catalog on every single keystroke — the input itself
  // stays instantly responsive, the list just settles a beat behind it.
  // Both declared unconditionally, above the owner-gate early returns below
  // (Rules of Hooks — every hook must run on every render).
  const deferredQuery = useDeferredValue(query);
  const deferredGithubQuery = useDeferredValue(githubQuery);
  const deferredSagaQuery = useDeferredValue(sagaQuery);
  const deferredCharacterQuery = useDeferredValue(characterQuery);

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

  const visibleSagas = (() => {
    const list = source === 'github' ? githubSagas : sagas;
    const q = deferredSagaQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(s =>
      s.name.toLowerCase().includes(q) || s.anchor_title?.toLowerCase().includes(q)
    );
  })();

  const visibleCharacters = (() => {
    const list = source === 'github' ? githubCharacters : characters;
    const q = deferredCharacterQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(c => c.name.toLowerCase().includes(q));
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

  const confirmDeleteSaga = async () => {
    if (!sagaDeleteTarget) return;
    try {
      await deleteSaga(sagaDeleteTarget.id);
      setSagas(prev => prev.filter(s => s.id !== sagaDeleteTarget.id));
    } catch (err) {
      console.error('[CatalogAdminPanel] Failed to delete saga:', err);
    } finally {
      setSagaDeleteTarget(null);
    }
  };

  const confirmDeleteCharacter = async () => {
    if (!characterDeleteTarget) return;
    try {
      await deleteCharacter(characterDeleteTarget.external_id);
      setCharacters(prev => prev.filter(c => c.external_id !== characterDeleteTarget.external_id));
    } catch (err) {
      console.error('[CatalogAdminPanel] Failed to delete character:', err);
    } finally {
      setCharacterDeleteTarget(null);
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
      const bundleFields = bundle.media_catalog;
      const localOnly = new Set<string>();
      if (finalEntry) {
        for (const [field] of DIFF_FIELDS) {
          const inBundle = bundleFields[field] !== undefined;
          const hasLocalValue = finalEntry[field];
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
    loadSagas();
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

      <div className="catalog-admin-source-toggle">
        <button
          type="button"
          className={`catalog-admin-source-btn${entity === 'media' ? ' active' : ''}`}
          onClick={() => setEntity('media')}
        >
          {t.entity_media}
        </button>
        <button
          type="button"
          className={`catalog-admin-source-btn${entity === 'saga' ? ' active' : ''}`}
          onClick={() => setEntity('saga')}
        >
          {t.entity_saga}
        </button>
        <button
          type="button"
          className={`catalog-admin-source-btn${entity === 'character' ? ' active' : ''}`}
          onClick={() => setEntity('character')}
        >
          {t.entity_character}
        </button>
      </div>

      {entity === 'saga' && (
        <>
          {source === 'github' && <p className="catalog-admin-hint">{t.github_hint}</p>}

          <input
            type="text"
            className="catalog-admin-search"
            placeholder={t.search_placeholder}
            value={sagaQuery}
            onChange={e => setSagaQuery(e.target.value)}
          />

          {(source === 'github' ? githubSagasLoading : sagaLoading) && <p className="catalog-admin-status">{t.loading}</p>}
          {source === 'github' && githubSagasError && <p className="catalog-admin-status">{t.github_open_error}</p>}
          {!(source === 'github' ? githubSagasLoading : sagaLoading) && visibleSagas.length === 0 && (
            <p className="catalog-admin-status">{t.no_sagas}</p>
          )}

          {!(source === 'github' ? githubSagasLoading : sagaLoading) && visibleSagas.length > 0 && (
            <div className="catalog-admin-saga-list">
              {visibleSagas.map(saga => {
                const isExpanded = expandedSagaId === saga.id;
                return (
                  <div className="catalog-admin-saga-row" key={saga.id}>
                    <div className="catalog-admin-saga-row-main">
                      <button
                        type="button"
                        className="catalog-admin-saga-row-toggle"
                        onClick={() => setExpandedSagaId(isExpanded ? null : saga.id)}
                        aria-expanded={isExpanded}
                      >
                        <span className="catalog-admin-saga-row-name">
                          {saga.name || saga.anchor_title || saga.id} ({saga.members.length})
                        </span>
                        <span className="catalog-admin-saga-row-cover">
                          {saga.anchor_cover ? <img src={saga.anchor_cover} alt="" loading="lazy" /> : null}
                        </span>
                      </button>
                      {source !== 'github' && (
                        <button
                          type="button"
                          className="catalog-admin-icon-btn catalog-admin-icon-btn--delete"
                          aria-label={t.delete_button}
                          title={t.delete_button}
                          onClick={() => setSagaDeleteTarget(saga)}
                        >
                          <IconTrash size={13} />
                        </button>
                      )}
                    </div>
                    {isExpanded && (
                      <div className="catalog-admin-saga-members">
                        {saga.members.map(member => (
                          <a
                            key={member.external_id}
                            className="catalog-admin-saga-member"
                            href={`/media?id=${encodeURIComponent(member.external_id)}`}
                          >
                            <span className="catalog-admin-saga-member-cover">
                              {member.cover ? <img src={member.cover} alt="" loading="lazy" /> : null}
                            </span>
                            <span className="catalog-admin-saga-member-title">{member.title}</span>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {entity === 'character' && source !== 'add' && (
        <>
          {source === 'github' && <p className="catalog-admin-hint">{t.github_hint}</p>}

          <input
            type="text"
            className="catalog-admin-search"
            placeholder={t.search_placeholder}
            value={characterQuery}
            onChange={e => setCharacterQuery(e.target.value)}
          />

          {(source === 'github' ? githubCharactersLoading : characterLoading) && <p className="catalog-admin-status">{t.loading}</p>}
          {source === 'github' && githubCharactersError && <p className="catalog-admin-status">{t.github_open_error}</p>}
          {!(source === 'github' ? githubCharactersLoading : characterLoading) && visibleCharacters.length === 0 && (
            <p className="catalog-admin-status">{t.no_characters}</p>
          )}

          {!(source === 'github' ? githubCharactersLoading : characterLoading) && visibleCharacters.length > 0 && (
            <div className="pr-editor-search-grid">
              {visibleCharacters.map(character => (
                <CatalogEntryCard
                  key={character.external_id}
                  id={character.external_id}
                  title={character.name || character.external_id}
                  cover={character.image_url}
                  editLabel={t.edit_button}
                  deleteLabel={t.delete_button}
                  onEdit={() => (window as any).openCharacterEditor?.(character.external_id)}
                  onDelete={() => source === 'github' ? alert(t.github_delete_error) : setCharacterDeleteTarget(character)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {entity === 'character' && source === 'add' && (
        <button type="button" className="catalog-admin-source-btn" onClick={() => setCharacterSearchOpen(true)}>
          {t.add_character_button}
        </button>
      )}

      {entity === 'media' && source === 'local' && (
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

      {entity === 'media' && source === 'github' && (
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

      {entity === 'media' && source === 'add' && (
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

      {sagaDeleteTarget && (
        <div className="me-overlay" onClick={() => setSagaDeleteTarget(null)}>
          <div className="catalog-admin-confirm" onClick={e => e.stopPropagation()}>
            <p>{t.delete_confirm.replace('{title}', sagaDeleteTarget.name || sagaDeleteTarget.anchor_title || sagaDeleteTarget.id)}</p>
            <div className="catalog-admin-confirm-actions">
              <button type="button" className="catalog-admin-confirm-cancel" onClick={() => setSagaDeleteTarget(null)}>
                {t.cancel_button}
              </button>
              <button type="button" className="catalog-admin-confirm-delete" onClick={confirmDeleteSaga}>
                {t.delete_button}
              </button>
            </div>
          </div>
        </div>
      )}

      {characterDeleteTarget && (
        <div className="me-overlay" onClick={() => setCharacterDeleteTarget(null)}>
          <div className="catalog-admin-confirm" onClick={e => e.stopPropagation()}>
            <p>{t.delete_confirm.replace('{title}', characterDeleteTarget.name || characterDeleteTarget.external_id)}</p>
            <div className="catalog-admin-confirm-actions">
              <button type="button" className="catalog-admin-confirm-cancel" onClick={() => setCharacterDeleteTarget(null)}>
                {t.cancel_button}
              </button>
              <button type="button" className="catalog-admin-confirm-delete" onClick={confirmDeleteCharacter}>
                {t.delete_button}
              </button>
            </div>
          </div>
        </div>
      )}

      {characterSearchOpen && (
        <CharacterSearchPopup
          onSelect={result => {
            setCharacterSearchOpen(false);
            (window as any).openCharacterEditor?.(result.externalId);
          }}
          onClose={() => setCharacterSearchOpen(false)}
          excludeIds={characters.map(c => c.external_id)}
        />
      )}
    </div>
  );
}
