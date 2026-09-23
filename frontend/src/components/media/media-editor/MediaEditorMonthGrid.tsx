import React from 'react';
import type { Translations } from '../../../i18n/index';
import type { EntryAction } from '../../../lib/media/editor/library-log-state';
import type { MonthMediaInfo } from './media-editor-load';

export function MediaEditorMonthGrid({
  te, selectedYear, monthlyHistory, monthlyHistoryIds, monthMediaInfo, selectedMonthKey,
  dispatchEntry, handleMonthClick,
}: {
  te: Translations['media']['editor'];
  selectedYear: number;
  monthlyHistory: Record<string, string[]>;
  monthlyHistoryIds: Set<string>;
  monthMediaInfo: MonthMediaInfo;
  selectedMonthKey: string | null;
  dispatchEntry: (action: EntryAction) => void;
  handleMonthClick: (monthIndex: number) => void;
}) {
  return (
    <div className="me-month-selector-section">
      <div className="me-month-header">
        <span className="me-label">{te.history_month}</span>
        <div className="me-year-selector">
          <button type="button" className="me-year-arrow"
            onClick={() => dispatchEntry({ type: 'SET_YEAR', delta: -1 })}>&lt;</button>
          <span className="me-year-val">{selectedYear}</span>
          <button type="button" className="me-year-arrow"
            onClick={() => dispatchEntry({ type: 'SET_YEAR', delta: 1 })}>&gt;</button>
        </div>
      </div>
      <div className="me-month-grid">
        {te.months.map((mName, idx) => {
          const mNumber = idx + 1;
          const key = `${selectedYear}-${String(mNumber).padStart(2, '0')}`;
          const isSelected = selectedMonthKey === key;
          // Only one entry can claim each month. A season tab owns
          // only its season id, so sibling seasons remain distinct
          // and can be assigned to different months.
          const monthIds = monthlyHistory[key] ?? [];
          const takenBy = monthIds.find(id => !monthlyHistoryIds.has(id));
          const occupantId = takenBy ?? monthIds.find(id => monthlyHistoryIds.has(id));
          const occupant = occupantId ? monthMediaInfo[occupantId] : undefined;
          return (
            <button key={key} type="button"
              className={`me-month-btn${isSelected ? ' active' : ''}${takenBy ? ' me-month-btn--taken' : ''}${occupant?.cover ? ' me-month-btn--has-cover' : ''}`}
              disabled={!!takenBy}
              title={takenBy ? `${te.month_taken}${occupant ? `: ${occupant.title}` : ''}` : undefined}
              onClick={() => handleMonthClick(mNumber)}>
              {occupant?.cover && (
                <>
                  {/* Blurred, cover-cropped backdrop fills the whole
                      card (no dead space) — the sharp <img> on top,
                      sized with object-fit:contain, shows the full
                      poster undistorted instead of a hard crop,
                      since posters are portrait and this card is a
                      short rectangle. */}
                  <div className="me-month-btn-backdrop" style={{ backgroundImage: `url('${occupant.cover}')` }} />
                  <img className="me-month-btn-cover-img" src={occupant.cover} alt="" />
                </>
              )}
              <span className="me-month-btn-label">{mName}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
