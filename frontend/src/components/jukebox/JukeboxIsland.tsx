import { useEffect, useRef } from 'react';
import { Disc3 } from 'lucide-react';
import { getT } from '../../i18n/runtime';
import { useExternalStore } from '../shared/hooks/useExternalStore';
import { useHydrated } from '../shared/hooks/useHydrated';
import { jukeboxStore } from '../../lib/jukebox/jukebox-store';
import { closeStrip, initJukebox, toggleStrip } from '../../lib/jukebox/jukebox-engine';
import { playerModalStore } from '../../lib/player/player-modal-state';
import { playbackStore } from '../../lib/local/playback-service';
import { JukeboxStrip } from './JukeboxStrip';

// The jukebox's fixed bottom-right icon and the strip it opens. Mounted
// once in BaseLayout with transition:persist, like NowPlayingBar: the audio
// element and the queue live in lib/jukebox and outlive any page. Hidden
// while the built-in player modal or a media-page theme overlay owns the
// screen; nudged up while a now-playing bar sits along the bottom edge.
export function JukeboxIsland() {
  const t = getT().jukebox;
  const state = useExternalStore(jukeboxStore);
  const playerModalOpen = useExternalStore(playerModalStore);
  const playback = useExternalStore(playbackStore);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Labels come from the client-resolved locale; the server renders English.
  // The button is position:fixed, so appearing after hydration shifts nothing.
  const hydrated = useHydrated();

  useEffect(() => {
    initJukebox().catch(console.error);
  }, []);

  // Escape or a click anywhere else closes the strip; playback carries on.
  useEffect(() => {
    if (!state.stripOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeStrip();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) closeStrip();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [state.stripOpen]);

  if (!hydrated || playerModalOpen || state.overlayActive) return null;

  const playing = state.status === 'playing';
  const raised = !!playback;

  return (
    <div ref={rootRef} className={`jukebox${raised ? ' jukebox--raised' : ''}${state.stripOpen ? ' jukebox--open' : ''}`}>
      {state.stripOpen && <JukeboxStrip state={state} t={t} />}
      <button
        type="button"
        className={`jukebox-toggle${playing ? ' jukebox-toggle--playing' : ''}${state.stripOpen ? ' jukebox-toggle--open' : ''}`}
        aria-label={state.stripOpen ? t.close : t.open}
        aria-expanded={state.stripOpen}
        aria-controls="jukebox-strip"
        title={state.stripOpen ? t.close : t.open}
        onClick={toggleStrip}
      >
        <Disc3 size={22} strokeWidth={1.8} className="jukebox-toggle-disc" />
        {playing && <span className="jukebox-toggle-indicator" role="img" aria-label={t.playing_indicator} />}
      </button>
    </div>
  );
}
