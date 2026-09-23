// Settings › Preferencias › Reproductor (PreferencesTab.astro): reflects the
// stored player preferences on the three radio groups and persists a change
// immediately. Storage lives in lib/player/player-settings.ts (localStorage,
// device-level). Idempotent: welcome.astro and settings.astro both mount it,
// and astro:page-load can fire more than once on the same DOM.
import {
  getControlsMode, getPlaybackEngine, getSkipMode,
  parseControlsMode, parsePlaybackEngine, parseSkipMode,
  setControlsMode, setPlaybackEngine, setSkipMode,
} from '../../../lib/player/player-settings';

function bindRadioGroup<T extends string>(
  section: HTMLElement,
  name: string,
  current: T,
  parse: (raw: string) => T,
  persist: (value: T) => void,
): void {
  section.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach(radio => {
    radio.checked = radio.value === current;
    radio.addEventListener('change', () => {
      if (radio.checked) persist(parse(radio.value));
    });
  });
}

export function initPlayerPreferences(): void {
  const section = document.getElementById('player-preferences-section');
  if (!section || section.dataset.bound === 'true') return;
  section.dataset.bound = 'true';
  bindRadioGroup(section, 'playback-engine', getPlaybackEngine(), parsePlaybackEngine, setPlaybackEngine);
  bindRadioGroup(section, 'player-controls-mode', getControlsMode(), parseControlsMode, setControlsMode);
  bindRadioGroup(section, 'player-skip-mode', getSkipMode(), parseSkipMode, setSkipMode);
}
