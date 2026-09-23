// "On this day" on Home: works you first finished on today's date in an
// earlier year. Sits at the top of the side column, above (and exactly as
// wide as) "Recent activity", with the same section header, and shows a
// row of medium covers — year and "N years ago" under each, title on hover.
// Each cover glows behind its own slot (a blurred, blown-up copy of it), the
// covers tilt toward the pointer and catch a shine sweep, and a few slow
// sparkles drift around them; all motion is off under reduced motion
// (home.css). Reads the cached library/catalog bundle CurrentlySection also
// uses (no extra IPC) and renders nothing when there is no anniversary.
//
// First paint comes from the Home snapshot (lib/home/home-snapshot.ts) so
// the block is there immediately; the live bundle then reconciles it.
import { useEffect, useState, type PointerEvent } from 'react';
import { getLangCode, getT } from '../../i18n/runtime';
import { loadHomeData } from '../../lib/home/home-data';
import { findFinishAnniversaries, type FinishAnniversaryItem } from '../../lib/home/finish-anniversaries';
import {
  libraryVersion,
  localDateKey,
  readHomeSnapshot,
  sameIds,
  snapshotAnniversary,
  updateHomeSnapshot,
} from '../../lib/home/home-snapshot';
import { toMediumCover } from '../../lib/media/small-cover';
import { interpolate } from '../../lib/shared/text/interpolate';
import { wrapAssetUrl } from '../../lib/tauri/bridge';

export const MAX_VISIBLE_ANNIVERSARIES = 8;
// Rendered cover box (CSS --home-anniv-card-w and aspect 90/130), also given
// to the <img> as width/height so nothing reflows while covers load.
const COVER_W = 66;
const COVER_H = 95;
const MAX_TILT_DEG = 12;
// Sparkle positions (% of the stage) and loop offsets — fixed, so every
// render lays them out the same.
const SPARKLES: ReadonlyArray<{ x: number; y: number; delay: number; big?: boolean }> = [
  { x: 6, y: 18, delay: 0 }, { x: 14, y: 72, delay: 2.1, big: true }, { x: 23, y: 34, delay: 4.3 },
  { x: 31, y: 84, delay: 1.2 }, { x: 42, y: 10, delay: 3.4, big: true }, { x: 51, y: 62, delay: 5.2 },
  { x: 59, y: 26, delay: 0.7 }, { x: 67, y: 82, delay: 2.8 }, { x: 76, y: 14, delay: 4.9, big: true },
  { x: 84, y: 54, delay: 1.7 }, { x: 92, y: 30, delay: 3.9 }, { x: 96, y: 78, delay: 0.3 },
];

export interface FinishAnniversaryStrings {
  anniversary_heading: string;
  anniversary_years_ago_one: string;
  anniversary_years_ago_other: string;
  anniversary_more: string;
}

interface StripProps {
  /** Display order: most years ago first, then title (findFinishAnniversaries' groups, flattened). */
  items: readonly FinishAnniversaryItem[];
  strings: FinishAnniversaryStrings;
  lang: string;
  today: Date;
  /** Fade in (opacity only) — for content that arrives after first paint. */
  fadeIn?: boolean;
}

function yearsAgoLabel(yearsAgo: number, strings: FinishAnniversaryStrings, lang: string): string {
  let one = yearsAgo === 1;
  try { one = new Intl.PluralRules(lang).select(yearsAgo) === 'one'; } catch { /* keep the n === 1 guess */ }
  return interpolate(one ? strings.anniversary_years_ago_one : strings.anniversary_years_ago_other, { n: yearsAgo });
}

function formatDay(today: Date, lang: string): string {
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  try {
    return new Intl.DateTimeFormat(lang, options).format(today);
  } catch {
    return today.toLocaleDateString(undefined, options);
  }
}

// Pointer-following 3D tilt: only sets two CSS variables; home.css turns
// them into the transform (and ignores them under reduced motion).
function tiltToPointer(event: PointerEvent<HTMLElement>) {
  const el = event.currentTarget;
  const box = el.getBoundingClientRect();
  const x = (event.clientX - box.left) / box.width - 0.5;
  const y = (event.clientY - box.top) / box.height - 0.5;
  el.style.setProperty('--tilt-x', `${(-y * MAX_TILT_DEG).toFixed(2)}deg`);
  el.style.setProperty('--tilt-y', `${(x * MAX_TILT_DEG).toFixed(2)}deg`);
}

function resetTilt(event: PointerEvent<HTMLElement>) {
  event.currentTarget.style.removeProperty('--tilt-x');
  event.currentTarget.style.removeProperty('--tilt-y');
}

/** The block's markup — exported so it can be rendered from a fixture. */
export function FinishAnniversaryStrip({ items, strings, lang, today, fadeIn }: StripProps) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;

  const visible = expanded ? items : items.slice(0, MAX_VISIBLE_ANNIVERSARIES);
  const hidden = items.length - visible.length;

  return (
    <section className={`home-anniversary${fadeIn ? ' home-fade-in' : ''}`} aria-labelledby="home-anniversary-title">
      <div className="home-activity-header home-anniversary-header">
        <h2 className="home-activity-title" id="home-anniversary-title">{strings.anniversary_heading}</h2>
        <span className="home-anniversary-date">{formatDay(today, lang)}</span>
      </div>
      <div className="home-anniversary-stage">
        <div className="home-anniversary-sparkles" aria-hidden="true">
          {SPARKLES.map((sparkle, i) => (
            <span
              key={i}
              className={sparkle.big ? 'is-big' : undefined}
              style={{ left: `${sparkle.x}%`, top: `${sparkle.y}%`, animationDelay: `${sparkle.delay}s` }}
            />
          ))}
        </div>
        <ul className="home-anniversary-row">
          {visible.map(item => {
            const ago = yearsAgoLabel(item.yearsAgo, strings, lang);
            const src = item.coverUrl ? wrapAssetUrl(toMediumCover(item.coverUrl)) : null;
            return (
              <li className="home-anniversary-card" key={item.externalId}>
                {src && <img className="home-anniversary-glow" src={src} alt="" aria-hidden="true" decoding="async" />}
                <a
                  className="home-anniversary-link"
                  href={`/media?id=${encodeURIComponent(item.externalId)}`}
                  title={item.title}
                  aria-label={`${item.title} — ${item.year}, ${ago}`}
                  onPointerMove={tiltToPointer}
                  onPointerLeave={resetTilt}
                >
                  <span className="home-anniversary-art">
                    {src
                      ? (
                        <img
                          className="home-anniversary-cover"
                          src={src}
                          alt=""
                          width={COVER_W}
                          height={COVER_H}
                          loading="eager"
                          fetchPriority="high"
                          decoding="async"
                        />
                      )
                      : <span className="home-anniversary-cover home-anniversary-cover--empty">{item.title.slice(0, 2).toUpperCase()}</span>}
                    <span className="home-anniversary-shine" aria-hidden="true" />
                    <span className="home-anniversary-hover-title" aria-hidden="true">{item.title}</span>
                  </span>
                  <span className="home-anniversary-caption" aria-hidden="true">
                    <span className="home-anniversary-caption-year">{item.year}</span>
                    <span className="home-anniversary-caption-ago">{ago}</span>
                  </span>
                </a>
              </li>
            );
          })}
          {hidden > 0 && (
            <li className="home-anniversary-card">
              <button
                type="button"
                className="home-anniversary-more"
                onClick={() => setExpanded(true)}
                title={interpolate(strings.anniversary_more, { count: hidden })}
                aria-label={interpolate(strings.anniversary_more, { count: hidden })}
              >
                +{hidden}
              </button>
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}

export function FinishAnniversaryBanner() {
  const [today] = useState(() => new Date());
  // Synchronous first paint from the snapshot (this island is client:only,
  // so there is no server markup to disagree with).
  const [initial] = useState(() => snapshotAnniversary(readHomeSnapshot(), today));
  const [items, setItems] = useState<FinishAnniversaryItem[]>(initial ?? []);

  useEffect(() => {
    let cancelled = false;
    loadHomeData().then(({ items: library, catalog }) => {
      if (cancelled) return;
      const fresh = findFinishAnniversaries(library, catalog, today).flatMap(group => group.items);
      setItems(prev => (sameIds(prev, fresh, i => `${i.externalId}|${i.coverUrl ?? ''}|${i.title}`) ? prev : fresh));
      updateHomeSnapshot({ date: localDateKey(today), libraryVersion: libraryVersion(library), anniversary: fresh });
    });
    return () => { cancelled = true; };
  }, [today]);

  if (items.length === 0) return null;
  return (
    <FinishAnniversaryStrip
      items={items}
      strings={getT().home}
      lang={getLangCode()}
      today={today}
      fadeIn={initial === null || initial.length === 0}
    />
  );
}
