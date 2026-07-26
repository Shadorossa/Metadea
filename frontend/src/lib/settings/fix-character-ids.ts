import { getT } from '../../i18n/client';
import { byId } from '../shared/dom';

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' &&
    ('__TAURI_IPC__' in window || '__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

// TEMPORARY — manual trigger for fix_character_ids (vestigial_cleanup.rs).
// db.rs's own migration already runs this once automatically, but a user
// whose db was already marked as migrated before this fixup grew to cover
// comicvine:/tmdb: rows and favorite_custom_images would never get those
// extra rewrites otherwise — this button lets them force it on demand.
// Delete this file (and its card in NovedadesTab.astro) alongside the Rust
// side once that's no longer a concern.
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
      const { fixCharacterIds } = await import('../tauri');
      await fixCharacterIds();
      if (statusText) {
        statusText.textContent = t.fix_character_ids_done;
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
