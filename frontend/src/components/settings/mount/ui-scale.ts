// Settings › Preferences › Interface scale (PreferencesTab.astro): Auto or a
// fixed percent. Applied live by lib/ui-scale/ui-scale-runtime.ts (webview
// zoom, no reload). Idempotent, like the other settings mounts.
import { getT } from '../../../i18n/runtime';
import { parseUiScalePreference } from '../../../lib/ui-scale/ui-scale';
import {
  getAppliedUiZoom,
  readUiScalePreference,
  writeUiScalePreference,
} from '../../../lib/ui-scale/ui-scale-runtime';
import { isTauri } from '../../../lib/tauri/bridge';

export function initUiScaleSetting(): void {
  const section = document.getElementById('ui-scale-section');
  if (!section || section.dataset.bound === 'true') return;
  section.dataset.bound = 'true';
  const buttons = section.querySelectorAll<HTMLButtonElement>('#ui-scale-picker [data-value]');
  const current = document.getElementById('ui-scale-current');

  const render = () => {
    const preference = readUiScalePreference();
    buttons.forEach(btn => {
      const active = parseUiScalePreference(btn.dataset.value) === preference;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    if (current) {
      // The zoom only exists inside the app window.
      current.hidden = !isTauri();
      current.textContent = getT().settings.ui_scale_current
        .replace('{percent}', String(Math.round(getAppliedUiZoom() * 100)));
    }
  };

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      writeUiScalePreference(parseUiScalePreference(btn.dataset.value));
      render();
    });
  });

  // The applied zoom lands asynchronously and changes innerWidth (a resize).
  const onResize = () => {
    if (!section.isConnected) {
      window.removeEventListener('resize', onResize);
      return;
    }
    render();
  };
  window.addEventListener('resize', onResize);
  render();
}
