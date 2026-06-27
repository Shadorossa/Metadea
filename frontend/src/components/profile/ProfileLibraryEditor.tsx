import React, { useState, useEffect } from 'react';
import { MediaEditorModal } from '../media/MediaEditorModal';
import { fetchMediaData } from '../../lib/media/mediaService';
import type { MediaPageData } from '../../lib/media/types';

interface OpenEditorEvent extends Event {
  detail?: {
    externalId: string;
  };
}

export function ProfileLibraryEditor({ lang }: { lang: string }) {
  const [externalId, setExternalId] = useState<string | null>(null);
  const [mediaData, setMediaData] = useState<MediaPageData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handleOpen = (e: Event) => {
      const customEvent = e as OpenEditorEvent;
      const id = customEvent.detail?.externalId;
      if (!id) return;

      setExternalId(id);
      setLoading(true);
      setMediaData(null);

      fetchMediaData(id)
        .then(data => {
          if (data) {
            setMediaData(data);
          }
        })
        .catch(err => {
          console.error('Error fetching media data for profile editor:', err);
        })
        .finally(() => {
          setLoading(false);
        });
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
