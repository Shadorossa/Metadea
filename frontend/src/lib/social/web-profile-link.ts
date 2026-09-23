// "Copy web profile link" in the profile headers (pages/profile.astro via
// components/profile/mount/web-profile-link.ts, and UserProfileView.tsx):
// copies metadea.pages.dev/u/<account id> and confirms with a small popup of
// its own (.web-link-copied-toast in styles/pages/user-profile.css, themed in
// newspaper-dark.css) — not the shared runtime toast, whose restyling would
// change every other notification too.
import { showToast } from '../dom/toast';
import { getT } from '../../i18n/runtime';
import { settingsHref } from '../welcome/settings-tabs';
import { webProfileUrl } from './web-profile-payload';

/** Settings › Perfil scrolled to the "Public web profile" card
 *  (components/settings/mount/web-profile.ts reads `focus`). */
export const WEB_PROFILE_SETTING_FOCUS = 'web-profile';
export const WEB_PROFILE_SETTING_HREF = `${settingsHref({ tab: 'profile' })}&focus=${WEB_PROFILE_SETTING_FOCUS}`;

const POPUP_VISIBLE_MS = 2000;
/** A little over the CSS transition, in case transitionend never fires. */
const POPUP_EXIT_FALLBACK_MS = 400;

function showLinkCopiedPopup(message: string): void {
  document.querySelector('.web-link-copied-toast')?.remove();
  const popup = document.createElement('div');
  popup.className = 'web-link-copied-toast';
  popup.setAttribute('role', 'status');
  popup.textContent = message;
  document.body.appendChild(popup);
  // Force the hidden starting style to apply so adding the class transitions.
  void popup.offsetWidth;
  popup.classList.add('is-visible');
  window.setTimeout(() => {
    popup.classList.remove('is-visible');
    popup.addEventListener('transitionend', () => popup.remove(), { once: true });
    window.setTimeout(() => popup.remove(), POPUP_EXIT_FALLBACK_MS);
  }, POPUP_VISIBLE_MS);
}

export async function copyWebProfileLink(serverUserId: string): Promise<boolean> {
  const url = webProfileUrl(serverUserId);
  try {
    await navigator.clipboard.writeText(url);
    showLinkCopiedPopup(getT().settings.web_profile_copied);
    return true;
  } catch {
    showToast(url, { wide: true });
    return false;
  }
}
