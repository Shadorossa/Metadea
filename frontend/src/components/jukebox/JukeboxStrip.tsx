import { useState } from 'react';
import { Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react';
import type { Translations } from '../../i18n/index';
import { wrapAssetUrl } from '../../lib/tauri/bridge';
import { toSmallCover } from '../../lib/media/small-cover';
import { formatPlaybackTime } from '../../lib/local/formatters';
import { currentTheme, type JukeboxState } from '../../lib/jukebox/jukebox-store';
import { themeDisplayTitle } from '../../lib/jukebox/jukebox-favorites';
import { cycleRepeatMode, next, pause, prev, resume, seekTo, setVolume, toggleShuffle } from '../../lib/jukebox/jukebox-engine';

interface Props {
  state: JukeboxState;
  t: Translations['jukebox'];
}

// Horizontal panel sliding out to the left of the round button: spinning
// disc (hover pauses, click resumes) → prev → seek bar with the song line
// above it → next → volume (slider unfolds on hover) → shuffle → repeat.
// The queue itself is just the favourites (starred on media-page cards).
export function JukeboxStrip({ state, t }: Props) {
  const [volumeOpen, setVolumeOpen] = useState(false);
  const entry = currentTheme(state);
  const playing = state.status === 'playing';
  const artwork = entry
    ? (entry.preview_frame_path ? wrapAssetUrl(entry.preview_frame_path) : entry.cover_url ? wrapAssetUrl(toSmallCover(entry.cover_url)) : null)
    : null;
  const mediaUrl = entry ? `/media?id=${encodeURIComponent(entry.theme.external_id)}` : null;
  const repeatLabel = state.repeat === 'off' ? t.repeat_off : state.repeat === 'all' ? t.repeat_all : t.repeat_one;
  const VolumeIcon = state.volume === 0 ? VolumeX : state.volume < 0.5 ? Volume1 : Volume2;
  const hasQueue = state.queue.length > 0;
  const duration = state.duration > 0 ? state.duration : 0;

  return (
    <section id="jukebox-strip" className="jukebox-panel" aria-label={t.title}>
      <button
        type="button"
        className={`jukebox-disc-btn${playing ? ' jukebox-disc-btn--spinning' : ''}${state.status === 'loading' ? ' jukebox-disc-btn--loading' : ''}`}
        onClick={() => { if (playing) pause(); else resume(); }}
        aria-label={playing ? t.pause : t.play}
        title={playing ? t.pause : t.play}
        disabled={!hasQueue}
      >
        <span className="jukebox-disc">
          {artwork ? <img className="jukebox-disc-art" src={artwork} alt="" /> : <span className="jukebox-disc-art jukebox-disc-art--empty" />}
          <span className="jukebox-disc-hole" aria-hidden="true" />
        </span>
        {/* Playing: the pause glyph only shows on hover (CSS), click pauses.
            Paused: the play glyph stays visible, click resumes. */}
        {hasQueue && (
          <span className={`jukebox-disc-glyph${playing ? ' jukebox-disc-glyph--hover' : ''}`} aria-hidden="true">
            {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
          </span>
        )}
      </button>

      <button type="button" className="jukebox-ctl" onClick={prev} aria-label={t.prev} title={t.prev} disabled={!hasQueue}>
        <SkipBack size={15} />
      </button>

      <div className="jukebox-center">
        <div className="jukebox-line">
          {entry ? (
            <>
              <span className="jukebox-line-song" title={themeDisplayTitle(entry.theme)}>{themeDisplayTitle(entry.theme)}</span>
              {entry.theme.artists && <span className="jukebox-line-sep"> · {entry.theme.artists}</span>}
              {mediaUrl && <a className="jukebox-line-media" href={mediaUrl} title={t.open_media}> · {entry.media_title}</a>}
              {state.error && <span className="jukebox-line-error" role="alert"> · {t.load_error}</span>}
            </>
          ) : (
            <span className="jukebox-line-sep">{hasQueue ? t.nothing_loaded : t.queue_empty}</span>
          )}
        </div>
        <div className="jukebox-seek">
          <span className="jukebox-seek-time">{formatPlaybackTime(state.time)}</span>
          <input
            className="jukebox-range jukebox-range--seek"
            type="range"
            min={0}
            max={duration}
            step={0.1}
            value={Math.min(state.time, duration)}
            onChange={event => seekTo(Number(event.currentTarget.value))}
            aria-label={t.seek}
            disabled={!entry || duration <= 0}
          />
          <span className="jukebox-seek-time">{formatPlaybackTime(duration)}</span>
        </div>
      </div>

      <button type="button" className="jukebox-ctl" onClick={next} aria-label={t.next} title={t.next} disabled={!hasQueue}>
        <SkipForward size={15} />
      </button>

      <div
        className={`jukebox-volume${volumeOpen ? ' jukebox-volume--open' : ''}`}
        onMouseEnter={() => setVolumeOpen(true)}
        onMouseLeave={() => setVolumeOpen(false)}
        onFocus={() => setVolumeOpen(true)}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setVolumeOpen(false); }}
      >
        <button type="button" className="jukebox-ctl" aria-label={t.volume} title={t.volume} onClick={() => setVolumeOpen(open => !open)}>
          <VolumeIcon size={15} />
        </button>
        <input
          className="jukebox-range jukebox-range--volume"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={state.volume}
          onChange={event => setVolume(Number(event.currentTarget.value))}
          aria-label={t.volume}
          tabIndex={volumeOpen ? 0 : -1}
        />
      </div>

      <button
        type="button"
        className={`jukebox-ctl${state.shuffle ? ' jukebox-ctl--active' : ''}`}
        onClick={toggleShuffle}
        aria-pressed={state.shuffle}
        aria-label={state.shuffle ? t.shuffle_off : t.shuffle_on}
        title={state.shuffle ? t.shuffle_off : t.shuffle_on}
      >
        <Shuffle size={14} />
      </button>
      <button
        type="button"
        className={`jukebox-ctl${state.repeat !== 'off' ? ' jukebox-ctl--active' : ''}`}
        onClick={cycleRepeatMode}
        aria-label={repeatLabel}
        title={repeatLabel}
      >
        {state.repeat === 'one' ? <Repeat1 size={14} /> : <Repeat size={14} />}
      </button>
    </section>
  );
}
