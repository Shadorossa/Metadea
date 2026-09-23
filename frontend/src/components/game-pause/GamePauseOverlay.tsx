import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ModalShell } from '../shared/ModalShell';
import { useExternalStore } from '../shared/hooks/useExternalStore';
import { useGamepadFrameLoop } from '../big-picture/hooks/useGamepad';
import { navigateForeignDialog } from '../../lib/big-picture/dialog-pad-navigation';
import { bigPictureStore } from '../../lib/big-picture/big-picture-state';
import { gamePauseOpenStore } from '../../lib/game-pause/game-pause-state';
import { formatSessionTime, pathAfterQuit, pauseMenuActions, type PauseMenuAction } from '../../lib/game-pause/pause-menu';
import {
  gamePauseContinue, gamePauseCurrent, gamePauseQuit, gamePauseSaveState, listenGamePause,
  type GamePauseInfo,
} from '../../lib/tauri/game-pause';
import { formatAppError } from '../../lib/errors/format-error';
import { showToast } from '../../lib/dom/toast';
import { interpolateTranslation } from '../../lib/i18n-dom/apply-translations';
import { getT } from '../../i18n/runtime';

async function goTo(path: string): Promise<void> {
  const { navigate } = await import('astro:transitions/client');
  await navigate(path);
}

// The controller pause menu (src-tauri/src/game_pause): mounted once in
// BaseLayout so it shows over any page, Big Picture included. Pad input:
// inside Big Picture its own loop drives this dialog (it is a foreign
// modal there); elsewhere this runs the same loop. Keyboard: arrows/Tab,
// Enter, Escape = Continue. Mouse: click.
export function GamePauseOverlay() {
  const t = getT().game_pause;
  const [info, setInfo] = useState<GamePauseInfo | null>(null);
  const [busy, setBusy] = useState<PauseMenuAction | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const bigPictureOpen = useExternalStore(bigPictureStore);
  const open = info !== null;

  useEffect(() => { gamePauseOpenStore.set(open); }, [open]);

  // Showing it acknowledges it: Rust resumes a pause nobody displayed.
  const refresh = useCallback(() => {
    gamePauseCurrent().then(setInfo).catch(() => setInfo(null));
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listenGamePause({
      onOpened: refresh,
      onClosed: closed => {
        setInfo(null);
        setBusy(null);
        if (closed.reason !== 'quit') return;
        const target = pathAfterQuit(closed.externalId, bigPictureStore.get(), `${window.location.pathname}${window.location.search}`);
        if (target) goTo(target).catch(console.error);
      },
    }).then(fn => { if (cancelled) fn(); else unlisten = fn; });
    // A pause already open when this page loaded.
    refresh();
    return () => { cancelled = true; unlisten?.(); };
  }, [refresh]);

  const run = (action: PauseMenuAction) => {
    if (busy) return;
    setBusy(action);
    const call = action === 'continue' ? gamePauseContinue() : action === 'quit' ? gamePauseQuit() : gamePauseSaveState();
    call
      .then(() => {
        if (action === 'save_state') showToast(t.state_saved, 'success');
      })
      .catch(err => {
        showToast(formatAppError(err, getT()), 'error');
        // The menu may already be gone on the Rust side.
        refresh();
      })
      .finally(() => setBusy(null));
  };

  // Outside Big Picture the pad drives this dialog through the same
  // walker Big Picture uses for any dialog on top of it.
  useGamepadFrameLoop(open && !bigPictureOpen, {
    onActions: actions => {
      for (const action of actions) navigateForeignDialog(action, null);
    },
  });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const buttons = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    if (buttons.length === 0) return;
    e.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = e.key === 'ArrowDown' ? 1 : -1;
    buttons[(index + step + buttons.length) % buttons.length].focus();
  };

  if (!info) return null;
  const labels: Record<PauseMenuAction, string> = { continue: t.continue, save_state: t.save_state, quit: t.quit };

  return (
    <ModalShell
      onClose={() => run('continue')}
      label={t.title}
      overlayClassName="game-pause-backdrop"
      panelClassName="game-pause-panel"
      closeOnBackdrop={false}
    >
      <div ref={panelRef} className="game-pause-layout" onKeyDown={onKeyDown}>
        <div className="game-pause-art">
          {info.coverUrl
            ? <img src={info.coverUrl} alt="" draggable={false} />
            : <span className="game-pause-art-fallback" aria-hidden="true">{info.title.slice(0, 1)}</span>}
        </div>
        <div className="game-pause-body">
          <p className="game-pause-kicker">{t.title}</p>
          <h2 className="game-pause-title">{info.title}</h2>
          <p className="game-pause-session">
            {interpolateTranslation(t.session_time, { time: formatSessionTime(info.sessionSeconds) })}
          </p>
          <div className="game-pause-actions" role="menu" aria-label={t.title}>
            {pauseMenuActions(info).map(action => (
              <button
                key={action}
                type="button"
                role="menuitem"
                className={`game-pause-action${action === 'quit' ? ' game-pause-action--quit' : ''}`}
                disabled={busy !== null}
                onClick={() => run(action)}
              >
                {busy === action && action === 'quit' ? t.quitting : labels[action]}
              </button>
            ))}
          </div>
          <p className="game-pause-hint">{t.hint}</p>
        </div>
      </div>
    </ModalShell>
  );
}
