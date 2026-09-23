import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Translations } from '../../i18n/index';
import { useOwnerGate } from '../shared/hooks/useOwnerGate';
import { isRepoOwner } from '../../lib/github/ownership';
import { PrEditorModal } from '../media/PrEditorModal';
import { useAdminPaging } from './useAdminPaging';
import { useGithubCatalogFiles } from './useGithubCatalogFiles';
import type { CatalogInfoMap, EditorRequest, Entity, Source } from './admin-panel-types';
import { MediaTab } from './tabs/MediaTab';
import { SagasTab } from './tabs/SagasTab';
import { CharactersTab } from './tabs/CharactersTab';
import { GithubFilesTab } from './tabs/GithubFilesTab';
import { EpisodesTab } from './tabs/EpisodesTab';
import { AddWorkTab } from './tabs/AddWorkTab';
import { useHydrated } from '../shared/hooks/useHydrated';
import { getT } from '../../i18n/runtime';

interface Props {
  i18n: Pick<Translations, 'media' | 'discord' | 'admin'>;
}

// Tab chrome + the shared editor mount. Each tab under ./tabs owns its own
// data and stays mounted while hidden (rendering nothing), so queries and
// loaded lists survive switching between tabs and every local list starts
// loading right away, without waiting for the owner gate.
export function CatalogAdminPanel({ i18n: staticStrings }: Props) {
  const gate = useOwnerGate();
  // Runtime language once hydrated; the static props are the build locale.
  const hydrated = useHydrated();
  const i18n = useMemo<Props['i18n']>(() => {
    if (!hydrated) return staticStrings;
    const rt = getT();
    return { media: rt.media, discord: rt.discord, admin: rt.admin };
  }, [hydrated, staticStrings]);
  const t = i18n.admin;

  const [source, setSource] = useState<Source>('local');
  const [entity, setEntity] = useState<Entity>('media');
  // The top bar's search area — tabs portal their own controls into it.
  const [searchSlot, setSearchSlot] = useState<HTMLDivElement | null>(null);
  const [catalogInfoMap, setCatalogInfoMap] = useState<CatalogInfoMap>({});
  const [editing, setEditing] = useState<EditorRequest | null>(null);
  // Bumped after an editor save / a backfill sweep so the tabs re-read.
  const [savedCount, setSavedCount] = useState(0);
  const [backfillCount, setBackfillCount] = useState(0);
  const paging = useAdminPaging();

  const isOwner = gate.state === 'owner';
  const isRepoCreator = isRepoOwner(gate.username);
  const ready = gate.state !== 'loading';

  const github = useGithubCatalogFiles({
    token: gate.token,
    isOwner,
    isRepoCreator,
    openEditor: setEditing,
    openErrorMessage: t.github_open_error,
    deleteErrorMessage: t.github_delete_error,
  });

  // Safety net for the source-toggle buttons below (which already hide
  // "GitHub"/"Add work" without write access) — if access is ever lost
  // mid-session (token cleared, etc.) while one of those was selected,
  // fall back to the always-available Local tab instead of stranding the
  // view on a now-hidden source.
  useEffect(() => {
    if (gate.state !== 'loading' && !isOwner && source !== 'local') {
      setSource('local');
    }
  }, [isOwner, gate.state, source]);

  const { resetPages } = paging;
  useEffect(() => {
    resetPages();
  }, [source, entity, resetPages]);

  const handleEditorClose = useCallback(() => setEditing(null), []);
  const { reload: reloadGithubFiles } = github;
  const handleEditorSaved = useCallback(() => {
    setSavedCount(count => count + 1);
    reloadGithubFiles();
  }, [reloadGithubFiles]);
  const handleBackfillCompleted = useCallback(() => setBackfillCount(count => count + 1), []);

  const sourceButton = (value: Source, label: string) => (
    <button
      type="button"
      className={`catalog-admin-source-btn${source === value ? ' active' : ''}`}
      onClick={() => setSource(value)}
    >
      {label}
    </button>
  );
  const entityButton = (value: Entity, label: string) => (
    <button
      type="button"
      className={`catalog-admin-source-btn${entity === value ? ' active' : ''}`}
      onClick={() => setEntity(value)}
    >
      {label}
    </button>
  );

  return (
    <div className="catalog-admin-panel">
      {ready && (
        <>
          <h1 className="catalog-admin-title">{t.title}</h1>

          <div className="catalog-admin-top-bar">
            <div className="catalog-admin-source-toggle">
              {sourceButton('local', t.source_local)}
              {isOwner && (
                <>
                  {sourceButton('github', t.source_github)}
                  {sourceButton('add', t.source_add)}
                </>
              )}
            </div>

            <div className="catalog-admin-source-toggle">
              {entityButton('media', t.entity_media)}
              {entityButton('saga', t.entity_saga)}
              {entityButton('character', t.entity_character)}
              {source === 'local' && entityButton('episodes', t.entity_episodes)}
            </div>

            <div className="catalog-admin-search-wrapper" ref={setSearchSlot} />
          </div>

          {source === 'github' && github.actionError && (
            <p className="catalog-admin-status catalog-admin-status--error" role="alert">{github.actionError}</p>
          )}
        </>
      )}

      <EpisodesTab
        t={t}
        active={ready && entity === 'episodes' && source === 'local'}
        searchSlot={searchSlot}
        paging={paging}
        catalogInfoMap={catalogInfoMap}
        openEditor={setEditing}
      />

      <SagasTab
        i18n={i18n}
        active={ready && entity === 'saga'}
        source={source}
        isOwner={isOwner}
        searchSlot={searchSlot}
        paging={paging}
        reloadToken={savedCount}
        github={github}
        openEditor={setEditing}
      />

      <CharactersTab
        t={t}
        active={ready && entity === 'character'}
        source={source}
        isOwner={isOwner}
        searchSlot={searchSlot}
        paging={paging}
      />

      <MediaTab
        t={t}
        active={ready && entity === 'media' && source === 'local'}
        searchSlot={searchSlot}
        paging={paging}
        reloadToken={savedCount + backfillCount}
        openEditor={setEditing}
        onCatalogLoaded={setCatalogInfoMap}
      />

      {isOwner && (
        <GithubFilesTab
          t={t}
          active={entity === 'media' && source === 'github'}
          isRepoCreator={isRepoCreator}
          searchSlot={searchSlot}
          paging={paging}
          github={github}
          catalogInfoMap={catalogInfoMap}
          onBackfillCompleted={handleBackfillCompleted}
        />
      )}

      {isOwner && entity === 'media' && source === 'add' && (
        <AddWorkTab t={t} openEditor={setEditing} />
      )}

      {editing && (
        <PrEditorModal
          externalId={editing.externalId}
          initialTab={editing.initialTab ?? 'general'}
          initialRelationsSubtab={editing.initialRelationsSubtab}
          onClose={handleEditorClose}
          onSaved={handleEditorSaved}
          nonGithubFields={editing.nonGithubFields}
        />
      )}
    </div>
  );
}
