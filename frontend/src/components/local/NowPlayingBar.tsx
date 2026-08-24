// Global "now playing" bar — mounted once in BaseLayout.astro (outside
// <slot />, transition:persist) so it survives Astro page transitions the
// same way playback-service.ts's own module state does, showing whatever's
// playing through Metadea's local player regardless of which page you're on
// — the same idea as Spotify's own always-there mini-player.
import { usePlaybackState, pausePlayback, resumePlayback, skipToNext, stopPlayback } from '../../lib/local/playback-service';
import { wrapAssetUrl } from '../../lib/tauri';
import { toSmallCover } from '../../lib/shared/small-cover';
import { isReadingType } from '../../lib/constants/media';
import { IconX } from './ui/icons';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function NowPlayingBar() {
  const playback = usePlaybackState();
  if (!playback) return null;

  const current = playback.queue[playback.queueIndex];
  const hasNext = playback.queueIndex < playback.queue.length - 1;
  const progressPct = playback.length > 0 ? Math.min(100, (playback.time / playback.length) * 100) : 0;
  const cover = playback.cover ? wrapAssetUrl(toSmallCover(playback.cover)) : null;
  const episodeLabel = isReadingType(playback.type) ? 'Cap.' : 'Ep.';
  const mediaUrl = `/media?id=${encodeURIComponent(playback.externalId)}`;

  return (
    <div className="now-playing-bar">
      <div className="now-playing-progress-track">
        <div className="now-playing-progress-fill" style={{ width: `${progressPct}%` }} />
      </div>
      <div className="now-playing-content">
        <a className="now-playing-cover-link" href={mediaUrl}>
          {cover
            ? <img className="now-playing-cover" src={cover} alt="" />
            : <div className="now-playing-cover now-playing-cover--empty" />}
        </a>
        <div className="now-playing-info">
          <a className="now-playing-title" href={mediaUrl}>{playback.title}</a>
          <span className="now-playing-episode">
            {episodeLabel} {current?.episodeNumber}
            {playback.length > 0 && ` · ${formatTime(playback.time)} / ${formatTime(playback.length)}`}
          </span>
        </div>
        <div className="now-playing-controls">
          <button
            type="button"
            className="now-playing-btn"
            onClick={() => (playback.status === 'playing' ? pausePlayback() : resumePlayback())}
            aria-label={playback.status === 'playing' ? 'Pausar' : 'Reproducir'}
          >
            {playback.status === 'playing' ? (
              <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            )}
          </button>
          {hasNext && (
            <button type="button" className="now-playing-btn" onClick={skipToNext} aria-label="Siguiente episodio">
              <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 4 15 12 5 20 5 4" /><rect x="17" y="4" width="3" height="16" />
              </svg>
            </button>
          )}
          <button type="button" className="now-playing-btn now-playing-btn--close" onClick={stopPlayback} aria-label="Detener">
            <IconX size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
