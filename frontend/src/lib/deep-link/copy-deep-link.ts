import { buildShareUrl, type DeepLinkTarget } from './deep-link-routes';
import { buildShareLink, type ShareableWork } from './share-link';

// Copies the https share form of a target (the one Discord and chats accept).
// A media target with its catalog data gets the rich preview link
// (share-link.ts); anything else, or data the codec cannot encode, the
// plain site/open/ redirect. Resolves true on success so the caller can
// show its own confirmation.
export async function copyDeepLink(target: DeepLinkTarget, work?: ShareableWork): Promise<boolean> {
  try {
    const rich = work && target.kind === 'media' && work.externalId === target.external_id
      ? buildShareLink(work)
      : null;
    await navigator.clipboard.writeText(rich ?? buildShareUrl(target));
    return true;
  } catch (error) {
    console.warn('[DeepLink] Could not copy the link:', error);
    return false;
  }
}
