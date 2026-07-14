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

    // Obtener la línea principal de i18n ("Viendo la ficha de...", etc.)
    const detailsText =
      baseType === 'anime' || baseType === 'movie' || baseType === 'series'
        ? discordT.watching_details
        : baseType === 'manga' || baseType === 'novel' || baseType === 'book' || baseType === 'comic'
        ? discordT.reading_details
        : baseType === 'game' || baseType === 'vnovel'
        ? discordT.playing_details
        : 'Metadea';

    updateDiscordPresence(detailsText, data.titleMain).catch(() => {});

    // Al desmontar (salir de la ficha), restablecemos el estado por defecto
    return () => {
      resetDiscordPresence().catch(() => {});
    };
  // Re-disparar si cambia la obra
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.externalId]);
}
