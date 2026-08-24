import React, { useState, useEffect } from 'react';
import { getT } from '../../i18n/client';
import { IconFolder, IconX } from './ui/icons';

interface FolderRouteControlsProps {
  rootFolder:   string | undefined;
  onSetRoute:   () => void;
  onClearRoute: () => void;
}

// The "current folder path + change/remove buttons" trio shown in every
// category's own .local-content-header — was independently copy-pasted
// between LocalMediaSection (every media category) and LocalLibrary's own
// Videojuegos header, identical down to the tooltip fallback strings.
// Deliberately just this trio, not the whole header: the count text and any
// extra buttons (Videojuegos' own rescan button) differ per caller and stay
// there as siblings.
export function FolderRouteControls({ rootFolder, onSetRoute, onClearRoute }: FolderRouteControlsProps) {
  const t = getT();
  // Same hydration-mismatch avoidance as everywhere else these fallback
  // strings appear — the server render has no i18n context, so isMounted
  // gates using the real translation until after the client's first paint.
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => { setIsMounted(true); }, []);

  return (
    <>
      {rootFolder && (
        <>
          <span className="local-folder-path" style={{ fontSize: '0.7rem' }}>{rootFolder}</span>
          <button type="button" className="local-refresh-btn" onClick={onClearRoute} title={isMounted ? t.local.remove_local_folder : 'Quitar carpeta local'} style={{ color: 'var(--color-error, #ff6b6b)' }}>
            <IconX />
          </button>
        </>
      )}
      <button type="button" className="local-refresh-btn" onClick={onSetRoute} title={isMounted ? (rootFolder ? t.local.change_folder : t.local.add_folder) : (rootFolder ? 'Cambiar carpeta' : 'Añadir carpeta')}>
        <IconFolder />
      </button>
    </>
  );
}
