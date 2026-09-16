import type { ReactNode } from 'react';
import { motion } from 'motion/react';

interface Props {
  className: string;
  progressTrackClassName: string;
  progressFillClassName: string;
  progressPct: number;
  mediaUrl: string;
  cover: string | null;
  title: string;
  subtitle: ReactNode;
  controls: ReactNode;
}

export function NowMediaBar({
  className, progressTrackClassName, progressFillClassName, progressPct,
  mediaUrl, cover, title, subtitle, controls,
}: Props) {
  return (
    <motion.div
      className={className}
      layout="position"
      initial={{ y: 80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 80, opacity: 0 }}
      transition={{ duration: 0.25, ease: [0.25, 0, 0.15, 1] }}
    >
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
    </motion.div>
  );
}
