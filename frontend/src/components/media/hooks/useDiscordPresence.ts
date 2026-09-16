import { useEffect } from 'react';
import type { MediaPageData } from '../../../lib/media/types';
import type { Translations } from '../../../i18n/index';
import { toMediumCover } from '../../../lib/shared/small-cover';
import { setMediaPagePresence, clearMediaPagePresence } from '../../../lib/discord/presence-manager';

export function useDiscordPresence(data: MediaPageData | null, _discordT: Translations['discord']) {
  useEffect(() => {
    if (!data?.externalId) return;

    const coverUrl = data.cover && data.cover.startsWith('http') ? toMediumCover(data.cover) : undefined;
    setMediaPagePresence({
      title: data.titleMain,
      typeLabel: data.titleMain,
      coverUrl,
    });

    return () => {
      clearMediaPagePresence();
    };
  }, [data?.externalId, data?.titleMain, data?.cover]);
}
