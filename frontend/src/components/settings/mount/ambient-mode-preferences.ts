// Settings › Preferencias › Ambient TV mode (PreferencesTab.astro): the
// on/off toggle, the idle delay, "Play the Jukebox in ambient mode" and the
// Preview button. Storage in lib/storage/preferences.ts (device-level); the
// watcher (lib/ambient/ambient-watcher.ts) re-reads it on every change.
// Idempotent, like the other settings mounts.
import {
  getAmbientIdleMinutes, isAmbientJukeboxEnabled, isAmbientModeEnabled, parseAmbientIdleMinutes,
  setAmbientIdleMinutes, setAmbientJukeboxEnabled, setAmbientModeEnabled,
} from '../../../lib/storage/preferences';
import { requestAmbientPreview } from '../../../lib/ambient/ambient-state';

export function initAmbientModePreferences(): void {
  const section = document.getElementById('ambient-mode-preferences-section');
  if (!section || section.dataset.bound === 'true') return;
  section.dataset.bound = 'true';
  const enabled = document.getElementById('ambient-mode-enabled') as HTMLInputElement | null;
  const delay = document.getElementById('ambient-mode-delay') as HTMLSelectElement | null;
  const jukebox = document.getElementById('ambient-mode-jukebox') as HTMLInputElement | null;
  const preview = document.getElementById('ambient-mode-preview') as HTMLButtonElement | null;
  if (!enabled || !delay || !jukebox || !preview) return;

  const render = () => {
    const on = isAmbientModeEnabled();
    enabled.checked = on;
    delay.value = String(getAmbientIdleMinutes());
    jukebox.checked = isAmbientJukeboxEnabled();
    // The delay and the jukebox option only mean something with the mode on;
    // Preview stays available either way.
    delay.disabled = !on;
    jukebox.disabled = !on;
  };
  render();
  enabled.addEventListener('change', () => {
    setAmbientModeEnabled(enabled.checked);
    render();
  });
  delay.addEventListener('change', () => {
    setAmbientIdleMinutes(parseAmbientIdleMinutes(delay.value));
    render();
  });
  jukebox.addEventListener('change', () => {
    setAmbientJukeboxEnabled(jukebox.checked);
    render();
  });
  preview.addEventListener('click', () => requestAmbientPreview());
}
