// Settings › Preferencias › Big Picture (PreferencesTab.astro): "Start in
// Big Picture mode" and its "only when a controller is connected" option.
// Storage lives in lib/big-picture/big-picture-preferences.ts (device-level).
// Idempotent, like the other settings mounts.
import { readBigPicturePreferences, writeBigPicturePreferences } from '../../../lib/big-picture/big-picture-preferences';
import { getGamePauseSettings, setGamePauseEnabled } from '../../../lib/tauri/game-pause';
import { formatAppError } from '../../../lib/errors/format-error';
import { showToast } from '../../../lib/dom/toast';
import { getT } from '../../../i18n/runtime';

export function initBigPicturePreferences(): void {
  const section = document.getElementById('big-picture-preferences-section');
  if (!section || section.dataset.bound === 'true') return;
  section.dataset.bound = 'true';
  const start = document.getElementById('big-picture-start') as HTMLInputElement | null;
  const controller = document.getElementById('big-picture-start-controller') as HTMLInputElement | null;
  if (!start || !controller) return;

  const render = () => {
    const prefs = readBigPicturePreferences();
    start.checked = prefs.startInBigPicture;
    controller.checked = prefs.startOnlyWithController;
    // The controller condition only means something when starting in it.
    controller.disabled = !prefs.startInBigPicture;
  };
  render();
  start.addEventListener('change', () => {
    writeBigPicturePreferences({ startInBigPicture: start.checked });
    render();
  });
  controller.addEventListener('change', () => {
    writeBigPicturePreferences({ startOnlyWithController: controller.checked });
    render();
  });

  // Controller pause menu: stored by Rust (it reads the pads, not the page).
  const pauseCombo = document.getElementById('big-picture-pause-combo') as HTMLInputElement | null;
  if (pauseCombo) {
    getGamePauseSettings().then(settings => { pauseCombo.checked = settings.enabled; }).catch(() => {});
    pauseCombo.addEventListener('change', () => {
      const wanted = pauseCombo.checked;
      setGamePauseEnabled(wanted)
        .then(settings => { pauseCombo.checked = settings.enabled; })
        .catch(err => {
          pauseCombo.checked = !wanted;
          showToast(formatAppError(err, getT()), 'error');
        });
    });
  }
}
