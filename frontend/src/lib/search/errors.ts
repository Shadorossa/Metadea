// Thrown by a search provider when the search couldn't run because its
// required API key(s) aren't configured yet (as opposed to a network/API
// failure) — lets the UI show a "go configure it" prompt instead of a
// generic error or a silent empty result set.
export class MissingApiKeyError extends Error {
  providers: string[];

  constructor(providers: string[]) {
    super(`Missing API key for: ${providers.join(', ')}`);
    this.name = 'MissingApiKeyError';
    this.providers = providers;
  }
}

export class AniListSearchError extends Error {
  type: 'token_expired' | 'network_error' | 'unknown';
  i18nKey: string;

  constructor(type: 'token_expired' | 'network_error' | 'unknown', message: string, i18nKey: string) {
    super(message);
    this.name = 'AniListSearchError';
    this.type = type;
    this.i18nKey = i18nKey;
  }
}

export function showAniListSearchErrorPopup(error: AniListSearchError): void {
  try {
    const t = (window as any).__i18n?.settings;
    const message = t?.[error.i18nKey] || error.message;

    const toast = document.createElement('div');
    const bgColor = '#ef4444';
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: ${bgColor};
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      z-index: 9999;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      animation: slideUp 0.3s ease-out;
      max-width: 90%;
      word-wrap: break-word;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  } catch (e) {
    console.warn('Failed to show AniList search error:', e);
  }
}
