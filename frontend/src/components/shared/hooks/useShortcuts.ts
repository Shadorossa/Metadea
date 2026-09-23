import { useEffect, useRef } from 'react';
import { registerShortcuts, type ShortcutBinding, type ShortcutContext } from '../../../lib/shared/keyboard/shortcut-registry';

// Registers `bindings` in `context` while the component is mounted (and
// `enabled`). Handlers and `when` predicates are read through a ref on every
// dispatch, so callers can pass fresh closures each render without the
// registration churning — it only re-registers when an id or combo changes,
// which keeps the sheet's listing and context shadowing stable.
export function useShortcuts(
  context: ShortcutContext,
  bindings: readonly ShortcutBinding[],
  options: { enabled?: boolean } = {},
): void {
  const enabled = options.enabled ?? true;
  const bindingsRef = useRef(bindings);
  useEffect(() => { bindingsRef.current = bindings; });

  const signature = bindings
    .map(b => `${b.id}=${typeof b.keys === 'string' ? b.keys : b.keys.join(',')}${b.allowInInputs ? '!' : ''}|${b.description}`)
    .join(';');

  useEffect(() => {
    if (!enabled || bindingsRef.current.length === 0) return;
    const latest = (id: string) => bindingsRef.current.find(b => b.id === id);
    const proxied: ShortcutBinding[] = bindingsRef.current.map(b => ({
      id: b.id,
      keys: b.keys,
      description: b.description,
      allowInInputs: b.allowInInputs,
      when: () => {
        const current = latest(b.id);
        return current ? (current.when ? current.when() : true) : false;
      },
      handler: event => latest(b.id)?.handler(event),
    }));
    return registerShortcuts(context, proxied);
  // `signature` stands in for `bindings` — see the note above.
  }, [context, enabled, signature]);
}
