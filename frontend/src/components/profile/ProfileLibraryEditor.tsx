import React, { useState, useEffect } from 'react';
import { MediaEditorModal } from '../media/MediaEditorModal';
import { fetchMediaData } from '../../lib/media/mediaService';
import type { MediaPageData } from '../../lib/media/types';

interface OpenEditorEvent extends Event {
  detail?: {
    externalId: string;
    libraryEntry?: any;
    catalogEntry?: any;
  };
}

export function ProfileLibraryEditor({ lang }: { lang: string }) {
  const [externalId, setExternalId] = useState<string | null>(null);
  const [mediaData, setMediaData] = useState<MediaPageData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handleOpen = async (e: Event) => {
      const customEvent = e as OpenEditorEvent;
      const id = customEvent.detail?.externalId;
      const catalogEntry = customEvent.detail?.catalogEntry;

      if (!id) return;

      setExternalId(id);
      setMediaData(null);

      // Si tenemos catalogEntry local, usarla para construcción básica
      if (catalogEntry) {
        console.log('[ProfileLibraryEditor] Using catalogEntry for quick load');
        // Construir MediaPageData mínima desde catalogEntry
        const basicData: MediaPageData = {
          externalId: id,
          type: catalogEntry.media_type || 'book',
          titleMain: catalogEntry.title_main || 'Unknown',
          titleNative: catalogEntry.title_native,
          titleEnglish: catalogEntry.title_english,
          cover: catalogEntry.cover_url,
          bannerColor: 'linear-gradient(135deg, #c084fc 0%, #7c3aed 100%)',
          stats: [],
          characters: [],
          relations: [],
          progressStatus: 'watching',
          progressLabel: 'En progreso'
        };
        setMediaData(basicData);
        setLoading(false);

        // Luego en background, enriquecer con más datos
        fetchMediaData(id)
          .then(data => {
            if (data) {
              console.log('[ProfileLibraryEditor] Background fetch completed');
              setMediaData(data);
            }
          })
          .catch(err => {
            console.error('Error fetching additional media data:', err);
            // Mantener basicData aunque falle el fetch
          });
      } else {
        console.log('[ProfileLibraryEditor] No catalogEntry, doing full fetch');
        // Fallback: hacer fetchMediaData completo si no hay catalogEntry
        setLoading(true);
        fetchMediaData(id)
          .then(data => {
            if (data) {
              setMediaData(data);
            }
          })
          .catch(err => {
            console.error('Error fetching media data:', err);
          })
          .finally(() => {
            setLoading(false);
          });
      }
    };

    window.addEventListener('open-profile-editor', handleOpen);
    return () => {
      window.removeEventListener('open-profile-editor', handleOpen);
    };
  }, []);

  if (!externalId) return null;

  if (loading) {
    return (
      <div className="me-overlay" onClick={() => setExternalId(null)}>
        <div className="me-modal" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '300px' }} onClick={e => e.stopPropagation()}>
          <div className="me-loading"><div className="spinner" /></div>
        </div>
      </div>
    );
  }

  if (!mediaData) return null;

  return (
    <MediaEditorModal
      externalId={externalId}
      data={mediaData}
      lang={lang}
      onClose={() => {
        setExternalId(null);
        setMediaData(null);
      }}
      onSaved={() => {
        window.dispatchEvent(new CustomEvent('refresh-profile-library'));
      }}
      onDeleted={() => {
        window.dispatchEvent(new CustomEvent('refresh-profile-library'));
      }}
    />
  );
}
