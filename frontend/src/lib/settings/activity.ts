import { isAdultContentEnabled, setAdultContentEnabled } from './preferences';

export function initActivitySettings(showToast: (msg?: string) => void) {
  const batchEpisodesCheckbox = document.getElementById('activity-batch-episodes') as HTMLInputElement | null;
  if (batchEpisodesCheckbox) {
    batchEpisodesCheckbox.checked = localStorage.getItem('metadea_activity_batch_episodes') === 'true';
    batchEpisodesCheckbox.addEventListener('change', () => {
      localStorage.setItem('metadea_activity_batch_episodes', batchEpisodesCheckbox.checked.toString());
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
