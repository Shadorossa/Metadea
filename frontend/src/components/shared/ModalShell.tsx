// One dialog shell for the app's overlay modals: role="dialog" + aria-modal
// + aria-label, Escape-to-close, a Tab/Shift+Tab focus trap, initial focus,
// body scroll lock and focus restore to whatever was focused before the
// modal opened. Each modal keeps its own class names and markup — the shell
// only owns the overlay/panel pair and the keyboard behaviour around it.
//
// Nested modals (an editor that opens a search popup, a PR editor that opens
// the image cropper in its own React root) register on a module-level stack
// so Escape and the focus trap only ever act on the topmost one.
//
// The Tab trap covers the whole overlay, not just the panel: the proposal
// session editors keep their tab strip (`renderPanel`) and unsaved-changes
// toast (`overlayChildren`) inside the overlay but outside the panel, and
// both must stay reachable from the keyboard. For every other modal the
// overlay's only child is the panel, so the two scopes are the same.
//
// The focus-order and stack helpers are plain functions (no DOM types
// required) so they can be unit-tested under Vitest's node environment.
import { useEffect, useRef, type ElementType, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// ── Pure helpers ──────────────────────────────────────────────────────────────

export const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export interface FocusableCandidate {
  disabled?: boolean;
  getClientRects?(): ArrayLike<unknown>;
}

export interface FocusableRoot<T> {
  querySelectorAll(selectors: string): ArrayLike<T>;
}

// Rendered-in-layout check (what jQuery's :visible does) — display:none
// subtrees have no client rects, position:fixed ones still do (unlike the
// offsetParent trick). Elements without getClientRects (test doubles) pass.
function isRendered(el: FocusableCandidate): boolean {
  return typeof el.getClientRects !== 'function' || el.getClientRects().length > 0;
}

/** Focusable descendants of `root` in DOM order, skipping disabled and
 *  non-rendered ones. */
export function getFocusable<T extends FocusableCandidate>(
  root: FocusableRoot<T>,
  isVisible: (el: T) => boolean = isRendered,
): T[] {
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter(el => !el.disabled && isVisible(el));
}

/** Where a Tab / Shift+Tab press should land to stay inside the panel.
 *  Returns the element to focus, or null when the browser's default move is
 *  already correct (the active element is strictly inside the cycle).
 *  `activeInsidePanel` is for an active element that lives in the panel but
 *  is not in `focusables` (e.g. a tabindex="-1" child): the default move is
 *  kept, and the next press from the cycle's end wraps as usual. */
export function resolveTabTarget<T>(
  focusables: readonly T[],
  active: T | null,
  shift: boolean,
  activeInsidePanel = false,
): T | null {
  if (focusables.length === 0) return null;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const index = active === null ? -1 : focusables.indexOf(active);
  if (index === -1) return activeInsidePanel ? null : (shift ? last : first);
  if (shift && index === 0) return last;
  if (!shift && index === focusables.length - 1) return first;
  return null;
}

export interface ModalStack<T> {
  push(token: T): void;
  remove(token: T): void;
  isTop(token: T): boolean;
  readonly size: number;
}

export function createModalStack<T>(): ModalStack<T> {
  const items: T[] = [];
  const remove = (token: T) => {
    const index = items.indexOf(token);
    if (index !== -1) items.splice(index, 1);
  };
  return {
    push(token) { remove(token); items.push(token); },
    remove,
    isTop(token) { return items.length > 0 && items[items.length - 1] === token; },
    get size() { return items.length; },
  };
}

export const modalStack = createModalStack<object>();

// ── Component ─────────────────────────────────────────────────────────────────

type ShellElementProps = Record<string, unknown> & {
  onClick?: (e: MouseEvent<HTMLElement>) => void;
};

export interface ModalShellProps {
  open?: boolean;
  /** false for a modal that stays mounted but is not the one the user is in
   *  — a backgrounded proposal-session tab hidden with display:none. It
   *  keeps its DOM (and its children's state) but leaves the stack, so
   *  Escape/Tab go to the visible editor instead. */
  active?: boolean;
  onClose: () => void;
  /** aria-label — the translated title the modal already shows. */
  label: string;
  overlayClassName?: string;
  panelClassName?: string;
  children: ReactNode;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  /** createPortal to document.body (default) or render in place. */
  portal?: boolean;
  /** false renders the panel alone, with no overlay element around it — for
   *  a modal that is itself the full-screen surface (the comic reader). */
  overlay?: boolean;
  /** Wraps the panel element inside the overlay (the proposal session's tab
   *  strip + prev/next arrows around the editor panel). */
  renderPanel?: (panel: ReactNode) => ReactNode;
  /** Rendered inside the overlay after the (wrapped) panel — an unsaved
   *  changes toast, a side panel, nested popups. */
  overlayChildren?: ReactNode;
  /** Element/component for the overlay and panel — e.g. motion.div to keep a
   *  modal's enter/exit animation — plus any extra props for them. */
  overlayComponent?: ElementType;
  overlayProps?: ShellElementProps;
  panelComponent?: ElementType;
  panelProps?: ShellElementProps;
  /** Whether a click inside the panel stops bubbling to the overlay (the
   *  usual `onClick={e => e.stopPropagation()}`). A `panelProps.onClick`
   *  replaces this default entirely. */
  stopPanelPropagation?: boolean;
}

let previousBodyOverflow = '';

export function ModalShell({
  open = true,
  active = true,
  onClose,
  label,
  overlayClassName,
  panelClassName,
  children,
  closeOnBackdrop = true,
  closeOnEscape = true,
  portal = true,
  overlay = true,
  renderPanel,
  overlayChildren,
  overlayComponent: Overlay = 'div',
  overlayProps,
  panelComponent: Panel = 'div',
  panelProps,
  stopPanelPropagation = true,
}: ModalShellProps) {
  const overlayRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const tokenRef = useRef<object>({});
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const live = open && active;

  // Stack registration, scroll lock, initial focus and focus restore.
  useEffect(() => {
    if (!live) return;
    const token = tokenRef.current;
    modalStack.push(token);
    if (modalStack.size === 1) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    const previouslyFocused = document.activeElement;
    const panel = panelRef.current;
    if (panel) (getFocusable<HTMLElement>(panel)[0] ?? panel).focus();
    return () => {
      modalStack.remove(token);
      if (modalStack.size === 0) document.body.style.overflow = previousBodyOverflow;
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) previouslyFocused.focus();
    };
  }, [live]);

  // Escape + Tab cycling, only while this shell is the topmost one.
  useEffect(() => {
    if (!live) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel || !modalStack.isTop(tokenRef.current)) return;
      const trapRoot = overlayRef.current ?? panel;

      if (e.key === 'Escape') {
        // defaultPrevented: a control inside already consumed Escape (e.g.
        // dismissing its own suggestion list). Nested dialog: a non-shell
        // dialog inside the panel owns its own Escape.
        if (!closeOnEscape || e.defaultPrevented) return;
        const target = e.target instanceof Element ? e.target : null;
        const nearestDialog = target?.closest('[role="dialog"], dialog') ?? null;
        if (nearestDialog && nearestDialog !== panel) return;
        onCloseRef.current();
        return;
      }

      if (e.key === 'Tab') {
        const focusables = getFocusable<HTMLElement>(trapRoot);
        if (focusables.length === 0) {
          e.preventDefault();
          panel.focus();
          return;
        }
        const activeEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const activeInsidePanel = activeEl !== null && activeEl !== panel && trapRoot.contains(activeEl);
        const next = resolveTabTarget(focusables, activeEl, e.shiftKey, activeInsidePanel);
        if (next) {
          e.preventDefault();
          next.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [live, closeOnEscape]);

  if (!open) return null;

  const handleOverlayClick = (e: MouseEvent<HTMLElement>) => {
    overlayProps?.onClick?.(e);
    if (closeOnBackdrop && e.target === e.currentTarget) onClose();
  };
  const handlePanelClick = panelProps?.onClick
    ?? (stopPanelPropagation ? (e: MouseEvent<HTMLElement>) => e.stopPropagation() : undefined);

  const panel = (
    <Panel
      {...panelProps}
      ref={panelRef}
      className={panelClassName || undefined}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      onClick={handlePanelClick}
    >
      {children}
    </Panel>
  );

  const content = overlay ? (
    <Overlay {...overlayProps} ref={overlayRef} className={overlayClassName || undefined} onClick={handleOverlayClick}>
      {renderPanel ? renderPanel(panel) : panel}
      {overlayChildren}
    </Overlay>
  ) : panel;

  if (!portal) return content;
  return typeof document !== 'undefined' ? createPortal(content, document.body) : null;
}
