import { STORAGE_KEYS } from '../storage/storage-keys';

const COVER_PREFERENCES_KEY = STORAGE_KEYS.mediaCoverPreferences;

export type CoverPreferences = Record<string, string>;

// One localStorage read + JSON.parse. Bulk callers (getAllCatalogEntries
// maps ~5k rows) must call this once and pass the result down, instead of
// letting every per-row lookup re-parse the same blob.
export function readCoverPreferences(): CoverPreferences {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(COVER_PREFERENCES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed as CoverPreferences : {};
  } catch {
    return {};
  }
}

export function getCoverPreference(workExternalId: string, preferences: CoverPreferences = readCoverPreferences()): string | null {
  const value = preferences[workExternalId];
  return value && /^(?:https?:|asset:|data:)/.test(value) ? value : null;
}

export function getPreferredCover(
  workExternalId: string,
  fallback: string | null | undefined,
  preferences?: CoverPreferences,
): string | null {
  return getCoverPreference(workExternalId, preferences) || fallback || null;
}

export function setCoverPreference(workExternalId: string, coverUrl: string, aliases: string[] = []): void {
  const preferences = readCoverPreferences();
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
