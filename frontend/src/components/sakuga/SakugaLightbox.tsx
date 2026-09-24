import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SakugaPost } from '../../lib/tauri/sakuga';
import { parseSakugaSource } from '../../lib/sakuga/sakuga-source';
import { isSakugaVideo, sakugaPostUrl } from '../../lib/sakuga/sakuga-paging';
import { interpolate } from '../../lib/shared/text/interpolate';
import { ModalShell } from '../shared/ModalShell';
import { openLink } from '../media/MediaStoreLinks';
import { sakugaEpisodeLabel, sakugaSourceChips, type SakugaStrings } from './SakugaClipCard';

/** Slow motion only: the owner doesn't want clips sped up past 1×. */
export const SAKUGA_SPEEDS = [0.25, 0.5, 1] as const;
/** Anime is animated against a 24 fps timeline. */
const FRAME_SECONDS = 1 / 24;

interface Props {
  posts: SakugaPost[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** More clips exist past the loaded ones. */
  hasMore: boolean;
  loadMore: () => Promise<void>;
  /** Paged lists: step onto the previous/next page past either end (the
   *  parent swaps `posts` and moves `index`); overrides `loadMore`. */
  pageEdges?: { hasBefore: boolean; hasAfter: boolean; onPastEnd: (direction: 1 | -1) => void };
  t: SakugaStrings;
}

export function SakugaLightbox({ posts, index, onIndexChange, onClose, hasMore, loadMore, pageEdges, t }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(true);
  const [speed, setSpeed] = useState<number>(1);
  const [paused, setPaused] = useState(false);
  const [waitingForMore, setWaitingForMore] = useState(false);
  const post = posts[index];
  const info = useMemo(() => parseSakugaSource(post?.source), [post?.source]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed, post?.id]);

  const step = useCallback((frames: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    const duration = Number.isFinite(video.duration) ? video.duration : Infinity;
    video.currentTime = Math.min(Math.max(0, video.currentTime + frames * FRAME_SECONDS), duration);
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
  }, []);

  const go = useCallback(async (delta: number) => {
    const target = index + delta;
    if (pageEdges && (target < 0 || target >= posts.length)) {
      if (target < 0 ? pageEdges.hasBefore : pageEdges.hasAfter) pageEdges.onPastEnd(target < 0 ? -1 : 1);
      return;
    }
    if (target < 0) return;
    if (target < posts.length) { onIndexChange(target); return; }
    if (!hasMore || waitingForMore) return;
    setWaitingForMore(true);
    try { await loadMore(); } finally { setWaitingForMore(false); }
  }, [index, posts.length, hasMore, waitingForMore, loadMore, onIndexChange, pageEdges]);

  // Moving past the end asked for the next page; step onto it once it lands.
  const pendingAdvance = useRef<number | null>(null);
  useEffect(() => {
    if (waitingForMore) pendingAdvance.current = index + 1;
    else if (pendingAdvance.current !== null) {
      const target = pendingAdvance.current;
      pendingAdvance.current = null;
      if (target < posts.length) onIndexChange(target);
    }
  }, [waitingForMore, index, posts.length, onIndexChange]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const handled = (() => {
        switch (event.key) {
          case ',': step(-1); return true;
          case '.': step(1); return true;
          case 'ArrowLeft': void go(-1); return true;
          case 'ArrowRight': void go(1); return true;
          case ' ': togglePlay(); return true;
          case 'm': case 'M': setMuted(m => !m); return true;
          default: return false;
        }
      })();
      if (handled) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [step, go, togglePlay]);

  if (!post) return null;
  const episode = sakugaEpisodeLabel(info, t);
  const chips = sakugaSourceChips(info);
  const postUrl = sakugaPostUrl(post.id);
  const atStart = index === 0 && !pageEdges?.hasBefore;
  const atEnd = index >= posts.length - 1 && (pageEdges ? !pageEdges.hasAfter : !hasMore);

  return (
    <ModalShell onClose={onClose} label={t.lightbox_label} overlayClassName="sakuga-lightbox" panelClassName="sakuga-lightbox__panel">
      <div className="sakuga-lightbox__stage">
        {isSakugaVideo(post) ? (
          <video
            key={post.id}
            ref={videoRef}
            className="sakuga-lightbox__video"
            src={post.fileUrl}
            poster={post.previewUrl || undefined}
            autoPlay
            loop
            muted={muted}
            playsInline
            onPlay={() => setPaused(false)}
            onPause={() => setPaused(true)}
            onLoadedMetadata={event => { event.currentTarget.playbackRate = speed; }}
          />
        ) : (
          <img key={post.id} className="sakuga-lightbox__video" src={post.fileUrl} alt={post.source || `#${post.id}`} />
        )}
        <button type="button" className="sakuga-lightbox__nav sakuga-lightbox__nav--prev" onClick={() => void go(-1)} disabled={atStart} aria-label={t.previous} title={t.previous}>‹</button>
        <button type="button" className="sakuga-lightbox__nav sakuga-lightbox__nav--next" onClick={() => void go(1)} disabled={atEnd || waitingForMore} aria-label={t.next} title={t.next}>›</button>
      </div>

      <div className="sakuga-lightbox__bar">
        <div className="sakuga-lightbox__controls">
          <button type="button" className="sakuga-lightbox__btn" onClick={togglePlay} aria-label={paused ? t.play : t.pause} title={paused ? t.play : t.pause}>{paused ? '▶' : '❚❚'}</button>
          <button type="button" className="sakuga-lightbox__btn" onClick={() => step(-1)} aria-label={t.frame_back} title={t.frame_back}>,</button>
          <button type="button" className="sakuga-lightbox__btn" onClick={() => step(1)} aria-label={t.frame_forward} title={t.frame_forward}>.</button>
          <span className="sakuga-lightbox__speeds" role="group" aria-label={t.speed}>
            {SAKUGA_SPEEDS.map(value => (
              <button
                key={value}
                type="button"
                className={`sakuga-lightbox__btn${speed === value ? ' is-active' : ''}`}
                aria-pressed={speed === value}
                onClick={() => setSpeed(value)}
              >
                {value}×
              </button>
            ))}
          </span>
          <button type="button" className={`sakuga-lightbox__btn${muted ? '' : ' is-active'}`} onClick={() => setMuted(m => !m)} aria-pressed={!muted} aria-label={muted ? t.unmute : t.mute} title={muted ? t.unmute : t.mute}>
            {muted ? '🔇' : '🔊'}
          </button>
          <span className="sakuga-lightbox__position">{interpolate(t.clip_position, { i: index + 1, n: posts.length })}</span>
          <button type="button" className="sakuga-lightbox__btn sakuga-lightbox__close" onClick={onClose} aria-label={t.close} title={t.close}>✕</button>
        </div>
        <div className="sakuga-lightbox__meta">
          <span className="sakuga-lightbox__score">♥ {post.score}</span>
          {episode && <span className="sakuga-chip">{episode}</span>}
          {chips.map(chip => <span key={chip} className="sakuga-chip">{chip}</span>)}
          {post.source && <span className="sakuga-lightbox__source">{post.source}</span>}
          <a className="sakuga-lightbox__attribution" href={postUrl} onClick={event => { event.preventDefault(); openLink(postUrl); }}>
            {t.open_post} · #{post.id}
          </a>
        </div>
        <p className="sakuga-lightbox__hint">{t.keys_hint}</p>
      </div>
    </ModalShell>
  );
}
