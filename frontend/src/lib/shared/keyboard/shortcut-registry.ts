// App-wide keyboard shortcut registry — React-free and DOM-free so it is
// unit-testable under Vitest's node environment (see shortcut-registry.test.ts).
//
// Contexts stack by priority (global < page < modal < player). A context is
// active while at least one registration is alive in it; the dispatcher walks
// active contexts from the highest priority down and the first binding whose
// combo matches wins, so a modal's 'arrowdown' shadows a page's, and a
// player's 'f' shadows a media page's. A binding whose `when` predicate says
// no (or that would fire from an editable field without `allowInInputs`)
// does not shadow — the walk continues into the contexts below.
//
// One window keydown listener (installShortcutDispatcher) feeds the default
// registry; React components register through components/shared/hooks/
// useShortcuts, and the shortcut sheet reads listActiveShortcuts().
import { createExternalStore, type ExternalStore } from '../state/external-store';
import { matchesShortcut, parseShortcut, type ParsedShortcut, type ShortcutKeyInput, type ShortcutPlatform } from './shortcut-keys';

export type ShortcutContext = 'global' | 'page' | 'modal' | 'player';

/** Ascending priority. */
export const SHORTCUT_CONTEXTS: readonly ShortcutContext[] = ['global', 'page', 'modal', 'player'];

export interface ShortcutEvent extends ShortcutKeyInput {
  target?: unknown;
  defaultPrevented?: boolean;
  preventDefault(): void;
}

export interface ShortcutBinding {
  /** Stable, namespaced id — 'global.open_quick_search', 'library.focus_search'. */
  id: string;
  /** One combo or several alternatives: 'mod+k', ['mod+k', '/']. */
  keys: string | readonly string[];
  /** i18n key under the `shortcuts` namespace (e.g. 'shortcuts.open_quick_search'). */
  description: string;
  /** Skips (and does not shadow) when it returns false. */
  when?: () => boolean;
  handler: (event: ShortcutEvent) => void;
  /** Fire even when focus is in input/textarea/select/[contenteditable]. */
  allowInInputs?: boolean;
}

export interface ActiveShortcut {
  context: ShortcutContext;
  id: string;
  keys: string[];
  description: string;
  /** `when()` result at listing time. */
  enabled: boolean;
  allowInInputs: boolean;
}

export interface ShortcutRegistry {
  platform: ShortcutPlatform;
  registerShortcuts(context: ShortcutContext, bindings: readonly ShortcutBinding[]): () => void;
  /** Returns true when a binding handled the event (preventDefault was called). */
  dispatch(event: ShortcutEvent): boolean;
  listActiveShortcuts(): ActiveShortcut[];
  /** Bumps on every register/unregister — subscribe to re-list. */
  version: ExternalStore<number>;
}

interface EditableCandidate {
  tagName?: string;
  isContentEditable?: boolean;
  closest?(selectors: string): unknown;
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** Default guard: text fields and contenteditable regions own their keys. */
export function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as EditableCandidate;
  if (el.tagName && EDITABLE_TAGS.has(el.tagName.toUpperCase())) return true;
  if (el.isContentEditable) return true;
  if (typeof el.closest === 'function' && el.closest('[contenteditable]:not([contenteditable="false"])')) return true;
  return false;
}

interface CompiledBinding {
  binding: ShortcutBinding;
  keys: string[];
  parsed: ParsedShortcut[];
}

interface Registration {
  context: ShortcutContext;
  bindings: CompiledBinding[];
}

export interface ShortcutRegistryOptions {
  platform: ShortcutPlatform;
  isEditable?: (target: unknown) => boolean;
}

export function createShortcutRegistry(options: ShortcutRegistryOptions): ShortcutRegistry {
  const { platform } = options;
  const isEditable = options.isEditable ?? isEditableTarget;
  const registrations: Registration[] = [];
  const version = createExternalStore(0);
  const bump = () => version.set(version.get() + 1);

  const compile = (binding: ShortcutBinding): CompiledBinding => {
    const keys = typeof binding.keys === 'string' ? [binding.keys] : [...binding.keys];
    return { binding, keys, parsed: keys.map(spec => parseShortcut(spec, platform)) };
  };

  // Highest priority first; within a context the latest registration first.
  const orderedRegistrations = (): Registration[] =>
    [...registrations].reverse().sort((a, b) => SHORTCUT_CONTEXTS.indexOf(b.context) - SHORTCUT_CONTEXTS.indexOf(a.context));

  return {
    platform,
    version,

    registerShortcuts(context, bindings) {
      const registration: Registration = { context, bindings: bindings.map(compile) };
      registrations.push(registration);
      bump();
      let alive = true;
      return () => {
        if (!alive) return;
        alive = false;
        const index = registrations.indexOf(registration);
        if (index !== -1) registrations.splice(index, 1);
        bump();
      };
    },

    dispatch(event) {
      if (event.defaultPrevented) return false;
      const editable = isEditable(event.target);
      for (const registration of orderedRegistrations()) {
        for (const compiled of registration.bindings) {
          if (!compiled.parsed.some(parsed => matchesShortcut(parsed, event))) continue;
          const { binding } = compiled;
          if (editable && !binding.allowInInputs) continue;
          if (binding.when && !binding.when()) continue;
          event.preventDefault();
          binding.handler(event);
          return true;
        }
      }
      return false;
    },

    listActiveShortcuts() {
      const out: ActiveShortcut[] = [];
      for (const registration of registrations) {
        for (const { binding, keys } of registration.bindings) {
          out.push({
            context: registration.context,
            id: binding.id,
            keys,
            description: binding.description,
            enabled: binding.when ? binding.when() : true,
            allowInInputs: !!binding.allowInInputs,
          });
        }
      }
      return out.sort((a, b) => SHORTCUT_CONTEXTS.indexOf(a.context) - SHORTCUT_CONTEXTS.indexOf(b.context));
    },
  };
}

export function detectShortcutPlatform(): ShortcutPlatform {
  if (typeof navigator === 'undefined') return { isMac: false };
  const hint = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`;
  return { isMac: /mac|iphone|ipad|ipod/i.test(hint) };
}

// ── Default app registry ──────────────────────────────────────────────────────

export const shortcutRegistry: ShortcutRegistry = createShortcutRegistry({ platform: detectShortcutPlatform() });

export function registerShortcuts(context: ShortcutContext, bindings: readonly ShortcutBinding[]): () => void {
  return shortcutRegistry.registerShortcuts(context, bindings);
}

export function listActiveShortcuts(): ActiveShortcut[] {
  return shortcutRegistry.listActiveShortcuts();
}

interface KeydownSource {
  addEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void): void;
  removeEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void): void;
}

let installedOn: KeydownSource | null = null;
let installedListener: ((event: KeyboardEvent) => void) | null = null;

/** Installs the single window keydown listener feeding the default registry.
 *  Idempotent: later calls are no-ops. Returns an uninstall function. */
export function installShortcutDispatcher(source?: KeydownSource): () => void {
  const target: KeydownSource | null = source ?? (typeof window !== 'undefined' ? (window as KeydownSource) : null);
  if (!target) return () => {};
  if (installedOn) return uninstallShortcutDispatcher;
  const listener = (event: KeyboardEvent) => {
    // A composition session (IME) owns every key until it commits.
    if (event.isComposing) return;
    shortcutRegistry.dispatch(event);
  };
  target.addEventListener('keydown', listener);
  installedOn = target;
  installedListener = listener;
  return uninstallShortcutDispatcher;
}

function uninstallShortcutDispatcher(): void {
  if (installedOn && installedListener) installedOn.removeEventListener('keydown', installedListener);
  installedOn = null;
  installedListener = null;
}
