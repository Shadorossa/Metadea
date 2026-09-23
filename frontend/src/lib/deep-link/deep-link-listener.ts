// Turns `deep-link://navigate` events from src-tauri/src/deep_link.rs into
// client-router navigations, and applies the link the app may have been
// launched with. Registered once per webview session from BaseLayout — the
// guard is on `window` because BaseLayout's script can run again after a
// View Transitions swap, and the Tauri listener must not be duplicated.
import { isTauri } from '../tauri/bridge';
import { getPendingDeepLink } from '../tauri/deep-link';
import { parseDeepLinkTarget, targetToPath, type DeepLinkTarget } from './deep-link-routes';

export const DEEP_LINK_NAVIGATE_EVENT = 'deep-link://navigate';

declare global {
  interface Window {
    __metadeaDeepLinkListener?: true;
  }
}

async function navigateTo(target: DeepLinkTarget): Promise<void> {
  const path = targetToPath(target);
  const current = window.location.pathname + window.location.search;
  if (current === path) return;
  const { navigate } = await import('astro:transitions/client');
  await navigate(path);
}

export function registerDeepLinkListener(): void {
  if (typeof window === 'undefined' || !isTauri()) return;
  if (window.__metadeaDeepLinkListener) return;
  window.__metadeaDeepLinkListener = true;

  void (async () => {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      await listen<unknown>(DEEP_LINK_NAVIGATE_EVENT, event => {
        const target = parseDeepLinkTarget(event.payload);
        if (!target) {
          console.warn('[DeepLink] Ignoring malformed navigate payload:', event.payload);
          return;
        }
        navigateTo(target).catch(error => console.error('[DeepLink] Navigation failed:', error));
      });
    } catch (error) {
      console.warn('[DeepLink] Could not subscribe to deep-link events:', error);
    }

    // Launched through a link: the Rust side emitted before this listener
    // existed, so the target is waiting in the pending slot instead.
    const pending = await getPendingDeepLink();
    if (pending) {
      navigateTo(pending).catch(error => console.error('[DeepLink] Startup navigation failed:', error));
    }
  })();
}
