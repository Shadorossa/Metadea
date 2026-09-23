import { useEffect } from 'react';

// The "listen for Escape on document/window while some condition holds, then
// run a callback" shape was independently copy-pasted in ListsSection.tsx
// (settings menu), QuickSearchOverlay.tsx, RelationTypeSelect.tsx and
// RichTextEditor.tsx (context menu) — all four just register/unregister a
// keydown listener that checks e.key === 'Escape'. Callers with extra
// Escape-adjacent logic (branching on other state, or Escape sharing an
// onKeyDown with Enter/arrow keys on a specific input) are left as their own
// inline handlers rather than forced into this.
export function useEscapeKey(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onEscape(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, onEscape]);
}
