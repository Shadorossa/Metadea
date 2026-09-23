import { useState, useEffect, useRef } from 'react';
import { AnimatePresence } from 'motion/react';
import { MediaEditorModal } from '../media/MediaEditorModal';
import { fetchMediaData, mapCatalogEntryToPartialData, fetchExtraRelations, patchCachedRelations, inferProgressStatus } from '../../lib/media/media-page-data';
import type { LibraryEntry, CatalogEntryLike } from '../../lib/tauri';
import type { MediaPageData } from '../../lib/media/types';
import type { Translations } from '../../i18n/index';
import type { RatingSlot } from '../../lib/storage/preferences';

interface OpenEditorEvent extends Event {
  detail?: {
    externalId: string;
    libraryEntry?: LibraryEntry;
    // The profile grid hands over its CatalogSummary row, Local its full
    // row — either is only the placeholder render until fetchMediaData
    // below replaces it, and the editor reads nothing outside the summary.
    catalogEntry?: CatalogEntryLike;
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

    const attach = () => window.addEventListener('open-profile-editor', handleOpen as EventListener);
    attach();
    // Astro's client-side navigation (View Transitions) can leave a
    // client:idle island's own event listeners stale after enough
    // back-and-forth through the profile page — the "open editor" click
    // from a library card then silently does nothing until a hard refresh.
    // Re-attaching on every astro:page-load (a no-op if `handleOpen` — a
    // fresh closure per effect run — is already the one currently bound)
    // guards against that instead of relying on this effect's own mount/
    // unmount cycle firing correctly across every kind of navigation.
    document.addEventListener('astro:page-load', attach);

    return () => {
      window.removeEventListener('open-profile-editor', handleOpen as EventListener);
      document.removeEventListener('astro:page-load', attach);
    };
  }, [t.progress_in_progress]);

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
