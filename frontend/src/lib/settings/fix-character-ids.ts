import { getT } from '../../i18n/client';
import { fetchMediaDataInternal } from '../media/mediaService';
import { getLegacyTmdbCharacterAppearances, remapTmdbCharacterIds } from '../tauri/characters';
import { initStatusActionButton } from './status-action';

// Repairs old TMDB character ids and normalizes the intermediate
// character:ms:<person-id>:<media-type>:<work-id> format.
export function initFixCharacterIds() {
  initStatusActionButton({
    buttonId: 'fix-character-ids-btn',
    statusId: 'fix-character-ids-status',
    notInTauriMessage: 'Solo disponible en la aplicación instalada.',
    labels: () => {
      const t = getT().settings;
      return { running: t.fix_character_ids_running, idle: t.fix_character_ids_btn };
    },
    run: async () => {
      const legacy = await getLegacyTmdbCharacterAppearances();
      const byWork = new Map<string, Set<string>>();
      for (const item of legacy) {
        const ids = byWork.get(item.media_external_id) ?? new Set<string>();
        ids.add(item.character_external_id);
        byWork.set(item.media_external_id, ids);
      }

      const remaps: Array<{ old_external_id: string; new_external_id: string }> = [];
      for (const [mediaId, oldIds] of byWork) {
        for (const oldId of oldIds) {
          const normalizedId = oldId.replace(
            /^(character:ms:\d+):(series|movie):(\d+)$/,
            '$1:$3',
          );
          if (normalizedId !== oldId) {
            remaps.push({ old_external_id: oldId, new_external_id: normalizedId });
          }
        }

        const media = await fetchMediaDataInternal(mediaId).catch(() => null);
        for (const character of media?.characters ?? []) {
          if (!character.tmdbCreditId || !character.id) continue;
          const oldId = `character:ms:${character.tmdbCreditId}`;
          if (oldIds.has(oldId)) {
            remaps.push({ old_external_id: oldId, new_external_id: character.id });
          }
        }
      }

      const moved = remaps.length ? await remapTmdbCharacterIds(remaps) : 0;
      return getT().settings.fix_character_ids_done.replace('{count}', String(moved));
    },
    errorMessage: message => getT().settings.fix_character_ids_error.replace('{message}', message),
    errorFallback: 'Error desconocido',
  });
}
