import { memo, useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import type { Translations } from '../../i18n/index';
import type { SakugaPost } from '../../lib/tauri/sakuga';
import { parseSakugaSource, sourceEpisodeParts, type SakugaSourceInfo } from '../../lib/sakuga/sakuga-source';
import { isSakugaVideo } from '../../lib/sakuga/sakuga-paging';
import { interpolate } from '../../lib/shared/text/interpolate';
import '../../styles/components/sakuga.css';

export type SakugaStrings = Translations['sakuga'];

export function sakugaEpisodeLabel(info: SakugaSourceInfo, t: SakugaStrings): string | null {
  const parts = sourceEpisodeParts(info);
  if (!parts) return null;
  return parts.season !== null
    ? interpolate(t.season_episode, { season: parts.season, n: parts.episode })
    : interpolate(t.episode, { n: parts.episode });
}

/** Chips shown on a clip: medium (BD/TV), segment (OP/ED) and roles. */
export function sakugaSourceChips(info: SakugaSourceInfo): string[] {
  return [info.medium, info.segment, ...info.roles].filter((chip): chip is string => !!chip);
}

interface Props {
  post: SakugaPost;
  t: SakugaStrings;
  /** The clip's series, when the list spans several ("Bleach"). */
  seriesLabel?: string | null;
  onOpen: () => void;
}

/** A work-card-like tile: 16:9 thumbnail (source chips top-left, a play
 *  glyph when idle) over a footer with "Series · Ep N" and the score. The
 *  clip plays, muted, only while hovered or focused: the video element
 *  exists only then, so nothing downloads otherwise. */
export const SakugaClipCard = memo(function SakugaClipCard({ post, t, seriesLabel, onOpen }: Props) {
  const [active, setActive] = useState(false);
  const info = useMemo(() => parseSakugaSource(post.source), [post.source]);
  const episode = sakugaEpisodeLabel(info, t);
  const chips = sakugaSourceChips(info);
  const video = isSakugaVideo(post);
  const caption = [seriesLabel, episode].filter(Boolean).join(' · ');
  const label = [caption, post.source || `#${post.id}`, interpolate(t.score, { n: post.score })].filter(Boolean).join(' · ');

  return (
    <button
      type="button"
      className="sakuga-clip"
      onClick={onOpen}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      aria-label={label}
      title={post.source || undefined}
    >
      <span className="sakuga-clip__media">
        {post.previewUrl
          ? <img className="sakuga-clip__thumb" src={post.previewUrl} alt="" loading="lazy" decoding="async" />
          : <span className="sakuga-clip__thumb sakuga-clip__thumb--empty" />}
        {active && video && (
          <video
            className="sakuga-clip__video"
            src={post.fileUrl}
            muted
            autoPlay
            loop
            playsInline
            preload="none"
            aria-hidden="true"
          />
        )}
        {video && !active && (
          <span className="sakuga-clip__play" aria-hidden="true"><Play size={14} fill="currentColor" strokeWidth={0} /></span>
        )}
        {chips.length > 0 && (
          <span className="sakuga-clip__chips" aria-hidden="true">
            {chips.map(chip => <span key={chip} className="sakuga-chip">{chip}</span>)}
          </span>
        )}
        {!video && <span className="sakuga-clip__still" aria-hidden="true">{t.image_clip}</span>}
      </span>
      <span className="sakuga-clip__footer" aria-hidden="true">
        <span className="sakuga-clip__caption">{caption}</span>
        <span className="sakuga-clip__score">♥ {post.score}</span>
      </span>
    </button>
  );
});
