import { useCallback, useState } from 'react';

// Shared "play the CSS out-transition, then actually unmount" pattern used
// by every modal that fades/slides out instead of disappearing instantly —
// each one used to hardcode its own 180ms flag+setTimeout duplicate of this.
export const MODAL_CLOSE_TRANSITION_MS = 180;

export function useClosingTransition(onClose: () => void, ms = MODAL_CLOSE_TRANSITION_MS) {
  const [isClosing, setIsClosing] = useState(false);

  const close = useCallback(() => {
    setIsClosing(true);
    setTimeout(onClose, ms);
  }, [onClose, ms]);

  return { isClosing, close };
}
