import { Clock, CalendarDays, Trophy, Heart, Play, BookOpen } from 'lucide-react';
import type { Translations } from '../../i18n/index';
import type { BigPictureItem } from '../../lib/big-picture/categories';
import type { InputDevice } from '../../lib/big-picture/glyphs';
import { formatLastPlayed, formatPlaytime } from '../../lib/local/formatters';
import { getStatusBadge } from '../../lib/local/status-badge';
import { interpolateTranslation } from '../../lib/i18n-dom/apply-translations';
import { PLATFORM_LABEL } from '../../lib/local/platforms';
import type { LocalGame } from '../../lib/tauri';
import type { FocusedExtras } from './hooks/useFocusedExtras';
import { ButtonGlyph } from './BigPictureHints';
import { platformName } from './hooks/useBigPictureItems';

export type PrimaryActionKind = 'play' | 'continue' | 'watch' | 'read' | 'resume';

/** What A does on `item`: launch a game, or watch/read a work — "Continue"
 *  / "Resume" once there is progress (or a paused session) to go back to. */
export function primaryActionKind(item: BigPictureItem, pausedHere: boolean): PrimaryActionKind {
  if (item.kind === 'game') return 'play';
  if (pausedHere) return 'resume';
  const started = (item.progress?.current ?? 0) > 0;
  if (item.progress?.unit === 'chapter') return started ? 'resume' : 'read';
  return started ? 'continue' : 'watch';
}

interface BigPictureDetailsProps {
  item: BigPictureItem | null;
  game: LocalGame | undefined;
  extras: FocusedExtras | null;
  device: InputDevice;
  primary: PrimaryActionKind;
  busy: boolean;
  onPrimary: () => void;
  t: Translations['big_picture'];
  profileT: Translations['profile'];
  kindLabel: string;
}

export function BigPictureDetails({ item, game, extras, device, primary, busy, onPrimary, t, profileT, kindLabel }: BigPictureDetailsProps) {
  if (!item) return <section className="bp-details" aria-live="polite" />;
  const status = getStatusBadge(item.status);
  const achievements = extras?.achievements ?? null;
  const origin = item.kind === 'game'
    ? (item.romPlatform ? interpolateTranslation(t.platform_emulated, { platform: platformName(item.romPlatform) }) : game ? PLATFORM_LABEL[game.launcher] : kindLabel)
    : kindLabel;
  const progress = item.progress;
  const progressText = progress
    ? interpolateTranslation(
      progress.unit === 'chapter'
        ? (progress.total ? t.chapter_progress : t.chapter_progress_open)
        : (progress.total ? t.episode_progress : t.episode_progress_open),
      { current: progress.current, total: progress.total ?? '' },
    )
    : null;
  const primaryLabel = t[`action_${primary}` as const];

  return (
    <section className="bp-details" aria-live="polite" key={item.key}>
      <p className="bp-details-origin">
        <span>{origin}</span>
        {item.favorite && <span className="bp-details-fav"><Heart size={14} fill="currentColor" aria-hidden="true" />{t.favorite_badge}</span>}
        {status && <span className={`bp-details-status bp-details-status--${status.modifier}`}>{profileT[status.labelKey]}</span>}
      </p>
      <h2 className="bp-details-title">{item.title}</h2>

      <dl className="bp-details-stats">
        {item.kind === 'game' ? (
          <>
            <div className="bp-stat">
              <dt><Clock size={18} aria-hidden="true" />{t.stat_playtime}</dt>
              <dd>{formatPlaytime(item.playtimeMinutes)}</dd>
            </div>
            <div className="bp-stat">
              <dt><CalendarDays size={18} aria-hidden="true" />{t.stat_last_played}</dt>
              <dd>{item.lastActivity ? formatLastPlayed(item.lastActivity) : t.never_played}</dd>
            </div>
            {achievements && (
              <div className="bp-stat">
                <dt><Trophy size={18} aria-hidden="true" />{achievements.source === 'retro' ? t.stat_retro_achievements : t.stat_achievements}</dt>
                <dd>
                  {achievements.unlocked}/{achievements.total}
                  {achievements.points && <small>{interpolateTranslation(t.points, { unlocked: achievements.points.unlocked, total: achievements.points.total })}</small>}
                </dd>
                <span className="bp-stat-bar"><span style={{ transform: `scaleX(${achievements.total ? achievements.unlocked / achievements.total : 0})` }} /></span>
              </div>
            )}
          </>
        ) : (
          progressText && (
            <div className="bp-stat">
              <dt>{progress?.unit === 'chapter' ? <BookOpen size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}{t.stat_progress}</dt>
              <dd>{progressText}</dd>
              {progress?.total ? <span className="bp-stat-bar"><span style={{ transform: `scaleX(${Math.min(1, progress.current / progress.total)})` }} /></span> : null}
            </div>
          )
        )}
      </dl>

      <button type="button" className="bp-primary" onClick={onPrimary} disabled={busy} tabIndex={-1}>
        <ButtonGlyph device={device} button="confirm" />
        <span>{primaryLabel}</span>
      </button>
    </section>
  );
}
