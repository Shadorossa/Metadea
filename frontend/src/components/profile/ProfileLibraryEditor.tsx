import { useState, useEffect } from 'react';
import { MediaEditorModal } from '../media/MediaEditorModal';
import { fetchMediaData, mapCatalogEntryToPartialData, fetchExtraRelations, inferProgressStatus } from '../../lib/media/mediaService';
import type { LibraryEntry, MediaCatalogEntry } from '../../lib/tauri';
import type { MediaPageData } from '../../lib/media/types';
import { getT } from '../../i18n/client';

interface OpenEditorEvent extends Event {
  detail?: {
    externalId: string;
    libraryEntry?: LibraryEntry;
    catalogEntry?: MediaCatalogEntry;
  };
}

interface EditorState {
  externalId: string;
  mediaData: MediaPageData;
  libraryEntry: LibraryEntry | undefined;
}

export function ProfileLibraryEditor() {
  const [state, setState] = useState<EditorState | null>(null);
  const t = getT();

  useEffect(() => {
    const handleOpen = (e: Event) => {
      const detail = (e as OpenEditorEvent).detail;
      const id           = detail?.externalId;
      const catalogEntry = detail?.catalogEntry;
      const libraryEntry = detail?.libraryEntry;

      if (!id) return;

      const fallbackType = libraryEntry?.type ?? 'anime';
      const basicData: MediaPageData = catalogEntry
        ? mapCatalogEntryToPartialData(catalogEntry, t.media.progress_in_progress)
        : {
            externalId: id,
            type: fallbackType,
            titleMain: id,
            bannerColor: 'linear-gradient(135deg, #c084fc 0%, #7c3aed 100%)',
            metaLines: [],
            stats: [],
            characters: [],
            relations: [],
            progressStatus: inferProgressStatus(fallbackType),
            progressLabel: t.media.progress_in_progress,
          };

      setState({ externalId: id, mediaData: basicData, libraryEntry });

      fetchMediaData(id)
        .then(data => {
          if (data) {
            setState(prev => prev?.externalId === id ? { ...prev, mediaData: data } : prev);
            const targetRelationsId = data.parentGame?.externalId || id;
            fetchExtraRelations(targetRelationsId, data).then(relations => {
              if (relations) {
                setState(prev => prev?.externalId === id ? {
                  ...prev,
                  mediaData: { ...prev.mediaData, relations }
                } : prev);
              }
            });
          }
        })
        .catch(console.error);
    };

    window.addEventListener('open-profile-editor', handleOpen as EventListener);
    return () => window.removeEventListener('open-profile-editor', handleOpen as EventListener);
  }, []);

  if (!state) return null;

  return (
    <MediaEditorModal
      externalId={state.externalId}
      data={state.mediaData}
      initialEntry={state.libraryEntry}
      onClose={() => setState(null)}
      onSaved={() => {
        window.dispatchEvent(new CustomEvent('refresh-profile-library'));
      }}
      onDeleted={() => {
        setState(null);
        window.dispatchEvent(new CustomEvent('refresh-profile-library'));
      }}
    />
  );
}
