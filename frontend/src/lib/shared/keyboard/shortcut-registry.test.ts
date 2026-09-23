import { describe, it, expect, vi } from 'vitest';
import { createShortcutRegistry, installShortcutDispatcher, isEditableTarget, shortcutRegistry, type ShortcutEvent } from './shortcut-registry';

function keyEvent(key: string, extra: Partial<ShortcutEvent> = {}): ShortcutEvent & { prevented: boolean } {
  const event = {
    key,
    prevented: false,
    preventDefault() { event.prevented = true; },
    ...extra,
  } as ShortcutEvent & { prevented: boolean };
  return event;
}

const registry = () => createShortcutRegistry({ platform: { isMac: false } });

describe('registerShortcuts / dispatch', () => {
  it('runs the matching handler and prevents default', () => {
    const r = registry();
    const handler = vi.fn();
    r.registerShortcuts('global', [{ id: 'a', keys: 'mod+k', description: 'shortcuts.a', handler }]);
    const event = keyEvent('k', { ctrlKey: true });
    expect(r.dispatch(event)).toBe(true);
    expect(handler).toHaveBeenCalledWith(event);
    expect(event.prevented).toBe(true);
  });

  it('returns false and leaves default alone when nothing matches', () => {
    const r = registry();
    r.registerShortcuts('global', [{ id: 'a', keys: 'mod+k', description: 'shortcuts.a', handler: vi.fn() }]);
    const event = keyEvent('j', { ctrlKey: true });
    expect(r.dispatch(event)).toBe(false);
    expect(event.prevented).toBe(false);
  });

  it('accepts several alternative combos for one binding', () => {
    const r = registry();
    const handler = vi.fn();
    r.registerShortcuts('global', [{ id: 'a', keys: ['mod+k', '/'], description: 'shortcuts.a', handler }]);
    r.dispatch(keyEvent('/'));
    r.dispatch(keyEvent('k', { ctrlKey: true }));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('skips events another listener already consumed', () => {
    const r = registry();
    const handler = vi.fn();
    r.registerShortcuts('global', [{ id: 'a', keys: '/', description: 'shortcuts.a', handler }]);
    expect(r.dispatch(keyEvent('/', { defaultPrevented: true }))).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('stops dispatching after unregister, and unregister is idempotent', () => {
    const r = registry();
    const handler = vi.fn();
    const unregister = r.registerShortcuts('page', [{ id: 'a', keys: 'f', description: 'shortcuts.a', handler }]);
    expect(r.dispatch(keyEvent('f'))).toBe(true);
    unregister();
    unregister();
    expect(r.dispatch(keyEvent('f'))).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(r.listActiveShortcuts()).toEqual([]);
  });

  it('bumps the version store on register and unregister', () => {
    const r = registry();
    const listener = vi.fn();
    r.version.subscribe(listener);
    const unregister = r.registerShortcuts('page', [{ id: 'a', keys: 'f', description: 'shortcuts.a', handler: vi.fn() }]);
    unregister();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(r.version.get()).toBe(2);
  });
});

describe('context shadowing', () => {
  it('a higher-priority context shadows the same combo below it', () => {
    const r = registry();
    const pageHandler = vi.fn();
    const modalHandler = vi.fn();
    r.registerShortcuts('page', [{ id: 'page.down', keys: 'arrowdown', description: 'shortcuts.p', handler: pageHandler }]);
    const unregisterModal = r.registerShortcuts('modal', [{ id: 'modal.down', keys: 'arrowdown', description: 'shortcuts.m', handler: modalHandler }]);
    r.dispatch(keyEvent('ArrowDown'));
    expect(modalHandler).toHaveBeenCalledTimes(1);
    expect(pageHandler).not.toHaveBeenCalled();

    unregisterModal();
    r.dispatch(keyEvent('ArrowDown'));
    expect(pageHandler).toHaveBeenCalledTimes(1);
  });

  it('player outranks modal outranks page outranks global regardless of registration order', () => {
    const r = registry();
    const calls: string[] = [];
    for (const context of ['player', 'global', 'modal', 'page'] as const) {
      r.registerShortcuts(context, [{ id: context, keys: 'f', description: 'shortcuts.f', handler: () => calls.push(context) }]);
    }
    r.dispatch(keyEvent('f'));
    expect(calls).toEqual(['player']);
  });

  it('within one context the latest registration wins', () => {
    const r = registry();
    const first = vi.fn();
    const second = vi.fn();
    r.registerShortcuts('page', [{ id: 'first', keys: 'f', description: 'shortcuts.f', handler: first }]);
    r.registerShortcuts('page', [{ id: 'second', keys: 'f', description: 'shortcuts.f', handler: second }]);
    r.dispatch(keyEvent('f'));
    expect(second).toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
  });
});

describe('when predicates', () => {
  it('a binding whose when() is false neither fires nor shadows', () => {
    const r = registry();
    const globalHandler = vi.fn();
    const modalHandler = vi.fn();
    let modalEnabled = false;
    r.registerShortcuts('global', [{ id: 'g', keys: 'enter', description: 'shortcuts.g', handler: globalHandler }]);
    r.registerShortcuts('modal', [{ id: 'm', keys: 'enter', description: 'shortcuts.m', when: () => modalEnabled, handler: modalHandler }]);

    r.dispatch(keyEvent('Enter'));
    expect(globalHandler).toHaveBeenCalledTimes(1);
    expect(modalHandler).not.toHaveBeenCalled();

    modalEnabled = true;
    r.dispatch(keyEvent('Enter'));
    expect(modalHandler).toHaveBeenCalledTimes(1);
    expect(globalHandler).toHaveBeenCalledTimes(1);
  });

  it('listActiveShortcuts reports the current when() result', () => {
    const r = registry();
    let enabled = false;
    r.registerShortcuts('page', [{ id: 'p', keys: 'e', description: 'shortcuts.e', when: () => enabled, handler: vi.fn() }]);
    expect(r.listActiveShortcuts()[0].enabled).toBe(false);
    enabled = true;
    expect(r.listActiveShortcuts()[0].enabled).toBe(true);
  });
});

describe('input-field guard', () => {
  it('ignores events from editable targets unless allowInInputs is set', () => {
    const r = registry();
    const plain = vi.fn();
    const allowed = vi.fn();
    r.registerShortcuts('global', [
      { id: 'plain', keys: '/', description: 'shortcuts.plain', handler: plain },
      { id: 'allowed', keys: 'arrowdown', description: 'shortcuts.allowed', handler: allowed, allowInInputs: true },
    ]);
    const input = { tagName: 'INPUT' };
    expect(r.dispatch(keyEvent('/', { target: input }))).toBe(false);
    expect(plain).not.toHaveBeenCalled();
    expect(r.dispatch(keyEvent('ArrowDown', { target: input }))).toBe(true);
    expect(allowed).toHaveBeenCalled();
    expect(r.dispatch(keyEvent('/', { target: { tagName: 'BUTTON' } }))).toBe(true);
  });

  it('a guarded binding above does not shadow an allowInInputs one below', () => {
    const r = registry();
    const below = vi.fn();
    r.registerShortcuts('global', [{ id: 'below', keys: 'escape', description: 'shortcuts.b', handler: below, allowInInputs: true }]);
    r.registerShortcuts('modal', [{ id: 'above', keys: 'escape', description: 'shortcuts.a', handler: vi.fn() }]);
    r.dispatch(keyEvent('Escape', { target: { tagName: 'TEXTAREA' } }));
    expect(below).toHaveBeenCalled();
  });

  it('isEditableTarget recognises inputs, textareas, selects and contenteditable', () => {
    expect(isEditableTarget({ tagName: 'input' })).toBe(true);
    expect(isEditableTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isEditableTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isEditableTarget({ tagName: 'SPAN', closest: () => ({}) })).toBe(true);
    expect(isEditableTarget({ tagName: 'SPAN', closest: () => null })).toBe(false);
    expect(isEditableTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('listActiveShortcuts', () => {
  it('lists every live binding grouped by ascending context priority', () => {
    const r = registry();
    r.registerShortcuts('modal', [{ id: 'm', keys: 'enter', description: 'shortcuts.m', handler: vi.fn() }]);
    r.registerShortcuts('global', [{ id: 'g', keys: ['mod+k', '/'], description: 'shortcuts.g', handler: vi.fn(), allowInInputs: true }]);
    expect(r.listActiveShortcuts()).toEqual([
      { context: 'global', id: 'g', keys: ['mod+k', '/'], description: 'shortcuts.g', enabled: true, allowInInputs: true },
      { context: 'modal', id: 'm', keys: ['enter'], description: 'shortcuts.m', enabled: true, allowInInputs: false },
    ]);
  });
});

describe('installShortcutDispatcher', () => {
  it('installs a single keydown listener and feeds the default registry', () => {
    const listeners = new Set<(event: KeyboardEvent) => void>();
    const source = {
      addEventListener: (_type: 'keydown', listener: (event: KeyboardEvent) => void) => { listeners.add(listener); },
      removeEventListener: (_type: 'keydown', listener: (event: KeyboardEvent) => void) => { listeners.delete(listener); },
    };
    const uninstall = installShortcutDispatcher(source);
    installShortcutDispatcher(source);
    expect(listeners.size).toBe(1);

    const handler = vi.fn();
    const unregister = shortcutRegistry.registerShortcuts('global', [{ id: 't', keys: 'mod+k', description: 'shortcuts.t', handler }]);
    const event = keyEvent('k', { ctrlKey: !shortcutRegistry.platform.isMac, metaKey: shortcutRegistry.platform.isMac });
    for (const listener of listeners) listener(event as unknown as KeyboardEvent);
    expect(handler).toHaveBeenCalledTimes(1);

    const composing = keyEvent('k', { ctrlKey: !shortcutRegistry.platform.isMac, metaKey: shortcutRegistry.platform.isMac });
    (composing as unknown as { isComposing: boolean }).isComposing = true;
    for (const listener of listeners) listener(composing as unknown as KeyboardEvent);
    expect(handler).toHaveBeenCalledTimes(1);

    unregister();
    uninstall();
    expect(listeners.size).toBe(0);
  });
});
