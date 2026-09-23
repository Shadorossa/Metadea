// Gamepad fallback for any other dialog opened on top of Big Picture (the
// media editor from the X menu, a confirmation…): the D-pad walks the
// topmost dialog's focusable controls in DOM order, A clicks the focused
// one and B sends Escape, which every ModalShell already closes on.
import type { BigPictureAction } from './gamepad';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function topmostDialog(exclude: Element | null): HTMLElement | null {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
    .filter(dialog => dialog !== exclude && !exclude?.contains(dialog));
  return dialogs[dialogs.length - 1] ?? null;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter(el => !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0);
}

/** Handles `action` inside the topmost dialog other than `bigPictureRoot`;
 *  false when there is no such dialog. */
export function navigateForeignDialog(action: BigPictureAction, bigPictureRoot: Element | null): boolean {
  if (typeof document === 'undefined') return false;
  const dialog = topmostDialog(bigPictureRoot);
  if (!dialog) return false;
  if (action === 'back') {
    const target = document.activeElement instanceof HTMLElement && dialog.contains(document.activeElement)
      ? document.activeElement
      : dialog;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    return true;
  }
  if (action === 'confirm') {
    const active = document.activeElement;
    if (active instanceof HTMLElement && dialog.contains(active) && active !== dialog) active.click();
    return true;
  }
  const step = action === 'down' || action === 'right' ? 1 : action === 'up' || action === 'left' ? -1 : 0;
  if (step === 0) return true;
  const list = focusables(dialog);
  if (list.length === 0) return true;
  const index = list.indexOf(document.activeElement as HTMLElement);
  const next = index === -1 ? (step > 0 ? 0 : list.length - 1) : (index + step + list.length) % list.length;
  list[next].focus();
  return true;
}
