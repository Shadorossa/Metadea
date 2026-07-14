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

    const detailsText = `Viewing ${data.titleMain}`;

    const coverUrl = data.cover && data.cover.startsWith('http') ? data.cover : undefined;
    updateDiscordPresence(detailsText, '', undefined, undefined, coverUrl, data.titleMain, 'metadea', 'Metadea').catch(() => {});

    // Al desmontar (salir de la ficha), restablecemos el estado por defecto
    return () => {
      resetDiscordPresence().catch(() => {});
    };
  // Re-disparar si cambia la obra
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.externalId]);
}
