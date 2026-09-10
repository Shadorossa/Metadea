import type { ReactNode } from 'react';

interface Props {
  /** Outer wrapper class(es) — each caller has its own (now-playing-bar /
   *  now-reading-bar, the latter with a conditional modifier). */
  className: string;
  /** The two callers use differently-named progress bar classes
   *  (now-playing-progress-* / now-reading-progress-*) even though they're
   *  visually identical — kept as-is rather than renaming either one's CSS. */
  progressTrackClassName: string;
  progressFillClassName: string;
  progressPct: number;
  mediaUrl: string;
  cover: string | null;
  title: string;
  subtitle: ReactNode;
  controls: ReactNode;
}

// Shared shell behind both NowPlayingBar (video) and NowReadingBar (comics/
// manga/books) — progress track, cover, title/subtitle and a controls slot.
// Each caller only supplies its own data source and its own buttons; this
// only renders the (previously duplicated) markup around them.
export function NowMediaBar({
  className, progressTrackClassName, progressFillClassName, progressPct,
  mediaUrl, cover, title, subtitle, controls,
}: Props) {
  return (
    <div className={className}>
      <div className={progressTrackClassName}>
        <div className={progressFillClassName} style={{ width: `${progressPct}%` }} />
      </div>
      <div className="now-playing-content">
        <a className="now-playing-cover-link" href={mediaUrl}>
          {cover
            ? <img className="now-playing-cover" src={cover} alt="" />
            : <div className="now-playing-cover now-playing-cover--empty" />}
        </a>
        <div className="now-playing-info">
          <a className="now-playing-title" href={mediaUrl}>{title}</a>
          <span className="now-playing-episode">{subtitle}</span>
        </div>
        <div className="now-playing-controls">
          {controls}
        </div>
      </div>
    </div>
  );
}
