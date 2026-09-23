import { createContext, useContext, useEffect, useRef } from 'react';
import type { BigPictureAction } from '../../lib/big-picture/gamepad';

// Big Picture routes every action (pad, keyboard) to ONE handler: the most
// recently mounted layer — the options sheet, the Start menu or the search
// on top of the browse view. Each layer registers while mounted.
export type LayerHandler = (action: BigPictureAction) => void;

export interface InputLayers {
  push(handler: LayerHandler): () => void;
  dispatch(action: BigPictureAction): boolean;
}

export function createInputLayers(): InputLayers {
  const stack: LayerHandler[] = [];
  return {
    push(handler) {
      stack.push(handler);
      return () => {
        const index = stack.lastIndexOf(handler);
        if (index !== -1) stack.splice(index, 1);
      };
    },
    dispatch(action) {
      const top = stack[stack.length - 1];
      if (!top) return false;
      top(action);
      return true;
    },
  };
}

export const InputLayerContext = createContext<InputLayers | null>(null);

export function useInputLayer(handler: LayerHandler): void {
  const layers = useContext(InputLayerContext);
  const latest = useRef(handler);
  useEffect(() => { latest.current = handler; });
  useEffect(() => {
    if (!layers) return;
    return layers.push(action => latest.current(action));
  }, [layers]);
}
