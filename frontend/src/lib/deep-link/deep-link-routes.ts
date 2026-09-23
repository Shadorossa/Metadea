// Pure mapping between deep-link targets, the in-app routes they open and
// the two URL forms a target can be shared as:
//   metadea://media/anime:21610                      (opens the app directly)
//   https://shadorossa.github.io/Metadea/open/?to=media/anime:21610
//                                                    (https redirect page in
//                                                     site/open/, for Discord
//                                                     buttons and chats that
//                                                     only accept https)
// The target shape and the id validation mirror src-tauri/src/deep_link.rs
// and site/open/index.html; keep the three in sync.

export type DeepLinkTarget =
  | { kind: 'media'; external_id: string }
  | { kind: 'character'; id: string }
  | { kind: 'profile'; user: string }
  | { kind: 'home' };

export const DEEP_LINK_SCHEME = 'metadea';
export const SHARE_URL_BASE = 'https://shadorossa.github.io/Metadea/open/';

const PREFIXED_ID = /^[a-z]+:[A-Za-z0-9_-]+$/;
const PLAIN_ID = /^[A-Za-z0-9_-]+$/;

export function isValidDeepLinkTarget(target: DeepLinkTarget): boolean {
  switch (target.kind) {
    case 'media': return PREFIXED_ID.test(target.external_id);
    case 'character': return PREFIXED_ID.test(target.id);
    case 'profile': return PLAIN_ID.test(target.user);
    case 'home': return true;
    default: return false;
  }
}

/** The in-app path the client router navigates to for a target. */
export function targetToPath(target: DeepLinkTarget): string {
  switch (target.kind) {
    case 'media': return `/media?id=${encodeURIComponent(target.external_id)}`;
    case 'character': return `/character?id=${encodeURIComponent(target.id)}`;
    case 'profile': return `/user?id=${encodeURIComponent(target.user)}`;
    case 'home': return '/home';
  }
}

// `<kind>[/<id>]` — the part after `metadea://`, also what the redirect
// page's `?to=` carries.
function targetToLocator(target: DeepLinkTarget): string {
  switch (target.kind) {
    case 'media': return `media/${target.external_id}`;
    case 'character': return `character/${target.id}`;
    case 'profile': return `profile/${target.user}`;
    case 'home': return 'home';
  }
}

function assertValid(target: DeepLinkTarget): void {
  if (!isValidDeepLinkTarget(target)) {
    throw new Error(`Invalid deep link target: ${JSON.stringify(target)}`);
  }
}

/** `metadea://media/anime:21610` */
export function buildDeepLink(target: DeepLinkTarget): string {
  assertValid(target);
  return `${DEEP_LINK_SCHEME}://${targetToLocator(target)}`;
}

/** `https://shadorossa.github.io/Metadea/open/?to=media/anime:21610` */
export function buildShareUrl(target: DeepLinkTarget): string {
  assertValid(target);
  // Ids only ever contain [A-Za-z0-9_-:/], all legal in a query value, so
  // the locator stays readable instead of `media%2Fanime%3A21610`.
  return `${SHARE_URL_BASE}?to=${targetToLocator(target)}`;
}

/**
 * Narrows the untyped payload of a `deep-link://navigate` event (or the
 * `get_pending_deep_link` command) to a target the router may act on.
 */
export function parseDeepLinkTarget(payload: unknown): DeepLinkTarget | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as Record<string, unknown>;
  let target: DeepLinkTarget;
  switch (value.kind) {
    case 'media':
      if (typeof value.external_id !== 'string') return null;
      target = { kind: 'media', external_id: value.external_id };
      break;
    case 'character':
      if (typeof value.id !== 'string') return null;
      target = { kind: 'character', id: value.id };
      break;
    case 'profile':
      if (typeof value.user !== 'string') return null;
      target = { kind: 'profile', user: value.user };
      break;
    case 'home':
      target = { kind: 'home' };
      break;
    default:
      return null;
  }
  return isValidDeepLinkTarget(target) ? target : null;
}
