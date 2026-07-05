import { isAdultContentEnabled, setAdultContentEnabled } from './preferences';
import { STORAGE_KEYS } from '../shared/storage-keys';
import { byId } from '../shared/dom';

export function initActivitySettings(showToast: (msg?: string) => void) {
  const batchEpisodesCheckbox = byId<HTMLInputElement>('activity-batch-episodes');
  if (batchEpisodesCheckbox) {
    batchEpisodesCheckbox.checked = localStorage.getItem(STORAGE_KEYS.activityBatchEpisodes) === 'true';
    batchEpisodesCheckbox.addEventListener('change', () => {
      localStorage.setItem(STORAGE_KEYS.activityBatchEpisodes, batchEpisodesCheckbox.checked.toString());
      showToast('Preferencias de actividad guardadas');
    });
  }

  const adultContentCheckbox = byId<HTMLInputElement>('activity-adult-content');
  if (adultContentCheckbox) {
    adultContentCheckbox.checked = isAdultContentEnabled();
    adultContentCheckbox.addEventListener('change', () => {
      setAdultContentEnabled(adultContentCheckbox.checked);
      showToast('Preferencias de actividad guardadas');
    });
  }
}
