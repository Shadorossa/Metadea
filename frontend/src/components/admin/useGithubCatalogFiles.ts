import { useCallback, useState } from 'react';
import { errorMessage } from '../../lib/errors/format-error';
import {
  listDatabaseFiles, getFileAtRef, deleteFileFromMain, type GitHubDirEntry,
} from '../../lib/github/api';
import { hydrateBundleIntoLocalCatalog, hydrateSagaChainFromGithub } from '../../lib/github/bundle-sync';
import type { ProposalBundle } from '../../lib/github/submit-collaborative-proposal';
import { getCatalogEntryForEditor } from '../../lib/tauri/catalog';
import { DIFF_FIELDS } from '../../lib/media/constants';
import { useAdminResource } from './useAdminResource';
import type { EditorRequest } from './admin-panel-types';

interface Params {
  token: string | null;
  isOwner: boolean;
  isRepoCreator: boolean;
  openEditor: (request: EditorRequest) => void;
  openErrorMessage: string;
  deleteErrorMessage: string;
}

// The repo's database/ file listing plus the open/delete actions over it.
// Owned by the panel rather than the GitHub tab because the sagas tab (GitHub
// source) also needs the listing and `openEntry` to edit a saga member.
// Only the GitHub tab (direct repo file browsing/deletion, not the fork+PR
// flow every edit already goes through) needs real write access to the repo.
export function useGithubCatalogFiles({
  token, isOwner, isRepoCreator, openEditor, openErrorMessage, deleteErrorMessage,
}: Params) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const resource = useAdminResource<GitHubDirEntry>(
    async () => {
      if (!token) return [];
      try {
        return await listDatabaseFiles(token);
      } catch (err) {
        // 404 means that type's catalog/ folder doesn't exist yet — not an error worth logging
        if (!errorMessage(err).includes('Not Found')) {
          console.error('[CatalogAdminPanel] Failed to list GitHub database files:', err);
        }
        return [];
      }
    },
    {
      key: file => file.path,
      enabled: isOwner && !!token,
      remove: async file => {
        const { sha } = await getFileAtRef(token ?? '', file.path, 'main');
        await deleteFileFromMain(token ?? '', file.path, sha, `Delete ${file.path} via Metadea admin panel`);
      },
      removeErrorMessage: '[CatalogAdminPanel] Failed to delete GitHub entry:',
      onRemoveError: () => setActionError(deleteErrorMessage),
    },
  );
  const { reload: reloadFiles, deleteTarget, confirmDelete: confirmRemove } = resource;

  const reload = useCallback(() => {
    if (!token) return;
    reloadFiles();
  }, [token, reloadFiles]);

  const openEntry = useCallback(async (file: GitHubDirEntry, initialTab: 'general' | 'cast' | 'relations' = 'general') => {
    if (!token || busy) return;
    setActionError(null);
    setBusy(true);
    try {
      const { content } = await getFileAtRef(token, file.path, 'main');
      const bundle = JSON.parse(content) as ProposalBundle;
      // Imports the merged entry into the local DB so the rich editor has
      // something to show/edit — the actual save still goes out as a new
      // proposal PR (see the shared PrEditorModal in the panel), not a direct
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
      const finalEntry = await getCatalogEntryForEditor(bundle.media_catalog.external_id).catch(() => null);
      const bundleFields = bundle.media_catalog;
      const localOnly = new Set<string>();
      if (finalEntry) {
        for (const [field] of DIFF_FIELDS) {
          const inBundle = bundleFields[field] !== undefined;
          const hasLocalValue = finalEntry[field];
          if (!inBundle && hasLocalValue) localOnly.add(field);
        }
      }
      openEditor({ externalId: bundle.media_catalog.external_id, initialTab, nonGithubFields: localOnly });
    } catch (err) {
      console.error('[CatalogAdminPanel] Failed to open GitHub entry:', err);
      setActionError(openErrorMessage);
    } finally {
      setBusy(false);
    }
  }, [token, busy, openEditor, openErrorMessage]);

  const confirmDelete = useCallback(async () => {
    if (!isRepoCreator || !deleteTarget || !token) return;
    setActionError(null);
    await confirmRemove();
  }, [isRepoCreator, deleteTarget, token, confirmRemove]);

  return { ...resource, reload, busy, actionError, openEntry, confirmDelete };
}

export type GithubCatalogFiles = ReturnType<typeof useGithubCatalogFiles>;
