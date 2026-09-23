// "How you spend your time": one stacked bar per person, segmented by
// medium in the app's type colours (HOF_GRADIENTS). No legend: hovering or
// focusing a segment shows the saga strip's speech-bubble tooltip
// (.saga-strip-format-tooltip) with the medium, its hours and its share.
// Hours are each side's Stats tab numbers (hoursByMedium).
import type { TasteTimeShare } from '../../lib/social/taste-compatibility';
import { HOF_GRADIENTS } from '../../lib/profile/hof';
import { typeLabel } from '../../lib/profile/media-type-label';
import { interpolate } from '../../lib/shared/text/interpolate';
import type { getT } from '../../i18n/runtime';

type S = ReturnType<typeof getT>['social'];

function typeColor(type: string): string {
  return HOF_GRADIENTS[type] ?? 'var(--accent)';
}

function formatHours(hours: number): string {
  return Math.round(hours).toLocaleString();
}

function TimeRow({ who, time, s }: { who: string; time: TasteTimeShare[]; s: S }) {
  const total = time.reduce((acc, t) => acc + t.hours, 0);
  return (
    <div className="taste-time-row">
      <span className="taste-time-who" title={who}>{who}</span>
      <span className="taste-time-track">
        {time.length === 0
          ? <span className="taste-time-empty">{s.taste_time_empty}</span>
          : time.map(t => {
            const label = interpolate(s.taste_time_segment, {
              type: typeLabel(t.type), n: formatHours(t.hours), pct: Math.round(t.share * 100),
            });
            return (
              <span
                key={t.type}
                className="taste-time-segment"
                style={{ flexGrow: t.share, background: typeColor(t.type) }}
                role="img"
                aria-label={label}
                tabIndex={0}
              >
                <span className="saga-strip-format-tooltip" aria-hidden="true">{label}</span>
              </span>
            );
          })}
      </span>
      <span className="taste-time-total">{time.length > 0 ? interpolate(s.taste_time_hours, { n: formatHours(total) }) : '—'}</span>
    </div>
  );
}

export function TasteTimeSplit({ ownTime, theirTime, theirName, s }: {
  ownTime: TasteTimeShare[]; theirTime: TasteTimeShare[]; theirName: string; s: S;
}) {
  return (
    <div className="taste-time">
      <TimeRow who={s.taste_you} time={ownTime} s={s} />
      <TimeRow who={theirName} time={theirTime} s={s} />
    </div>
  );
}
