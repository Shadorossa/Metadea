import { getLangCode, getT } from '../../i18n/runtime';
import { applyDocumentTranslations } from './apply-translations';
import { I18N_PENDING_CLASS } from './locale-bootstrap';

/** Re-translates every `data-i18n*` element and reveals the page. */
export function translateDocument(): void {
  try {
    applyDocumentTranslations(document, getT(), getLangCode());
  } finally {
    document.documentElement.classList.remove(I18N_PENDING_CLASS);
  }
}

let swapListenerRegistered = false;

/**
 * Translates now and after every Astro view-transition swap. `astro:after-swap`
 * fires before the new page is revealed, so swapped-in markup (rendered in the
 * build locale) never shows untranslated.
 */
export function registerDocumentTranslation(): void {
  translateDocument();
  if (swapListenerRegistered) return;
  swapListenerRegistered = true;
  document.addEventListener('astro:after-swap', translateDocument);
}
