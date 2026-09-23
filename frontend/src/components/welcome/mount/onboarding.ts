// First-run onboarding (pages/welcome.astro): moves the real settings
// controls out of the hidden settings tabs into each step, wires the step
// navigation (stepper, back/next, resume point). The statically rendered copy
// is translated by the global applier (lib/i18n-dom) through its data-i18n
// markers. Step order and resume rules live in lib/welcome/onboarding-steps.ts.
import { getAuthToken } from '../../../lib/tauri/auth';
import { decodeJwtPayload } from '../../../lib/profile/media-type-label';
import { STORAGE_KEYS } from '../../../lib/storage/storage-keys';
import {
  ONBOARDING_STEPS, clampStep, progressPercent, resolveStartStep,
} from '../../../lib/welcome/onboarding-steps';
import { getT } from '../../../i18n/runtime';
import { interpolateTranslation } from '../../../lib/i18n-dom/apply-translations';
import { initAvatar, initShareAvatar } from '../../settings/mount/avatar';
import { initBanner } from '../../settings/mount/banner';
import { initThemePicker } from '../../settings/mount/theme';
import { initEnvironment } from '../../settings/mount/environment';
import { initPlayerPreferences } from '../../settings/mount/player-preferences';
import { initEmulators } from '../../settings/mount/emulators';
import { initGitHubAuth } from '../../settings/mount/github';
import { initAniListAuth } from '../../settings/mount/anilist';
import { initAniListImportUI } from '../../settings/mount/anilist-import-ui';
import { initMal } from '../../settings/mount/mal';
import { initDisplayName } from '../../settings/mount/display-name';
import { initFontPicker } from '../../settings/mount/fonts';
import { initRatingSystem } from '../../settings/mount/rating-system';
import { initCustomColor } from '../../settings/mount/custom-color';
import { initActivitySettings } from '../../settings/mount/activity';
import { initSpoilerPreferences } from '../../settings/mount/spoiler-preferences';
import { initDualRating } from '../../settings/mount/dual-rating';
import { initLanguageSwitcher } from '../../settings/mount/language';
import { initBio } from '../../settings/mount/bio';

let initializedRoot: HTMLElement | null = null;

function moveConfigPart(source: HTMLElement, part: string, targetId: string): void {
  const target = document.getElementById(targetId);
  if (!target) return;
  source.querySelectorAll<HTMLElement>(`[data-onboarding-part="${part}"]`).forEach((item) => target.appendChild(item));
}

function moveElement(element: Element | null, targetId: string): void {
  if (element) document.getElementById(targetId)?.appendChild(element);
}

/** Relocates the settings controls each step reuses, then drops the rest. */
function distributeSettings(): void {
  const source = document.getElementById('welcome-config-source');
  if (!source) return;
  moveConfigPart(source, 'basics-language', 'onboarding-basic-language');
  moveConfigPart(source, 'appearance-theme', 'onboarding-basic-theme');
  moveConfigPart(source, 'profile-media', 'onboarding-profile-content');
  moveConfigPart(source, 'profile-details', 'onboarding-profile-content');
  moveConfigPart(source, 'library-rating', 'onboarding-library-rating-row');
  moveConfigPart(source, 'library-options', 'onboarding-library-content');
  moveConfigPart(source, 'player', 'onboarding-player-content');
  moveConfigPart(source, 'local-routes', 'onboarding-local-content');
  moveConfigPart(source, 'api-keys', 'onboarding-api-content');
  moveElement(source.querySelector('#panel-emulators'), 'onboarding-emulators-content');
  moveElement(source.querySelector('#panel-application'), 'onboarding-connections-content');
  // The language hint says "reload to apply", which the language buttons
  // already do; and wiping every note is not a first-run decision.
  document.querySelector('#onboarding-basic-language [data-i18n="settings.language_hint"]')?.remove();
  document.querySelector('#onboarding-library-content #clear-all-notes-btn')?.closest('.prefs-row')?.remove();
  source.remove();
}

function wireHelpModals(): void {
  document.querySelectorAll<HTMLButtonElement>('button[data-help]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const modal = document.getElementById(`${button.dataset.help}-help-modal`);
      if (modal) {
        modal.classList.remove('hidden');
        modal.style.display = 'flex';
      }
    });
  });
  document.querySelectorAll<HTMLElement>('.settings-help-modal-close, .settings-help-modal-overlay').forEach((control) => {
    control.addEventListener('click', (event) => {
      const modal = (event.target as HTMLElement).closest<HTMLElement>('.settings-help-modal');
      if (modal) {
        modal.style.display = 'none';
        modal.classList.add('hidden');
      }
    });
  });
}

/** Service tabs in the API keys step: clicking the active one returns to the placeholder. */
function wireServiceTabs(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>('.api-platform-tab-btn');
  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const platform = button.dataset.platform;
      const wasActive = button.classList.contains('active');
      buttons.forEach((item) => item.classList.remove('active'));
      document.querySelectorAll('.api-platform-form-block').forEach((form) => form.classList.add('hidden'));
      document.getElementById('api-keys-placeholder')?.classList.toggle('hidden', !wasActive);
      if (!wasActive && platform) {
        button.classList.add('active');
        document.getElementById(`api-form-${platform}`)?.classList.remove('hidden');
      }
    });
  });
  // The "which key is for what" list above the form opens that service's form.
  document.querySelectorAll<HTMLButtonElement>('[data-open-platform]').forEach((shortcut) => {
    shortcut.addEventListener('click', () => {
      const tab = document.querySelector<HTMLButtonElement>(`.api-platform-tab-btn[data-platform="${shortcut.dataset.openPlatform}"]`);
      if (!tab) return;
      if (!tab.classList.contains('active')) tab.click();
      const form = document.getElementById(`api-form-${shortcut.dataset.openPlatform}`);
      (form ?? tab).scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  });
}

function showSettingsToast(message?: string): void {
  const toast = document.getElementById('settings-toast');
  if (!toast) return;
  toast.textContent = message || getT().settings.env_saved;
  toast.classList.add('visible');
  window.setTimeout(() => toast.classList.remove('visible'), 2200);
}

function initSettingsControls(token: string, username: string): void {
  const payload = decodeJwtPayload(token);
  const avatar = payload.avatar as string | null;
  initAvatar(avatar, username, showSettingsToast);
  initShareAvatar(showSettingsToast);
  initBanner(showSettingsToast);
  initFontPicker(username, showSettingsToast);
  initThemePicker(showSettingsToast);
  initEnvironment(showSettingsToast);
  initPlayerPreferences();
  initEmulators(showSettingsToast);
  initGitHubAuth();
  initAniListAuth();
  initAniListImportUI(showSettingsToast);
  initMal(showSettingsToast);
  initDisplayName(showSettingsToast);
  initRatingSystem(showSettingsToast);
  initCustomColor(showSettingsToast);
  initActivitySettings(showSettingsToast);
  initSpoilerPreferences(showSettingsToast);
  initDualRating(showSettingsToast);
  initLanguageSwitcher();
  initBio(showSettingsToast);
}

export async function mountOnboarding(): Promise<void> {
  const root = document.querySelector<HTMLElement>('.onboarding-page');
  if (!root || root === initializedRoot) return;
  initializedRoot = root;

  const session = await getAuthToken().catch(() => null);
  if (!session?.token) {
    window.location.replace('/login');
    return;
  }

  const t = getT();
  const page = root;
  const previewMode = new URLSearchParams(window.location.search).get('preview') === '1';
  const steps = Array.from(root.querySelectorAll<HTMLElement>('.onboarding-step'));
  const stepperButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-step-target]'));
  const counter = document.getElementById('onboarding-step-count');
  const stepLabel = document.getElementById('onboarding-step-label');
  const progress = root.querySelector<HTMLElement>('.onboarding-progress');
  const progressFill = document.getElementById('onboarding-progress-fill');
  const back = document.getElementById('onboarding-back') as HTMLButtonElement | null;
  const next = document.getElementById('onboarding-next') as HTMLButtonElement | null;
  const skip = document.getElementById('onboarding-skip') as HTMLButtonElement | null;
  const finish = document.getElementById('onboarding-finish') as HTMLButtonElement | null;
  const openGuide = document.getElementById('onboarding-open-guide') as HTMLButtonElement | null;
  const lastStep = steps.length - 1;

  distributeSettings();

  let currentStep = previewMode ? 0 : clampStep(resolveStartStep(localStorage.getItem(STORAGE_KEYS.onboardingStep)));

  function renderStep(scroll: boolean) {
    const def = ONBOARDING_STEPS[currentStep];
    steps.forEach((step, index) => {
      step.hidden = index !== currentStep;
      step.querySelector<HTMLElement>('.settings-panel')?.classList.remove('hidden');
    });
    stepperButtons.forEach((button, index) => {
      button.classList.toggle('is-current', index === currentStep);
      button.classList.toggle('is-done', index < currentStep);
      if (index === currentStep) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    const current = String(currentStep + 1);
    const total = String(steps.length);
    if (counter) counter.textContent = interpolateTranslation(t.onboarding.step_count, { current, total });
    if (stepLabel && def) stepLabel.textContent = t.onboarding.steps[def.id].label;
    progress?.setAttribute('aria-valuenow', current);
    if (progressFill) progressFill.style.width = `${progressPercent(currentStep)}%`;
    if (back) back.hidden = currentStep === 0;
    if (next) next.hidden = currentStep === lastStep;
    if (finish) finish.hidden = currentStep !== lastStep;
    document.body.classList.toggle('onboarding-guide-final', currentStep === lastStep);
    if (!previewMode && def) localStorage.setItem(STORAGE_KEYS.onboardingStep, def.id);
    if (scroll) page.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function goTo(index: number) {
    currentStep = clampStep(index);
    renderStep(true);
    steps[currentStep]?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  }

  function finishOnboarding(destination = '/home') {
    if (previewMode) {
      window.location.replace(destination === '/home' ? '/settings?tab=profile' : destination);
      return;
    }
    localStorage.setItem(STORAGE_KEYS.onboardingCompleted, '1');
    localStorage.removeItem(STORAGE_KEYS.onboardingStep);
    window.location.replace(destination);
  }

  steps.forEach((step) => step.querySelector('h2')?.setAttribute('tabindex', '-1'));
  back?.addEventListener('click', () => goTo(currentStep - 1));
  next?.addEventListener('click', () => goTo(currentStep + 1));
  stepperButtons.forEach((button, index) => button.addEventListener('click', () => goTo(index)));
  skip?.addEventListener('click', () => finishOnboarding());
  finish?.addEventListener('click', () => finishOnboarding());
  openGuide?.addEventListener('click', () => finishOnboarding('/guide'));

  initSettingsControls(session.token, session.username);
  wireServiceTabs();
  wireHelpModals();
  renderStep(false);
}

/** Dims and disables the navbar while the flow is open; returns whether it is. */
export function syncOnboardingChrome(): boolean {
  const isOnboarding = !!document.querySelector('.onboarding-page');
  const navbar = document.querySelector<HTMLElement>('.navbar');
  document.body.classList.toggle('onboarding-active', isOnboarding);
  if (navbar) {
    if (isOnboarding) {
      navbar.setAttribute('inert', '');
      navbar.setAttribute('aria-hidden', 'true');
    } else {
      navbar.removeAttribute('inert');
      navbar.removeAttribute('aria-hidden');
    }
  }
  return isOnboarding;
}
