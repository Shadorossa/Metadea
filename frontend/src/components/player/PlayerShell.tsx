import { useEffect, useMemo, useState } from 'react';
import { SkipForward, X } from 'lucide-react';
import type { Translations } from '../../i18n/index';
import { getT } from '../../i18n/runtime';
import { CLIP_KEY_BINDINGS } from '../../lib/player/keymap';
import { formatCaptureTimecode } from '../../lib/player/player-status';
import type { ShortcutBinding } from '../../lib/shared/keyboard/shortcut-registry';
import { queueEntryHeading } from '../../lib/player/queue';
import type { SkipSegmentKind } from '../../lib/player/skip-segments';
import {
  playerClipOpenFolder, playerClipReveal, playerIsFullscreen, playerStopClose, playerTogglePause,
} from '../../lib/tauri/player';
import { useShortcuts } from '../shared/hooks/useShortcuts';
import { PlayerControls, type PlayerMenuKind } from './PlayerControls';
import { PlayerQueuePanel } from './PlayerQueuePanel';
import { useAutoHide } from './hooks/useAutoHide';
import { useClipMode } from './hooks/useClipMode';
import { usePlayerFillerNext } from './hooks/usePlayerFillerNext';
import { usePlayerKeys } from './hooks/usePlayerKeys';
import { usePlayerSkipSegments } from './hooks/usePlayerSkipSegments';
import { usePlayerStatus } from './hooks/usePlayerStatus';
import { usePlayerTrackPreferences } from './hooks/usePlayerTrackPreferences';
import { setFullscreen as applyFullscreen } from './player-actions';

const IDLE_HIDE_MS = 2500;
const SCREENSHOT_TOAST_MS = 2600;
const AUTO_SKIP_TOAST_MS = 6000;
const CLIP_DONE_TOAST_MS = 9000;

interface Props {
  // Docked: rendered by PlayerStage in the main WebView under the video
  // (no overlay window); always visible, keys are bound by the stage,
  // which reaches the skip action through `onSkipReady`.
  docked?: boolean;
  onSkipReady?: (skip: () => void) => void;
}

function skipLabel(kind: SkipSegmentKind, t: Translations['player']): string {
  switch (kind) {
    case 'opening': return t.skip_opening;
    case 'ending': return t.skip_ending;
    case 'recap': return t.skip_recap;
    case 'preview': return t.skip_preview;
  }
}

function skippedLabel(kind: SkipSegmentKind, t: Translations['player']): string {
  switch (kind) {
    case 'opening': return t.skipped_opening;
    case 'ending': return t.skipped_ending;
    case 'recap': return t.skipped_recap;
    case 'preview': return t.skipped_preview;
  }
}

// Every control the user sees. Overlay mode: root of the transparent
// `player-overlay` window that floats over the video rect
// (src-tauri/src/player/window.rs). Docked mode: a plain bar below it.
export function PlayerShell({ docked = false, onSkipReady }: Props) {
  const t = getT().player;
  const { status, session, screenshot, errorCode, dismissScreenshot, dismissError } = usePlayerStatus();
  const [queueOpen, setQueueOpen] = useState(false);
  const [menu, setMenu] = useState<PlayerMenuKind | null>(null);
  const [fullscreen, setFullscreenState] = useState(false);

  const index = Math.max(0, status.playlist_index);
  const episodeNumber = session?.episode_numbers[index] ?? null;
  const { segments, activeSegment, skip, autoSkipped, undoAutoSkip, dismissAutoSkip } = usePlayerSkipSegments({
    externalId: session?.external_id,
    episodeNumber,
    durationSecs: status.duration_secs,
    positionSecs: status.position_secs,
    chapters: status.chapters,
    enabled: status.state !== 'idle',
  });

  const trackPreferences = usePlayerTrackPreferences(status, session);
  const clip = useClipMode(status, getT());
  const fillerNext = usePlayerFillerNext(status, session, activeSegment?.kind === 'ending');
  const clipActive = clip.phase === 'trimming' || clip.phase === 'choosing';

  // Clip mode keys ([ / ] / Enter): a second `player` registration made
  // while clip mode is on, so it shadows speed [ / ] only for that time
  // (lib/player/keymap.ts CLIP_KEY_BINDINGS). [ / ] only while trimming;
  // Enter confirms the trim, then exports, and leaves focused buttons alone.
  const clipBindings = useMemo<ShortcutBinding[]>(() => CLIP_KEY_BINDINGS.map(binding => ({
    id: binding.id,
    keys: binding.keys,
    description: binding.description,
    when: binding.action === 'confirm'
      ? () => !(document.activeElement instanceof HTMLButtonElement)
      : () => clip.phase === 'trimming',
    handler: () => {
      if (binding.action === 'set_start') clip.markStart();
      else if (binding.action === 'set_end') clip.markEnd();
      else if (clip.phase === 'trimming') clip.confirmTrim();
      else clip.exportClip();
    },
  })), [clip]);
  useShortcuts('player', clipBindings, { enabled: clipActive });

  useEffect(() => {
    if (!clip.result) return;
    const timer = window.setTimeout(clip.dismissResult, CLIP_DONE_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [clip.result, clip.dismissResult]);

  useEffect(() => {
    onSkipReady?.(skip);
  }, [onSkipReady, skip]);

  useEffect(() => {
    if (!autoSkipped) return;
    const timer = window.setTimeout(dismissAutoSkip, AUTO_SKIP_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [autoSkipped, dismissAutoSkip]);

  const pinned = docked || status.state !== 'playing' || queueOpen || menu !== null || clip.phase !== 'idle';
  const { visible } = useAutoHide(IDLE_HIDE_MS, pinned);

  useEffect(() => {
    playerIsFullscreen().then(setFullscreenState).catch(() => {});
  }, []);

  useEffect(() => {
    if (!screenshot) return;
    const timer = window.setTimeout(dismissScreenshot, SCREENSHOT_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [screenshot, dismissScreenshot]);

  const toggleQueue = () => setQueueOpen(open => !open);
  const dismissOverlays = () => {
    if (clipActive) { clip.cancel(); return true; }
    if (menu !== null) { setMenu(null); return true; }
    if (queueOpen) { setQueueOpen(false); return true; }
    return false;
  };

  const actionContext = {
    status, isFullscreen: fullscreen, setFullscreen: setFullscreenState, toggleQueue, dismissOverlays, skipSegment: skip,
  };
  usePlayerKeys(actionContext, !docked);

  const toggleFullscreen = () => applyFullscreen(!fullscreen, actionContext);
  const heading = session ? queueEntryHeading(session.work_name, index, session.titles, session.episode_labels) : '';
  const errorText = errorCode === 'load_failed' ? t.error_load_failed : errorCode ? t.error_generic.replace('{code}', errorCode) : null;

  return (
    <div className={`player-overlay${visible ? '' : ' player-overlay--idle'}${queueOpen ? ' player-overlay--queue' : ''}${docked ? ' player-overlay--docked' : ''}`}>
      {!docked && (
        <button
          type="button"
          className="player-overlay__stage"
          aria-label={status.state === 'playing' ? t.pause : t.play}
          onClick={() => playerTogglePause().catch(() => {})}
          onDoubleClick={toggleFullscreen}
        />
      )}

      <header className="player-overlay__top">
        <h1 className="player-overlay__heading">{heading}</h1>
        <button type="button" className="player-icon-btn" onClick={() => playerStopClose('stopped').catch(() => {})} aria-label={t.close} title={t.close}>
          <X size={18} />
        </button>
      </header>

      {status.state === 'ended' && <div className="player-overlay__ended" role="status">{t.state_ended}</div>}

      {activeSegment && (
        <div className="player-skip">
          <button type="button" className="player-skip__button" onClick={skip} title={t.skip_shortcut_hint}>
            <span>{skipLabel(activeSegment.kind, t)}</span>
            <SkipForward size={16} />
          </button>
        </div>
      )}

      {fillerNext.next && (
        <div className="player-filler-next" role="status">
          <span className="player-filler-next__text">
            {t.filler_next_canon.replace('{episode}', String(fillerNext.next.episode)).replace('{count}', String(fillerNext.next.skipped))}
          </span>
          <div className="player-filler-next__actions">
            <button type="button" className="player-skip__button" onClick={fillerNext.playCanon}>
              <span>{t.filler_play.replace('{episode}', String(fillerNext.next.episode))}</span>
              <SkipForward size={16} />
            </button>
            <button type="button" className="player-toast__action" onClick={fillerNext.watchFiller}>{t.filler_watch_anyway}</button>
          </div>
        </div>
      )}

      <div className="player-overlay__bottom">
        <PlayerControls
          status={status}
          segments={segments}
          t={t}
          isFullscreen={fullscreen}
          onToggleFullscreen={toggleFullscreen}
          menu={menu}
          onMenuChange={setMenu}
          queueOpen={queueOpen}
          onToggleQueue={toggleQueue}
          hasTrackMemory={trackPreferences.hasMemory}
          onManualTrack={trackPreferences.rememberManual}
          onResetTrackMemory={trackPreferences.resetMemory}
          seekPreview={!docked}
          clip={clip}
        />
      </div>

      {queueOpen && session && (
        <PlayerQueuePanel session={session} currentIndex={index} onClose={() => setQueueOpen(false)} t={t} />
      )}

      {screenshot && (
        <div className="player-toast" role="status" aria-live="polite">
          <strong>{t.screenshot_saved}</strong>
          <span>{screenshot.episode_label} · {formatCaptureTimecode(screenshot.timecode)}</span>
        </div>
      )}
      {autoSkipped && !screenshot && (
        <div className="player-toast" role="status" aria-live="polite" key={autoSkipped.token}>
          <strong>{skippedLabel(autoSkipped.segment.kind, t)}</strong>
          <button type="button" className="player-toast__action" onClick={undoAutoSkip}>{t.skip_undo}</button>
        </div>
      )}
      {clip.phase === 'exporting' && !screenshot && (
        <div className="player-toast" role="status" aria-live="polite">
          <span>{t.clip_exporting.replace('{percent}', String(Math.round(clip.progress * 100)))}</span>
          <button type="button" className="player-toast__action" onClick={clip.cancelExport}>{t.clip_cancel}</button>
        </div>
      )}
      {clip.result && !screenshot && (
        <div className="player-toast" role="status" aria-live="polite">
          <strong>{clip.result.copied ? t.clip_copied : t.clip_saved}</strong>
          <button type="button" className="player-toast__action" onClick={() => playerClipOpenFolder().catch(() => {})}>{t.clip_open_folder}</button>
          <button type="button" className="player-toast__action" onClick={() => playerClipReveal(clip.result?.path ?? '').catch(() => {})}>
            {t.clip_show_file}
          </button>
        </div>
      )}
      {clip.error && (
        <div className="player-toast player-toast--error" role="alert">
          <span>{clip.error}</span>
          <button type="button" className="player-icon-btn" onClick={clip.dismissError} aria-label={t.dismiss} title={t.dismiss}>
            <X size={14} />
          </button>
        </div>
      )}
      {errorText && (
        <div className="player-toast player-toast--error" role="alert">
          <span>{errorText}</span>
          <button type="button" className="player-icon-btn" onClick={dismissError} aria-label={t.dismiss} title={t.dismiss}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
