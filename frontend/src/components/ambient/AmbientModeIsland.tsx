import { lazy, Suspense, useEffect, useState } from 'react';
import { installAmbientWatcher } from '../../lib/ambient/ambient-watcher';
import { ambientActiveStore } from '../../lib/ambient/ambient-state';
import { useAmbientInputGuard } from './hooks/useAmbientInputGuard';

// The screensaver (and its CSS) loads the first time it starts.
const AmbientScreensaver = lazy(() => import('./AmbientScreensaver'));

// Matches the fade-out in ambient.css.
const EXIT_FADE_MS = 700;

type Phase = 'off' | 'on' | 'leaving';

// Ambient TV mode: mounted once in BaseLayout with transition:persist. Owns
// the idle watcher (lib/ambient/ambient-watcher.ts) and mounts the
// screensaver while it is up — and for its fade-out, during which input is
// still swallowed so the gesture that closed it can't click the page below.
export function AmbientModeIsland() {
  const [phase, setPhase] = useState<Phase>('off');

  useEffect(() => installAmbientWatcher(), []);

  useEffect(() => ambientActiveStore.subscribe(() => {
    if (ambientActiveStore.get()) setPhase('on');
    else setPhase(previous => (previous === 'off' ? 'off' : 'leaving'));
  }), []);

  useEffect(() => {
    if (phase !== 'leaving') return;
    const timer = window.setTimeout(() => setPhase('off'), EXIT_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useAmbientInputGuard(phase !== 'off');

  if (phase === 'off') return null;
  return (
    <Suspense fallback={null}>
      <AmbientScreensaver leaving={phase === 'leaving'} />
    </Suspense>
  );
}
