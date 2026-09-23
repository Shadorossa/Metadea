import '../../styles/player.css';
import '../../styles/player-overlay.css';
import '../../styles/player-overlay-panels.css';
import { ModalShell } from '../shared/ModalShell';
import { getT } from '../../i18n/runtime';
import { playerStopClose } from '../../lib/tauri/player';
import { PlayerStage } from './PlayerStage';

// The built-in player as a full-viewport overlay on top of whatever page is
// open — the same ModalShell pattern as the comic reader (ReaderModal).
// Rendered by NowPlayingBar (mounted on every page, transition:persist)
// while lib/player/player-modal-state says it is open. Escape/close are
// handled by the stage's own keymap (fullscreen and menus first), so the
// shell's own Escape is off, like the reader's.
export function PlayerModal() {
  const t = getT().player;
  return (
    <ModalShell
      overlay={false}
      onClose={() => { playerStopClose('stopped').catch(() => {}); }}
      label={t.window_title}
      panelClassName="player-modal"
      closeOnEscape={false}
      closeOnBackdrop={false}
      stopPanelPropagation={false}
    >
      <PlayerStage />
    </ModalShell>
  );
}
