import {
  AudioLines, Camera, Captions, Gauge, ListVideo, Maximize, Minimize, Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward, Volume1,
  Volume2, VolumeX,
} from 'lucide-react';
import type { Translations } from '../../i18n/index';
import { SEEK_BUTTON_STEP_SECONDS } from '../../lib/player/keymap';
import { formatClockPair, formatSignedSeconds, formatSpeed } from '../../lib/player/format-time';
import type { PlayerStatus, PlayerTrack } from '../../lib/player/player-status';
import {
  playerNext, playerPrev, playerScreenshot, playerSeek, playerSetMute, playerSetTrack, playerSetVolume, playerTogglePause,
} from '../../lib/tauri/player';
import { PlayerMenu, type PlayerMenuItem } from './PlayerMenu';
import { PlayerSeekBar } from './PlayerSeekBar';
import { applySpeed, MAX_VOLUME, SPEED_OPTIONS } from './player-actions';

export type PlayerMenuKind = 'audio' | 'sub' | 'speed';

interface Props {
  status: PlayerStatus;
  t: Translations['player'];
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  menu: PlayerMenuKind | null;
  onMenuChange: (menu: PlayerMenuKind | null) => void;
  queueOpen: boolean;
  onToggleQueue: () => void;
}

function swallow(promise: Promise<unknown>) {
  promise.catch(err => console.error('Player command failed', err));
}

function trackLabel(track: PlayerTrack, t: Translations['player']): string {
  return track.title?.trim() || track.lang?.toUpperCase() || t.track_untitled.replace('{id}', String(track.id));
}

function trackDetail(track: PlayerTrack): string | undefined {
  const parts = [track.title ? track.lang?.toUpperCase() : null, track.codec, track.external ? 'ext' : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

function trackItems(status: PlayerStatus, kind: 'audio' | 'sub', t: Translations['player']): PlayerMenuItem[] {
  const tracks = status.tracks.filter(track => track.kind === kind);
  const anySelected = tracks.some(track => track.selected);
  const items: PlayerMenuItem[] = tracks.map(track => ({
    key: String(track.id),
    label: trackLabel(track, t),
    detail: trackDetail(track),
    selected: track.selected,
    onSelect: () => swallow(playerSetTrack(kind, track.id)),
  }));
  if (tracks.length > 0) {
    items.push({ key: 'off', label: t.track_off, selected: !anySelected, onSelect: () => swallow(playerSetTrack(kind, null)) });
  }
  return items;
}

export function PlayerControls({ status, t, isFullscreen, onToggleFullscreen, menu, onMenuChange, queueOpen, onToggleQueue }: Props) {
  const playing = status.state === 'playing';
  const hasPrev = status.playlist_index > 0;
  const hasNext = status.playlist_index >= 0 && status.playlist_index < status.playlist_len - 1;
  const VolumeIcon = status.muted || status.volume <= 0 ? VolumeX : status.volume < 50 ? Volume1 : Volume2;
  const toggleMenu = (kind: PlayerMenuKind) => onMenuChange(menu === kind ? null : kind);
  const closeMenu = () => onMenuChange(null);

  const speedItems: PlayerMenuItem[] = SPEED_OPTIONS.map(speed => ({
    key: String(speed),
    label: formatSpeed(speed),
    selected: Math.abs(status.speed - speed) < 0.01,
    onSelect: () => applySpeed(speed),
  }));

  return (
    <div className="player-controls">
      <PlayerSeekBar positionSecs={status.position_secs} durationSecs={status.duration_secs} seekLabel={t.seek_to} />
      <div className="player-controls__row">
        <button type="button" className="player-icon-btn" onClick={() => swallow(playerPrev())} disabled={!hasPrev} aria-label={t.prev_episode} title={t.prev_episode}>
          <SkipBack size={18} />
        </button>
        <button type="button" className="player-icon-btn" onClick={() => swallow(playerSeek(-SEEK_BUTTON_STEP_SECONDS, true))} aria-label={t.seek_back} title={t.seek_back}>
          <RotateCcw size={18} />
        </button>
        <button type="button" className="player-icon-btn player-icon-btn--primary" onClick={() => swallow(playerTogglePause())} aria-label={playing ? t.pause : t.play} title={playing ? t.pause : t.play}>
          {playing ? <Pause size={22} /> : <Play size={22} />}
        </button>
        <button type="button" className="player-icon-btn" onClick={() => swallow(playerSeek(SEEK_BUTTON_STEP_SECONDS, true))} aria-label={t.seek_forward} title={t.seek_forward}>
          <RotateCw size={18} />
        </button>
        <button type="button" className="player-icon-btn" onClick={() => swallow(playerNext())} disabled={!hasNext} aria-label={t.next_episode} title={t.next_episode}>
          <SkipForward size={18} />
        </button>
        <span className="player-controls__clock">{formatClockPair(status.position_secs, status.duration_secs)}</span>
        {status.sub_delay_secs !== 0 && (
          <span className="player-controls__badge">{t.sub_delay.replace('{delay}', formatSignedSeconds(status.sub_delay_secs))}</span>
        )}
        <span className="player-controls__spacer" />
        <div className="player-volume">
          <button type="button" className="player-icon-btn" onClick={() => swallow(playerSetMute(!status.muted))} aria-label={status.muted ? t.unmute : t.mute} title={status.muted ? t.unmute : t.mute}>
            <VolumeIcon size={18} />
          </button>
          <input
            type="range"
            className="player-volume__input"
            min={0}
            max={MAX_VOLUME}
            step={1}
            value={status.muted ? 0 : Math.round(status.volume)}
            aria-label={t.volume}
            onChange={event => {
              const next = Number(event.currentTarget.value);
              swallow(playerSetVolume(next));
              if (status.muted && next > 0) swallow(playerSetMute(false));
            }}
          />
        </div>
        <div className="player-controls__menu-anchor">
          <button type="button" className="player-icon-btn player-icon-btn--text" onClick={() => toggleMenu('speed')} aria-haspopup="menu" aria-expanded={menu === 'speed'} aria-label={t.speed} title={t.speed}>
            <Gauge size={18} />
            <span>{formatSpeed(status.speed)}</span>
          </button>
          {menu === 'speed' && <PlayerMenu title={t.speed} items={speedItems} emptyLabel="" onClose={closeMenu} />}
        </div>
        <div className="player-controls__menu-anchor">
          <button type="button" className="player-icon-btn" onClick={() => toggleMenu('audio')} aria-haspopup="menu" aria-expanded={menu === 'audio'} aria-label={t.audio_tracks} title={t.audio_tracks}>
            <AudioLines size={18} />
          </button>
          {menu === 'audio' && <PlayerMenu title={t.audio_tracks} items={trackItems(status, 'audio', t)} emptyLabel={t.no_audio_tracks} onClose={closeMenu} />}
        </div>
        <div className="player-controls__menu-anchor">
          <button type="button" className="player-icon-btn" onClick={() => toggleMenu('sub')} aria-haspopup="menu" aria-expanded={menu === 'sub'} aria-label={t.subtitle_tracks} title={t.subtitle_tracks}>
            <Captions size={18} />
          </button>
          {menu === 'sub' && <PlayerMenu title={t.subtitle_tracks} items={trackItems(status, 'sub', t)} emptyLabel={t.no_subtitle_tracks} onClose={closeMenu} />}
        </div>
        <button type="button" className="player-icon-btn" onClick={() => swallow(playerScreenshot())} aria-label={t.screenshot} title={t.screenshot}>
          <Camera size={18} />
        </button>
        <button type="button" className={`player-icon-btn${queueOpen ? ' player-icon-btn--active' : ''}`} onClick={onToggleQueue} aria-pressed={queueOpen} aria-label={t.queue_toggle} title={t.queue_toggle}>
          <ListVideo size={18} />
        </button>
        <button type="button" className="player-icon-btn" onClick={onToggleFullscreen} aria-label={isFullscreen ? t.exit_fullscreen : t.fullscreen} title={isFullscreen ? t.exit_fullscreen : t.fullscreen}>
          {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
        </button>
      </div>
    </div>
  );
}
