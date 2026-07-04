import { isAdultContentEnabled, setAdultContentEnabled } from './preferences';
import { STORAGE_KEYS } from '../shared/storage-keys';

export function initActivitySettings(showToast: (msg?: string) => void) {
  const batchEpisodesCheckbox = document.getElementById('activity-batch-episodes') as HTMLInputElement | null;
  if (batchEpisodesCheckbox) {
    batchEpisodesCheckbox.checked = localStorage.getItem(STORAGE_KEYS.activityBatchEpisodes) === 'true';
    batchEpisodesCheckbox.addEventListener('change', () => {
      localStorage.setItem(STORAGE_KEYS.activityBatchEpisodes, batchEpisodesCheckbox.checked.toString());
      showToast('Preferencias de actividad guardadas');
    });
  }

  const adultContentCheckbox = document.getElementById('activity-adult-content') as HTMLInputElement | null;
  if (adultContentCheckbox) {
    adultContentCheckbox.checked = isAdultContentEnabled();
    adultContentCheckbox.addEventListener('change', () => {
      setAdultContentEnabled(adultContentCheckbox.checked);
      showToast('Preferencias de actividad guardadas');
    });
  }
}
