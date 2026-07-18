// Shared save+toast wrapper for every settings field that autosaves —
// display-name.ts, bio.ts, custom-color.ts, fonts.ts and rating-system.ts
// used to each hand-roll their own copy of "try the save, toast a
// per-field success string, console.error + toast a per-field failure
// string" (the debounced ones also duplicated the setTimeout/clearTimeout
// dance verbatim). Centralized here so every field shows the same
// "Cambios guardados" confirmation (showToast() with no argument falls
// back to that i18n string — see settings.astro's own showToast) instead
// of a dozen slightly different success messages, and so a fix to the
// save/error flow only needs to happen once.

export type ShowToast = (msg?: string) => void;

// Runs `saveFn`, toasts the shared "Cambios guardados" message on success,
// or logs + toasts a failure message. errorLogPrefix stays per-field (it's
// developer-facing, in the console) so a failure is still traceable to
// which field broke; the user-facing text is intentionally generic since
// "could not save your bio" vs. "could not save your color" isn't
// actionable information for them either way.
export async function runSave(
  saveFn: () => Promise<void>,
  showToast: ShowToast,
  errorLogPrefix: string,
): Promise<void> {
  try {
    await saveFn();
    showToast();
  } catch (err) {
    console.error(errorLogPrefix, err);
    showToast('Error al guardar los cambios');
  }
}

// Debounced variant for text inputs/color pickers, where saving on every
// single keystroke/drag tick would be wasteful — waits `delayMs` after the
// last trigger() call before actually running the save. Returns both the
// debounced trigger (wire to 'input'/'change') and flushNow (wire to
// 'blur'/Enter-to-confirm) so an immediate confirmation doesn't leave a
// stale pending timer to *also* fire moments later — display-name.ts used
// to have exactly that double-save/double-toast risk before this existed.
export function debouncedSave(
  delayMs: number,
  saveFn: () => Promise<void>,
  showToast: ShowToast,
  errorLogPrefix: string,
): { trigger: () => void; flushNow: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flushNow = () => {
    if (timer) { clearTimeout(timer); timer = undefined; }
    runSave(saveFn, showToast, errorLogPrefix);
  };

  const trigger = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; runSave(saveFn, showToast, errorLogPrefix); }, delayMs);
  };

  return { trigger, flushNow };
}
