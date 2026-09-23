// Own profile header (pages/profile.astro): the "Copy web profile link"
// button where someone else's profile has Follow. Hidden without a
// Google-linked session (the public page is keyed by the server account id);
// dimmed while this device's web profile choice isn't "on", and then a click
// opens that setting instead of copying a link that would 404.
import { getAuthToken } from '../../../lib/tauri';
import { decodeJwtPayload } from '../../../lib/profile/media-type-label';
import { getWebProfilePublicChoice } from '../../../lib/storage/preferences';
import { copyWebProfileLink, WEB_PROFILE_SETTING_HREF } from '../../../lib/social/web-profile-link';
import { getT } from '../../../i18n/runtime';

export async function mountWebProfileLinkButton(): Promise<void> {
  const button = document.getElementById('profile-web-link-btn') as HTMLButtonElement | null;
  if (!button) return;

  const session = await getAuthToken().catch(() => null);
  const payload = session?.token && session.token !== 'offline_token' ? decodeJwtPayload(session.token) : {};
  const userId = typeof payload.userId === 'string' ? payload.userId : null;
  if (!userId) { button.hidden = true; return; }

  const t = getT().settings;
  const isPublic = getWebProfilePublicChoice() === true;
  const label = isPublic ? t.web_profile_copy : t.web_profile_private;
  button.classList.toggle('is-dimmed', !isPublic);
  button.setAttribute('aria-label', label);
  button.dataset.tooltip = label;
  button.onclick = () => {
    if (isPublic) void copyWebProfileLink(userId);
    else void import('astro:transitions/client').then(({ navigate }) => navigate(WEB_PROFILE_SETTING_HREF));
  };
  button.hidden = false;
}
