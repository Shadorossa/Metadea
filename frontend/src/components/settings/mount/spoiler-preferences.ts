// Settings › Preferencias › Contenido › Spoiler shield (PreferencesTab.astro):
// on/off, the Normal/Strict level and "also hide covers of future seasons
// and arcs". Storage in lib/spoilers/spoiler-settings.ts (device-level);
// every write fires SPOILER_SETTINGS_CHANGED_EVENT so open islands follow.
// Idempotent, like the other settings mounts.
import { readSpoilerSettings, writeSpoilerSettings, type SpoilerLevel } from '../../../lib/spoilers/spoiler-settings';

export function initSpoilerPreferences(showToast: (msg?: string) => void): void {
  const section = document.getElementById('spoiler-shield-preferences');
  if (!section || section.dataset.bound === 'true') return;
  section.dataset.bound = 'true';
  const enabled = document.getElementById('spoiler-shield-enabled') as HTMLInputElement | null;
  const level = document.getElementById('spoiler-shield-level') as HTMLSelectElement | null;
  const covers = document.getElementById('spoiler-shield-hide-covers') as HTMLInputElement | null;
  if (!enabled || !level || !covers) return;

  const render = () => {
    const settings = readSpoilerSettings();
    enabled.checked = settings.enabled;
    level.value = settings.level;
    covers.checked = settings.hideFutureCovers;
    // The level and the covers option only mean something with the shield on.
    level.disabled = !settings.enabled;
    covers.disabled = !settings.enabled;
  };
  render();

  const save = (patch: Parameters<typeof writeSpoilerSettings>[0]) => {
    writeSpoilerSettings(patch);
    render();
    showToast();
  };
  enabled.addEventListener('change', () => save({ enabled: enabled.checked }));
  level.addEventListener('change', () => save({ level: (level.value === 'strict' ? 'strict' : 'normal') as SpoilerLevel }));
  covers.addEventListener('change', () => save({ hideFutureCovers: covers.checked }));
}
