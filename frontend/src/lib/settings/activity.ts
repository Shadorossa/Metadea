import { isAdultContentEnabled, setAdultContentEnabled } from './preferences';
import { STORAGE_KEYS } from '../shared/storage-keys';
import { byId } from '../shared/dom';
import { clearAllRatings } from '../tauri/library';
import { getT } from '../../i18n/client';

export function initActivitySettings(showToast: (msg?: string) => void) {
  const batchEpisodesCheckbox = byId<HTMLInputElement>('activity-batch-episodes');
  if (batchEpisodesCheckbox) {
    batchEpisodesCheckbox.checked = localStorage.getItem(STORAGE_KEYS.activityBatchEpisodes) === 'true';
    batchEpisodesCheckbox.addEventListener('change', () => {
      localStorage.setItem(STORAGE_KEYS.activityBatchEpisodes, batchEpisodesCheckbox.checked.toString());
      showToast();
    });
  }

  const adultContentCheckbox = byId<HTMLInputElement>('activity-adult-content');
  if (adultContentCheckbox) {
    adultContentCheckbox.checked = isAdultContentEnabled();
    adultContentCheckbox.addEventListener('change', () => {
      setAdultContentEnabled(adultContentCheckbox.checked);
      showToast();
    });
  }

  initClearAllRatings(showToast);
}

// "Eliminar todas las notas" (Contenido) — clears every work's own rating
// score. Irreversible and affects the whole library at once, so the confirm
// button starts disabled and only becomes clickable after a fixed 5s delay
// (also shown as a countdown, so the wait itself doesn't just look broken/
// unresponsive), on top of the modal's own explicit Cancel option.
const CONFIRM_DELAY_MS = 5000;

function initClearAllRatings(showToast: (msg?: string) => void) {
  const openBtn = byId<HTMLButtonElement>('clear-all-notes-btn');
  const modal = byId<HTMLElement>('clear-notes-modal');
  const closeBtn = byId<HTMLButtonElement>('clear-notes-modal-close');
  const cancelBtn = byId<HTMLButtonElement>('clear-notes-cancel-btn');
  const confirmBtn = byId<HTMLButtonElement>('clear-notes-confirm-btn');
  if (!openBtn || !modal || !closeBtn || !cancelBtn || !confirmBtn) return;

  let countdownTimer: ReturnType<typeof setInterval> | null = null;
  let enableTimer: ReturnType<typeof setTimeout> | null = null;

  function stopTimers() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    if (enableTimer) { clearTimeout(enableTimer); enableTimer = null; }
  }

  function closeModal() {
    stopTimers();
    modal!.classList.add('hidden');
  }

  function openModal() {
    const confirmLabel = getT().settings.clear_notes_confirm_yes;
    confirmBtn!.disabled = true;
    modal!.classList.remove('hidden');

    let remaining = Math.ceil(CONFIRM_DELAY_MS / 1000);
    confirmBtn!.textContent = `${confirmLabel} (${remaining})`;
    countdownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) confirmBtn!.textContent = `${confirmLabel} (${remaining})`;
    }, 1000);
    enableTimer = setTimeout(() => {
      stopTimers();
      confirmBtn!.disabled = false;
      confirmBtn!.textContent = confirmLabel;
    }, CONFIRM_DELAY_MS);
  }

  openBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  modal.querySelector('.settings-help-modal-overlay')?.addEventListener('click', closeModal);

  confirmBtn.addEventListener('click', async () => {
    if (confirmBtn!.disabled) return;
    confirmBtn!.disabled = true;
    try {
      await clearAllRatings();
      closeModal();
      showToast(getT().settings.clear_notes_done);
    } catch (err) {
      console.error('Failed to clear all ratings:', err);
      confirmBtn!.disabled = false;
    }
  });
}
