import { buildShareUrl, type DeepLinkTarget } from './deep-link-routes';

// Copies the https share form of a target (the one Discord and chats accept;
// site/open/ turns it into metadea://). Resolves true on success so the
// caller can show its own confirmation.
export async function copyDeepLink(target: DeepLinkTarget): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(buildShareUrl(target));
    return true;
  } catch (error) {
    console.warn('[DeepLink] Could not copy the link:', error);
    return false;
  }
}
