import { STORAGE_KEYS } from '../shared/storage-keys';

const COVER_PREFERENCES_KEY = STORAGE_KEYS.mediaCoverPreferences;

type CoverPreferences = Record<string, string>;

function readPreferences(): CoverPreferences {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(COVER_PREFERENCES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed as CoverPreferences : {};
  } catch {
    return {};
  }
}

export function getCoverPreference(workExternalId: string): string | null {
  const value = readPreferences()[workExternalId];
  return value && /^(?:https?:|asset:|data:)/.test(value) ? value : null;
}

export function getPreferredCover(workExternalId: string, fallback: string | null | undefined): string | null {
  return getCoverPreference(workExternalId) || fallback || null;
}

export function setCoverPreference(workExternalId: string, coverUrl: string, aliases: string[] = []): void {
  const preferences = readPreferences();
  for (const id of new Set([workExternalId, ...aliases])) preferences[id] = coverUrl;
  try {
    localStorage.setItem(COVER_PREFERENCES_KEY, JSON.stringify(preferences));
    window.dispatchEvent(new CustomEvent('media-cover-preference-changed', {
      detail: { workExternalId, coverUrl },
    }));
    window.dispatchEvent(new Event('refresh-profile-library'));
  } catch {
    // A non-persistent webview storage must not prevent the editor from saving.
  }
}
