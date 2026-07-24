// Small, framework-free user preferences read directly from localStorage —
// shared between the settings page (writer) and any consumer that needs to
// read them without importing the whole settings UI (e.g. search providers).

import { STORAGE_KEYS } from '../shared/storage-keys';

export function isAdultContentEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEYS.showAdultContent) === 'true';
}

export function setAdultContentEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEYS.showAdultContent, enabled.toString());
}

export function isLibraryGroupByBundleEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEYS.libraryGroupByBundle) === 'true';
}

export function setLibraryGroupByBundleEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEYS.libraryGroupByBundle, enabled.toString());
}

export function isLibrarySubpagesByTypeEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEYS.librarySubpagesByType) === 'true';
}

export function setLibrarySubpagesByTypeEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEYS.librarySubpagesByType, enabled.toString());
}
