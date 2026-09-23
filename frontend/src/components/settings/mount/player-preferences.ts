// Settings › Preferencias › Reproductor (PreferencesTab.astro): reflects the
// stored player preferences on its radio groups, checkboxes and select and persists a change
// immediately. Storage lives in lib/player/player-settings.ts (localStorage,
// device-level). Idempotent: welcome.astro and settings.astro both mount it,
// and astro:page-load can fire more than once on the same DOM.
import {
  getControlsMode, getSeekThumbnailsEnabled, getSkipMode, getTrackPreferences,
  parseAnimeAudio, parseControlsMode, parseFallbackSubtitles, parseSkipMode, parseSubtitleLanguage,
  setControlsMode, setSeekThumbnailsEnabled, setSkipMode, setTrackPreferences,
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
  bindRadioGroup(section, 'player-controls-mode', getControlsMode(), parseControlsMode, setControlsMode);
  bindRadioGroup(section, 'player-skip-mode', getSkipMode(), parseSkipMode, setSkipMode);

  // Seek-bar thumbnails and smart track selection (lib/player/track-preferences.ts).
  bindCheckbox(section, 'player-seek-thumbnails', getSeekThumbnailsEnabled(), setSeekThumbnailsEnabled);
  const tracks = getTrackPreferences();
  bindCheckbox(section, 'player-smart-tracks', tracks.smart, smart => setTrackPreferences({ smart }));
  bindRadioGroup(section, 'player-anime-audio', tracks.animeAudio, parseAnimeAudio, animeAudio => setTrackPreferences({ animeAudio }));
  bindRadioGroup(section, 'player-sub-fallback', tracks.fallbackSubtitles, parseFallbackSubtitles,
    fallbackSubtitles => setTrackPreferences({ fallbackSubtitles }));
  const language = section.querySelector<HTMLSelectElement>('#player-sub-language');
  if (language) {
    language.value = tracks.subtitleLanguage;
    language.addEventListener('change', () => setTrackPreferences({ subtitleLanguage: parseSubtitleLanguage(language.value) }));
  }
  syncSmartTrackOptions(section);
  section.querySelector<HTMLInputElement>('#player-smart-tracks')
    ?.addEventListener('change', () => syncSmartTrackOptions(section));
}

/** Language, fallback and anime-audio only apply with smart tracks on (track-preferences.ts). */
function syncSmartTrackOptions(section: HTMLElement): void {
  const smart = section.querySelector<HTMLInputElement>('#player-smart-tracks');
  if (!smart) return;
  section.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-smart-tracks-option] :is(input, select)')
    .forEach(control => { control.disabled = !smart.checked; });
}

function bindCheckbox(section: HTMLElement, id: string, current: boolean, persist: (value: boolean) => void): void {
  const checkbox = section.querySelector<HTMLInputElement>(`#${id}`);
  if (!checkbox) return;
  checkbox.checked = current;
  checkbox.addEventListener('change', () => persist(checkbox.checked));
}
