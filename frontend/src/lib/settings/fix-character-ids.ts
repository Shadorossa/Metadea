import { getT } from '../../i18n/client';
import { byId } from '../shared/dom';
import { fetchMediaDataInternal } from '../media/mediaService';
import { getLegacyTmdbCharacterAppearances, remapTmdbCharacterIds } from '../tauri/characters';

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' &&
    ('__TAURI_IPC__' in window || '__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

// Repairs old TMDB character ids and normalizes the intermediate
// character:ms:<person-id>:<media-type>:<work-id> format.
export function initFixCharacterIds() {
  const btn = byId<HTMLButtonElement>('fix-character-ids-btn');
  const statusText = document.getElementById('fix-character-ids-status');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const t = getT().settings;

    if (!isTauriRuntime()) {
      if (statusText) {
        statusText.textContent = 'Solo disponible en la aplicación instalada.';
        statusText.style.display = 'block';
      }
      return;
    }

    btn.disabled = true;
    btn.textContent = t.fix_character_ids_running;
    if (statusText) statusText.style.display = 'none';

    try {
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
      if (statusText) {
        statusText.textContent = t.fix_character_ids_done.replace('{count}', String(moved));
        statusText.style.display = 'block';
      }
    } catch (error) {
      if (statusText) {
        const message = error instanceof Error ? error.message : String(error) || 'Error desconocido';
        statusText.textContent = t.fix_character_ids_error.replace('{message}', message);
        statusText.style.display = 'block';
      }
    } finally {
      btn.disabled = false;
      btn.textContent = t.fix_character_ids_btn;
    }
  });
}
