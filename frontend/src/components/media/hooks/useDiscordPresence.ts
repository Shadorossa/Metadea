import { useEffect } from 'react';
import { updateDiscordPresence, resetDiscordPresence } from '../../../lib/tauri';
import type { MediaPageData } from '../../../lib/media/types';
import type { Translations } from '../../../i18n/index';

// Sets Discord Rich Presence to reflect the media page currently open, and
// resets it back to the default state on unmount (leaving the page).
export function useDiscordPresence(data: MediaPageData | null, discordT: Translations['discord']) {
  useEffect(() => {
    if (!data?.externalId) return;

    const baseType = data.type?.split('_')[0];

    let detailsText = 'Metadea';
    if (baseType === 'anime' || baseType === 'movie' || baseType === 'series') {
      detailsText = `Watching ${data.titleMain}`;
    } else if (baseType === 'manga' || baseType === 'novel' || baseType === 'book' || baseType === 'comic') {
      detailsText = `Reading ${data.titleMain}`;
    } else if (baseType === 'game' || baseType === 'vnovel') {
      detailsText = `Playing ${data.titleMain}`;
    }

    updateDiscordPresence(detailsText, '').catch(() => {});

    // Al desmontar (salir de la ficha), restablecemos el estado por defecto
    return () => {
      resetDiscordPresence().catch(() => {});
    };
  // Re-disparar si cambia la obra
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.externalId]);
}
