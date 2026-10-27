// Settings › Connections › Backloggd: import the CSV the Toolkittd browser
// extension exports (lib/backloggd). Backloggd has no API and its pages sit
// behind a bot challenge, so the user's own export is the only source.
import { importBackloggdGames } from '../../../lib/backloggd/import';
import { parseToolkittdCsv } from '../../../lib/backloggd/toolkittd-csv';
import { openExternalUrl } from '../../../lib/tauri/game-launch';
import { formatAppError } from '../../../lib/errors/format-error';
import { byId } from '../../../lib/dom/dom';
import { showToast } from '../../../lib/dom/toast';
import { getT } from '../../../i18n/runtime';
import { createImportProgressModal } from './import-progress-modal';

const TOOLKITTD_URL = 'https://addons.mozilla.org/firefox/addon/toolkittd/';

export function initBackloggdImport(showSettingsToast: (msg?: string) => void) {
  const importBtn = byId<HTMLButtonElement>('backloggd-import-btn');
  const fileInput = byId<HTMLInputElement>('backloggd-import-file');
  byId<HTMLButtonElement>('backloggd-extension-btn')?.addEventListener('click', () => {
    openExternalUrl(TOOLKITTD_URL).catch(err => showToast(formatAppError(err, getT()), 'error'));
  });
  if (!importBtn || !fileInput) return;

  importBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    const t = getT().backloggd;
    const games = parseToolkittdCsv(await file.text());
    if (!games) {
      showToast(t.invalid_file, 'error');
      return;
    }

    importBtn.disabled = true;
    const progressModal = createImportProgressModal(t.import_title);
    try {
      const result = await importBackloggdGames(games, progress => progressModal.update(progress));
      const summary = (result.unmatched.length ? t.import_result_unmatched : t.import_result)
        .replace('{updated}', String(result.updated))
        .replace('{added}', String(result.added))
        .replace('{unmatched}', String(result.unmatched.length));
      showSettingsToast(summary);
      if (result.unmatched.length) {
        console.warn(`[Backloggd] ${t.import_unmatched_title}`, result.unmatched.map(game => game.name));
      }
      if (result.failed) {
        const done = result.updated + result.added;
        showToast(getT().settings.anilist_import_partial
          .replace('{done}', String(done))
          .replace('{total}', String(done + result.failed))
          .replace('{failed}', String(result.failed)), 'error');
      }
    } catch (err) {
      showToast(getT().settings.error_with_message.replace('{message}', formatAppError(err, getT())), 'error');
    } finally {
      progressModal.remove();
      importBtn.disabled = false;
    }
  });
}
