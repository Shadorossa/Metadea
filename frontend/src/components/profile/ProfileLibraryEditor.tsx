import React, { useState, useEffect } from 'react';
import { MediaEditorModal } from '../media/MediaEditorModal';
import { fetchMediaData, mapCatalogEntryToPartialData } from '../../lib/media/mediaService';
import type { LibraryEntry } from '../../lib/tauri';

interface OpenEditorEvent extends Event {
  detail?: {
    externalId: string;
    libraryEntry?: LibraryEntry;
    catalogEntry?: any;
  };
}

interface EditorState {
  externalId: string;
  mediaData: MediaPageData;
  libraryEntry: LibraryEntry | undefined;
}

export function ProfileLibraryEditor({ lang }: { lang: string }) {
  const [state, setState] = useState<EditorState | null>(null);

  useEffect(() => {
    const handleOpen = (e: Event) => {
      const detail = (e as OpenEditorEvent).detail;
      const id           = detail?.externalId;
      const catalogEntry = detail?.catalogEntry;
      const libraryEntry = detail?.libraryEntry;

      if (!id || !catalogEntry) return;

      // catalogEntry already has all the key fields (totalCount, totalCount_2, genres, etc.)
      const basicData = mapCatalogEntryToPartialData(catalogEntry);

      setState({ externalId: id, mediaData: basicData, libraryEntry });

      // Enrich with full API data in background (for stats, relations, characters, metaLines, etc.)
      fetchMediaData(id)
        .then(data => {
          if (data) setState(prev => prev?.externalId === id ? { ...prev, mediaData: data } : prev);
        })
        .catch(() => {});
    };

    window.addEventListener('open-profile-editor', handleOpen);
    return () => window.removeEventListener('open-profile-editor', handleOpen);
  }, []);

  if (!state) return null;

  return (
    <MediaEditorModal
      externalId={state.externalId}
      data={state.mediaData}
      lang={lang}
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
