// Small, framework-free user preferences read directly from localStorage —
// shared between the settings page (writer) and any consumer that needs to
// read them without importing the whole settings UI (e.g. search providers).

const ADULT_CONTENT_KEY = 'metadea_show_adult_content';

export function isAdultContentEnabled(): boolean {
  return localStorage.getItem(ADULT_CONTENT_KEY) === 'true';
}

export function setAdultContentEnabled(enabled: boolean): void {
  localStorage.setItem(ADULT_CONTENT_KEY, enabled.toString());
}
