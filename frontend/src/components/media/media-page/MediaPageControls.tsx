import { Fragment, useState } from 'react';
import type { Translations } from '../../../i18n/index';
import { STAR_PATH } from '../../../lib/media/constants';
import { dbRatingToStars5 } from '../../../lib/media/rating-utils';
import { IconTrayStatus } from '../../local/ui/icons';

export function StarRating({
  rating,
  onRate,
  t,
}: {
  rating: number;           // 0-10 DB scale
  onRate: (stars: number) => void;  // 0.5-5 display scale
  t: Translations['media'];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const display = hover ?? dbRatingToStars5(rating);
  const starsAria = (count: number) => t.stars_aria.replace('{count}', String(count));

  return (
    <div className="media-library-rating" onMouseLeave={() => setHover(null)}>
      {[1, 2, 3, 4, 5].map(v => {
        const isFull = display >= v;
        const isHalf = !isFull && display >= v - 0.5;

        return (
          <div key={v} className="star-container">
            <svg className="star-icon star-empty" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d={STAR_PATH} />
            </svg>
            <div
              className="star-filled-wrap page-star-fill"
              style={{ width: isFull ? '100%' : isHalf ? '50%' : '0%' }}
            >
              <svg className="star-icon star-filled" viewBox="0 0 24 24" fill="currentColor">
                <path d={STAR_PATH} />
              </svg>
            </div>
            <button
              type="button"
              className="star-zone zone-left"
              aria-label={starsAria(v - 0.5)}
              onMouseEnter={() => setHover(v - 0.5)}
              onClick={() => onRate(v - 0.5)}
            />
            <button
              type="button"
              className="star-zone zone-right"
              aria-label={starsAria(v)}
              onMouseEnter={() => setHover(v)}
              onClick={() => onRate(v)}
            />
          </div>
        );
      })}
    </div>
  );
}

export function StatusDropdown({
  status,
  progressStatus,
  progressLabel,
  onChange,
  t,
}: {
  status: string;
  progressStatus: string;
  progressLabel: string;
  onChange: (next: string) => void;
  t: Translations['media'];
}) {
  const te = t.editor;
  const trayButtons = [
    { s: 'planning',     label: te.status_planning },
    { s: progressStatus, label: progressLabel },
    { s: 'completed',    label: te.status_completed },
    { s: 'paused',       label: te.status_paused },
    { s: 'dropped',      label: te.status_dropped },
  ];

  return (
    <div className="media-status-dropdown-container">
      <button
        className={`status-dropdown-trigger${status ? ` text-${status}` : ''}`}
        aria-label={t.change_status_aria}
      >
        <IconTrayStatus status={status} />
      </button>
      <div className="status-dropdown-tray">
        {trayButtons.map(btn => (
          <button
            key={btn.s}
            type="button"
            className={`tray-status-btn${status === btn.s ? ' active' : ''}`}
            data-status={btn.s}
            title={btn.label}
            onClick={e => {
              e.stopPropagation();
              onChange(status === btn.s ? '' : btn.s);
            }}
          >
            <IconTrayStatus status={btn.s} />
          </button>
        ))}
      </div>
    </div>
  );
}

// Shared "tabs vs. plain label" section header — a section's label becomes a
// row of switchable tabs once there's more than one thing to show (Related/
// Editions/Recommended, Personajes/Staff), falling back to a single static
// label + line otherwise. `tabs` must already be pre-filtered to only the
// ones actually visible right now (a tab always renders once included).

interface SectionTab {
  key: string;
  label: string;
  active: boolean;
  onClick: () => void;
}

export function SectionTabs({ tabs, fallbackLabel }: { tabs: SectionTab[]; fallbackLabel: string }) {
  if (tabs.length === 0) {
    return (
      <>
        <p className="section-label">{fallbackLabel}</p>
        <div className="media-section-header-line" />
      </>
    );
  }
  return (
    <>
      {tabs.map((tab, i) => (
        <Fragment key={tab.key}>
          <button
            type="button"
            className={`section-label section-label--tab${tab.active ? ' active' : ''}`}
            onClick={tab.onClick}
          >
            {tab.label}
          </button>
          <div className={`media-section-header-line${i < tabs.length - 1 ? ' media-section-header-line--short' : ''}`} />
        </Fragment>
      ))}
    </>
  );
}
