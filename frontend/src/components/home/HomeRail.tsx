// Home's right rail: "Airing today", then "Continue watching" (the single
// last thing watched locally, Netflix-style, resuming in Local on click).
// Both come from data already on the device — the cached library bundle,
// one get_continue_watching_sources read and the weekly airing check's
// schedule — and paint from the Home snapshot on the first frame.
import { useEffect, useState } from 'react';
import { getT } from '../../i18n/runtime';
import { loadHomeData } from '../../lib/home/home-data';
import {
  buildLocalResumeUrl,
  episodeLine,
  pickLastWatched,
  remainingLabel,
  watchedFraction,
} from '../../lib/home/continue-watching';
import { airingToday, type AiringTodayRow } from '../../lib/home/airing-today';
import {
  localDateKey,
  readHomeSnapshot,
  sameIds,
  snapshotAiring,
  updateHomeSnapshot,
  type ContinueCardData,
} from '../../lib/home/home-snapshot';
import { toMediumCover, toSmallCover } from '../../lib/media/small-cover';
import { CoverImage } from '../shared/CoverImage';
import { interpolate } from '../../lib/shared/text/interpolate';
import { computeUpcomingPlanningReleases } from '../../lib/profile/stats-calculators';
import { readLibraryAiringSchedule } from '../../lib/notifications/library-release-notifications';
import { getContinueWatchingSources } from '../../lib/tauri/continue-watching';
import { nextCanonEpisode, skipsFiller } from '../../lib/anime/filler';
import { getLoadedFillerInfo } from '../../lib/anime/filler-store';
import { wrapAssetUrl } from '../../lib/tauri/bridge';
import { useSpoilerShield } from '../spoilers/hooks/useSpoilerShield';
import { SpoilerInline } from '../spoilers/SpoilerShield';
import { spoilerItemKey } from '../../lib/spoilers/spoiler-reveals';

/** Spoiler shield state of the Continue card's episode (lib/spoilers/). */
interface ContinueEpisodeSpoiler {
  /** Shield data still loading: title and still wait, the cover stands in. */
  pending: boolean;
  hidden: boolean;
  onReveal: () => void;
}

type HomeStrings = ReturnType<typeof getT>['home'];

/** The thumbnail, in the order the card prefers: the player's own frame
 *  of the stop point, the episode's still, the work's cover. The frame file
 *  is overwritten on every stop, so its URL carries the stop time. A still
 *  the spoiler shield holds back gives way to the cover. */
function thumbnailFor(card: ContinueCardData, stillWithheld = false): string | null {
  if (card.framePath) return `${wrapAssetUrl(card.framePath)}?v=${card.updatedAt}`;
  if (card.stillUrl && !stillWithheld) return wrapAssetUrl(card.stillUrl);
  return card.coverUrl ? wrapAssetUrl(toMediumCover(card.coverUrl)) : null;
}

function sameCard(a: ContinueCardData | null, b: ContinueCardData | null): boolean {
  if (!a || !b) return a === b;
  return a.externalId === b.externalId && a.episodeNumber === b.episodeNumber
    && a.positionSeconds === b.positionSeconds && a.framePath === b.framePath && a.title === b.title;
}

export function ContinueWatchingCard({ card, t, spoiler }: { card: ContinueCardData; t: HomeStrings; spoiler?: ContinueEpisodeSpoiler }) {
  const href = buildLocalResumeUrl(card.externalId, card.mediaType) ?? `/media?id=${encodeURIComponent(card.externalId)}`;
  const withheld = !!spoiler && (spoiler.pending || spoiler.hidden);
  const thumb = thumbnailFor(card, withheld);
  const fraction = watchedFraction(card.positionSeconds, card.durationSeconds);
  const remaining = remainingLabel(card.positionSeconds, card.durationSeconds, t);
  return (
    <section className="home-rail-card home-continue" aria-labelledby="home-continue-title">
      <div className="home-activity-header">
        <h2 className="home-activity-title" id="home-continue-title">{t.continue_heading}</h2>
      </div>
      <a className="home-continue-link" href={href} aria-label={interpolate(t.continue_play, { title: card.title })}>
        <span className="home-continue-thumb">
          {thumb
            ? <img src={thumb} alt="" width={320} height={180} loading="eager" fetchPriority="high" decoding="async" />
            : <span className="home-continue-thumb-empty" />}
          <span className="home-continue-play" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="28" height="28"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>
          </span>
          {fraction !== null && (
            <span className="home-continue-progress" aria-hidden="true">
              <span style={{ width: `${(fraction * 100).toFixed(1)}%` }} />
            </span>
          )}
        </span>
        <span className="home-continue-text">
          <span className="home-continue-title">{card.title}</span>
          <span className="home-continue-episode">
            {episodeLine(withheld ? { ...card, episodeTitle: null } : card, t)}
            {spoiler?.hidden && card.episodeTitle && <> <SpoilerInline hidden onReveal={spoiler.onReveal} /></>}
          </span>
          {remaining && <span className="home-continue-remaining">{remaining}</span>}
        </span>
      </a>
    </section>
  );
}

export function AiringTodayCard({ rows, t }: { rows: readonly AiringTodayRow[]; t: HomeStrings }) {
  return (
    <section className="home-rail-card home-airing" aria-labelledby="home-airing-title">
      <div className="home-activity-header">
        <h2 className="home-activity-title" id="home-airing-title">{t.airing_heading}</h2>
      </div>
      {/* Fixed-height box (home.css): the card below never moves, whether
          today has no episodes or many — extra rows scroll inside. */}
      <div className="home-airing-box">
        {rows.length === 0
          ? <p className="home-airing-empty">{t.airing_empty}</p>
          : (
            <ul className="home-airing-list">
              {rows.map(row => (
                <li key={row.externalId}>
                  <a className="home-airing-row" href={`/media?id=${encodeURIComponent(row.externalId)}`}>
                    {row.coverUrl
                      ? <CoverImage externalId={row.externalId} className="home-airing-cover" src={wrapAssetUrl(toSmallCover(row.coverUrl))} alt="" width={30} height={43} decoding="async" />
                      : <span className="home-airing-cover" />}
                    <span className="home-airing-text">
                      <span className="home-airing-title">{row.title}</span>
                      <span className="home-airing-meta">
                        <span>{row.episode !== null ? interpolate(t.airing_episode, { episode: row.episode }) : t.airing_premiere}</span>
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
      </div>
    </section>
  );
}

export function HomeRail() {
  const t = getT().home;
  const { evaluator, pending, isRevealed, reveal } = useSpoilerShield();
  const [initial] = useState(() => readHomeSnapshot());
  const [card, setCard] = useState<ContinueCardData | null>(initial?.continueWatching ?? null);
  const [airing, setAiring] = useState<AiringTodayRow[]>(() => snapshotAiring(initial, new Date()) ?? []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadHomeData(), getContinueWatchingSources()]).then(([{ items, catalog }, sources]) => {
      if (cancelled) return;
      const catalogMap = new Map(catalog.map(row => [row.external_id, row]));
      const entries = new Map(items.map(item => [item.external_id, item]));
      // Filler map: loaded with the home data (library-data-cache).
      const picked = pickLastWatched(sources, (id, finished) => {
        const info = getLoadedFillerInfo(id);
        const total = catalogMap.get(id)?.total_count;
        return skipsFiller(entries.get(id), info, total)
          ? nextCanonEpisode(finished, info, total).episode ?? finished + 1
          : finished + 1;
      });
      const row = picked ? catalogMap.get(picked.externalId) : undefined;
      const freshCard: ContinueCardData | null = picked
        ? {
          ...picked,
          title: row?.title_main ?? picked.externalId,
          mediaType: entries.get(picked.externalId)?.type ?? row?.type ?? picked.externalId.split(':')[0],
          coverUrl: row?.cover_url ?? null,
        }
        : null;

      // The same per-day data the calendar's "Para ti" cell for today shows.
      const today = new Date();
      const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const freshAiring = airingToday(
        readLibraryAiringSchedule(),
        computeUpcomingPlanningReleases(items, catalogMap, startOfToday),
        today,
        id => (entries.has(id) ? { title: catalogMap.get(id)?.title_main ?? id, coverUrl: catalogMap.get(id)?.cover_url ?? null } : null),
      );

      setCard(prev => (sameCard(prev, freshCard) ? prev : freshCard));
      setAiring(prev => (sameIds(prev, freshAiring, r => `${r.externalId}|${r.episode}`) ? prev : freshAiring));
      updateHomeSnapshot({ continueWatching: freshCard, airingDate: localDateKey(today), airing: freshAiring });
    });
    return () => { cancelled = true; };
  }, []);

  // The next episode after a finished one is still ahead of the user: its
  // title and still stay hidden while its work is under the shield. An
  // episode stopped halfway was already seen up to there.
  const continueSpoiler = (current: ContinueCardData): ContinueEpisodeSpoiler | undefined => {
    if (current.positionSeconds > 0) return undefined;
    const key = spoilerItemKey.continueEpisode(current.externalId, current.episodeNumber);
    const hidden = !!evaluator && !isRevealed(key)
      && evaluator.isEpisodeHidden({ external_id: current.externalId, episode_number: current.episodeNumber }, current.externalId, new Map());
    return { pending, hidden, onReveal: () => reveal(key) };
  };

  return (
    <>
      <AiringTodayCard rows={airing} t={t} />
      {card && <ContinueWatchingCard card={card} t={t} spoiler={continueSpoiler(card)} />}
    </>
  );
}
