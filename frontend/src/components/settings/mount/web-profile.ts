// Settings › Perfil › "Public web profile" (ProfileTab.astro): the opt-in
// toggle (lib/storage/preferences.ts) and an immediate profile sync on every
// change so turning it off takes effect now, not at the next daily sync.
// The link itself lives in the profile headers (lib/social/web-profile-link.ts),
// whose dimmed button deep-links here with `focus=web-profile`.
// Needs a Google-linked session (the page is keyed by the server account
// id). Idempotent, like the other settings mounts.
import { byId } from '../../../lib/dom/dom';
import { getAuthToken } from '../../../lib/tauri';
import { decodeJwtPayload } from '../../../lib/profile/media-type-label';
import { getWebProfilePublicChoice, setWebProfilePublic } from '../../../lib/storage/preferences';
import { syncProfileToServer } from '../../../lib/social/profile-sync';
import { WEB_PROFILE_SETTING_FOCUS } from '../../../lib/social/web-profile-link';
import { getT } from '../../../i18n/runtime';

export async function initWebProfile(showToast: (msg?: string) => void): Promise<void> {
  const section = byId('web-profile-section');
  const checkbox = byId<HTMLInputElement>('web-profile-public');
  const needsAccount = byId('web-profile-needs-account');
  if (!section || !checkbox || !needsAccount) return;
  if (section.dataset.bound === 'true') return;
  section.dataset.bound = 'true';

  const session = await getAuthToken().catch(() => null);
  const payload = session?.token && session.token !== 'offline_token' ? decodeJwtPayload(session.token) : {};
  const userId = typeof payload.userId === 'string' ? payload.userId : null;
  checkbox.checked = getWebProfilePublicChoice() === true;
  checkbox.disabled = !userId;
  needsAccount.hidden = !!userId;

  if (new URLSearchParams(location.search).get('focus') === WEB_PROFILE_SETTING_FOCUS) {
    section.scrollIntoView({ block: 'center' });
    checkbox.focus({ preventScroll: true });
  }

  checkbox.addEventListener('change', async () => {
    setWebProfilePublic(checkbox.checked);
    checkbox.disabled = true;
    const synced = await syncProfileToServer(true).catch(() => false);
    checkbox.disabled = false;
    showToast(synced ? undefined : getT().settings.web_profile_sync_failed);
  });
}
