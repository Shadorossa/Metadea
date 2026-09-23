import { lazy, Suspense, useEffect } from 'react';
import { useExternalStore } from '../shared/hooks/useExternalStore';
import { useShortcuts } from '../shared/hooks/useShortcuts';
import { useGamepadGuideWatcher } from './hooks/useGamepad';
import { bigPictureStore, openBigPicture, closeBigPicture, toggleBigPicture } from '../../lib/big-picture/big-picture-state';
import { BIG_PICTURE_START_PARAM } from '../../lib/big-picture/big-picture-preferences';
import { hasConnectedGamepad } from '../../lib/big-picture/gamepad';
import { gamePauseOpenStore } from '../../lib/game-pause/game-pause-state';
import type { CategoryId } from '../../lib/local/platforms';
import type { BigPictureData } from './hooks/useBigPictureItems';

// The overlay (and everything it pulls in) loads on first open only.
const BigPictureOverlay = lazy(() => import('./BigPictureOverlay'));

/** Big Picture's A on a work: open it through Local's own resume path. */
export interface BigPictureResumeRequest {
  category: CategoryId;
  externalId: string;
}

interface BigPictureModeProps {
  data: BigPictureData;
  onResume: (request: BigPictureResumeRequest) => void;
}

// Always mounted with the Local page: owns the entry points (mod+shift+B,
// the gamepad Guide / held Start+Select, ?bigpicture= from "Start in Big
// Picture mode") and mounts the overlay while the mode is on.
export function BigPictureMode({ data, onResume }: BigPictureModeProps) {
  const open = useExternalStore(bigPictureStore);

  useShortcuts('page', [{
    id: 'local.big_picture',
    keys: 'mod+shift+b',
    description: 'shortcuts.big_picture_toggle',
    allowInInputs: true,
    handler: toggleBigPicture,
  }]);

  // Not while the controller pause menu is up: the Select+Start that
  // opened it may still be held.
  const gamePaused = useExternalStore(gamePauseOpenStore);
  useGamepadGuideWatcher(!open && !gamePaused, openBigPicture);

  // ?bigpicture=on|pad (set by the app's entry page, see
  // bigPictureStartPath): open now, or once a controller shows up during
  // this visit. The parameter is consumed so a reload does not re-trigger.
  useEffect(() => {
    const url = new URL(window.location.href);
    const mode = url.searchParams.get(BIG_PICTURE_START_PARAM);
    if (!mode) return;
    url.searchParams.delete(BIG_PICTURE_START_PARAM);
    history.replaceState(history.state, '', url.toString());
    if (mode !== 'pad' || hasConnectedGamepad()) { openBigPicture(); return; }
    const onConnect = () => openBigPicture();
    window.addEventListener('gamepadconnected', onConnect, { once: true });
    return () => window.removeEventListener('gamepadconnected', onConnect);
  }, []);

  // Leaving the Local page (Astro navigation) must not leave the store on.
  useEffect(() => () => closeBigPicture(), []);

  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <BigPictureOverlay data={data} onResume={onResume} onExit={closeBigPicture} />
    </Suspense>
  );
}
