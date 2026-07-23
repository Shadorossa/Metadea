// Shared save+toast wrapper for every settings field that autosaves —
// display-name.ts, bio.ts, custom-color.ts, fonts.ts and rating-system.ts
// used to each hand-roll their own copy of this, debounce dance included.
// One consistent "Cambios guardados" confirmation, one place to fix the flow.

export type ShowToast = (msg?: string) => void;

// errorLogPrefix stays per-field for the console; the toasted message is
// intentionally generic since which field failed isn't actionable for the user.
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

// Debounced variant for text inputs/color pickers — waits `delayMs` after the
// last trigger() before saving. flushNow (wire to blur/Enter) also clears any
// pending timer, so an immediate confirm can't double-save/double-toast later.
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
