import { useState, useEffect } from 'react';
import { MediaEditorModal } from '../media/MediaEditorModal';
import { fetchMediaData, mapCatalogEntryToPartialData } from '../../lib/media/mediaService';
import type { LibraryEntry } from '../../lib/tauri';
import type { MediaPageData } from '../../lib/media/types';
import { es } from '../../i18n/es';
import { en } from '../../i18n/en';

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
  const t = lang === 'en' ? en : es;

  useEffect(() => {
    const handleOpen = (e: Event) => {
      try {
        const detail = (e as OpenEditorEvent).detail;
        const id           = detail?.externalId;
        const catalogEntry = detail?.catalogEntry;
        const libraryEntry = detail?.libraryEntry;

        if (!id) return;

        // If catalogEntry exists, use it for instant basic data; otherwise start with empty
        const basicData = catalogEntry
          ? mapCatalogEntryToPartialData(catalogEntry, t.media.progress_in_progress)
          : { title: id, type: libraryEntry?.type ?? 'anime' } as any;

        setState({ externalId: id, mediaData: basicData, libraryEntry });

        // Always fetch full data from API
        fetchMediaData(id)
          .then(data => {
            if (data) setState(prev => prev?.externalId === id ? { ...prev, mediaData: data } : prev);
          })
          .catch(err => console.error('Error fetching media data:', err));
      } catch (err) {
        console.error('Error in ProfileLibraryEditor handleOpen:', err);
      }
    };

    window.addEventListener('open-profile-editor', handleOpen as EventListener);
    return () => window.removeEventListener('open-profile-editor', handleOpen as EventListener);
  }, [t.media.progress_in_progress]);

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
