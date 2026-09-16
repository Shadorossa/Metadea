import { useState, useEffect, useRef } from 'react';
import { AnimatePresence } from 'motion/react';
import { MediaEditorModal } from '../media/MediaEditorModal';
import { fetchMediaData, mapCatalogEntryToPartialData, fetchExtraRelations, patchCachedRelations, inferProgressStatus } from '../../lib/media/mediaService';
import type { LibraryEntry, MediaCatalogEntry } from '../../lib/tauri';
import type { MediaPageData } from '../../lib/media/types';
import type { Translations } from '../../i18n/index';
import type { RatingSlot } from '../../lib/settings/preferences';

interface OpenEditorEvent extends Event {
  detail?: {
    externalId: string;
    libraryEntry?: LibraryEntry;
    catalogEntry?: MediaCatalogEntry;
    ratingSlot?: RatingSlot;
    // Which season tab to open directly on — LibraryCard's fused "Unificar
    // temporadas" cards represent season 1 (externalId above) but may be
    // visually showing a later season via inProgressCover, so the editor
    // must open on THAT season's tab, not always season 1's.
    initialActiveLogId?: string;
  };
}

interface EditorState {
  externalId: string;
  mediaData: MediaPageData;
  libraryEntry: LibraryEntry | undefined;
  ratingSlot: RatingSlot;
  initialActiveLogId?: string;
}

interface Props {
  i18n: Translations['media'];
}

export function ProfileLibraryEditor({ i18n }: Props) {
  const [state, setState] = useState<EditorState | null>(null);
  const t = i18n;
  // Tracks which id the most recent open-editor event asked for, so a
  // background fetch that resolves after the user has since opened a
  // *different* entry knows not to patch the sessionStorage cache — see
  // fetchExtraRelations' own comment for why an unconditional write there
  // can corrupt a different (now-current) entry's cache.
  const activeIdRef = useRef<string | null>(null);

  useEffect(() => {
    const handleOpen = (e: Event) => {
      const detail = (e as OpenEditorEvent).detail;
      const id           = detail?.externalId;
      const catalogEntry = detail?.catalogEntry;
      const libraryEntry = detail?.libraryEntry;
      const ratingSlot   = detail?.ratingSlot ?? 'rating';
      const initialActiveLogId = detail?.initialActiveLogId;

      if (!id) return;
      activeIdRef.current = id;

      const fallbackType = libraryEntry?.type ?? 'anime';
      const basicData: MediaPageData = catalogEntry
        ? mapCatalogEntryToPartialData(catalogEntry, t.progress_in_progress)
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
            progressLabel: t.progress_in_progress,
          };

      setState({ externalId: id, mediaData: basicData, libraryEntry, ratingSlot, initialActiveLogId });

      fetchMediaData(id)
        .then(data => {
          if (data) {
            setState(prev => prev?.externalId === id ? { ...prev, mediaData: data } : prev);
            const targetRelationsId = data.parentGame?.externalId || id;
            fetchExtraRelations(targetRelationsId, data).then(relations => {
              if (!relations || activeIdRef.current !== id) return;
              patchCachedRelations(targetRelationsId, relations);
              setState(prev => prev?.externalId === id ? {
                ...prev,
                mediaData: { ...prev.mediaData, relations }
              } : prev);
            });
          }
        })
        .catch(console.error);
    };

    window.addEventListener('open-profile-editor', handleOpen as EventListener);
    return () => window.removeEventListener('open-profile-editor', handleOpen as EventListener);
  }, []);

  return (
    <AnimatePresence>
      {state && (
        <MediaEditorModal
          externalId={state.externalId}
          data={state.mediaData}
          i18n={t}
          initialEntry={state.libraryEntry}
          initialActiveLogId={state.initialActiveLogId}
          activeRatingSlot={state.ratingSlot}
          onClose={() => setState(null)}
          onSaved={() => {}}
          onDeleted={() => setState(null)}
        />
      )}
    </AnimatePresence>
  );
}
