import { tauriTry } from './bridge';
import { parseDeepLinkTarget, type DeepLinkTarget } from '../deep-link/deep-link-routes';

// A metadea:// link the process was launched with (or that arrived before the
// webview was listening) — see src-tauri/src/deep_link.rs. Drained on read;
// null outside Tauri or when there is nothing parked.
export async function getPendingDeepLink(): Promise<DeepLinkTarget | null> {
  return parseDeepLinkTarget(await tauriTry<unknown>('get_pending_deep_link', null));
}
