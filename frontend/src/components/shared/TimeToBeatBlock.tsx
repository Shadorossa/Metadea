import '../../styles/components/time-to-beat.css';
import { useEffect, useRef, useState } from 'react';
import type { Translations } from '../../i18n/index';
import { getLangCode } from '../../i18n/runtime';
import type { TimeToBeat } from '../../lib/tauri/time-to-beat';
import { loadTimeToBeat } from '../../lib/media/time-to-beat-loader';
import {
  beatProgress, formatBeatHours, hasTimeToBeatData, timeToBeatPills, vndbLengthKey, type TimeToBeatKind,
} from '../../lib/media/time-to-beat';

interface Props {
  /** `game:<id>` / `vnovel:<id>`; any other type renders nothing. */
  externalId: string;
  /** Title and release year: how a visual novel is matched on VNDB. */
  title?: string;
  releaseYear?: number;
  /** The user's own playtime (Steam / tracked sessions / logged hours). */
  playedMinutes?: number;
  t: Translations['time_to_beat'];
  /** Layout context: the media page's Datos column or the Local panel. */
  variant: 'media' | 'local';
}

const SOURCE_LABEL: Record<TimeToBeat['source'], string> = { igdb: 'IGDB', vndb: 'VNDB' };

function isTimeToBeatId(externalId: string): boolean {
  return /^(game|vnovel):\d+$/.test(externalId);
}

// "How long to beat": Main story / Main + extras / Completionist pills from
// IGDB (or VNDB's reading time for visual novels), plus progress against
// the main story when the user has playtime. Looked up only once the block
// scrolls into view; hidden entirely when there is nothing known.
export function TimeToBeatBlock({ externalId, title, releaseYear, playedMinutes, t, variant }: Props) {
  const eligible = isTimeToBeatId(externalId);
  const probeRef = useRef<HTMLDivElement>(null);
  const [visibleId, setVisibleId] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; ttb: TimeToBeat | null } | null>(null);

  useEffect(() => {
    const node = probeRef.current;
    if (!eligible || !node) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisibleId(externalId);
        observer.disconnect();
      }
    }, { rootMargin: '200px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [eligible, externalId]);

  useEffect(() => {
    if (visibleId !== externalId) return;
    let cancelled = false;
    loadTimeToBeat({ externalId, title, releaseYear }).then(ttb => {
      if (!cancelled) setResult({ id: externalId, ttb });
    });
    return () => { cancelled = true; };
    // title/year only steer the first lookup of a work; they don't re-key it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleId, externalId]);

  if (!eligible) return null;
  const settled = result?.id === externalId;
  if (!settled) {
    return (
      <div ref={probeRef} className={`ttb-block ttb-block--${variant} ttb-block--loading`} aria-busy="true" aria-label={t.loading}>
        <span className="ttb-skeleton" />
        <span className="ttb-skeleton" />
        <span className="ttb-skeleton" />
      </div>
    );
  }
  const ttb = result.ttb;
  if (!hasTimeToBeatData(ttb)) return null;

  const locale = getLangCode();
  const hours = (seconds: number) => formatBeatHours(seconds / 60, t.hours, locale);
  const pillLabel: Record<TimeToBeatKind, string> = { main: t.main, extra: t.extra, completionist: t.completionist };
  const source = SOURCE_LABEL[ttb.source] ?? ttb.source.toUpperCase();
  const tooltip = ttb.votes
    ? t.source_tooltip.replace('{source}', source).replace('{votes}', ttb.votes.toLocaleString(locale))
    : t.source_tooltip_no_votes.replace('{source}', source);
  const pills = timeToBeatPills(ttb);
  const bucketKey = pills.length === 0 ? vndbLengthKey(ttb.lengthBucket) : null;
  const progress = beatProgress(playedMinutes, ttb.mainSeconds);

  return (
    <div className={`ttb-block ttb-block--${variant}`}>
      <div className="ttb-header">
        <span className="ttb-title">{t.title}</span>
        <span className="ttb-source" title={tooltip}>
          {ttb.source === 'igdb'
            ? <img src="/API/IGDB_logo.png" alt={source} className="ttb-source-logo" />
            : <span className="ttb-source-text">{source}</span>}
        </span>
      </div>
      <div className="ttb-pills" title={tooltip}>
        {pills.map(pill => (
          <span key={pill.kind} className={`ttb-pill ttb-pill--${pill.kind}`}>
            <span className="ttb-pill-label">{pillLabel[pill.kind]}</span>
            <span className="ttb-pill-value">{hours(pill.seconds)}</span>
          </span>
        ))}
        {bucketKey && (
          <span className="ttb-pill ttb-pill--main">
            <span className="ttb-pill-label">{t.length}</span>
            <span className="ttb-pill-value">{t[bucketKey]}</span>
          </span>
        )}
      </div>
      {progress && (
        <div className={`ttb-progress${progress.done ? ' ttb-progress--done' : ''}`}>
          <div className="ttb-progress-text">
            <span>
              {t.progress
                .replace('{played}', formatBeatHours(progress.playedMinutes, t.hours, locale))
                .replace('{total}', formatBeatHours(progress.targetMinutes, t.hours, locale))}
            </span>
            <span className="ttb-progress-remaining">
              {progress.done ? t.done : t.remaining.replace('{time}', formatBeatHours(progress.remainingMinutes, t.hours, locale))}
            </span>
          </div>
          <div
            className="ttb-progress-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress.ratio * 100)}
          >
            <div className="ttb-progress-fill" style={{ width: `${progress.ratio * 100}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
