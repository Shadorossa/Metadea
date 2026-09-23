import React from 'react';
import type { Translations } from '../../../i18n/index';
import { type LogState, type EntryAction } from '../../../lib/media/editor/library-log-state';
import { HeaderField } from './MediaEditorFields';
import { MIN_DATE_YEAR, clampDateMinYear, clampNotBefore } from './media-editor-helpers';

export function MediaEditorDateFields({
  te, isMovie, isGeneralTab, isUpcoming, startedAt, finishedAt,
  generalStartDate, generalEndDate, activeTotalCount, totalCount2, dispatchEntry,
}: {
  te: Translations['media']['editor'];
  isMovie: boolean;
  isGeneralTab: boolean;
  isUpcoming: boolean;
  startedAt: string;
  finishedAt: string;
  generalStartDate: string;
  generalEndDate: string;
  activeTotalCount: number | null | undefined;
  totalCount2: number | null | undefined;
  dispatchEntry: (action: EntryAction) => void;
}) {
  return (
    <>
      {isMovie ? (
      <HeaderField label={te.view_date}>
        <input type="date" className="me-header-field-input me-header-field-input--date"
          min={`${MIN_DATE_YEAR}-01-01`}
          value={startedAt || finishedAt}
          onChange={e => {
            const val = e.target.value;
            const updates: Partial<LogState> = { startedAt: val, finishedAt: val };
            if (val && !isUpcoming) {
              updates.status = 'completed';
              if (activeTotalCount && activeTotalCount > 0) updates.progress = activeTotalCount;
              if (totalCount2 && totalCount2 > 0) updates.progressCount2 = totalCount2;
            }
            dispatchEntry({ type: 'UPDATE_LOG', updates });
          }}
          onBlur={e => {
            const val = clampDateMinYear(e.target.value);
            if (val !== e.target.value) dispatchEntry({ type: 'UPDATE_LOG', updates: { startedAt: val, finishedAt: val } });
          }} />
      </HeaderField>
    ) : (
      <>
        <HeaderField label={te.started}>
          <input type="date" className="me-header-field-input me-header-field-input--date"
            min={`${MIN_DATE_YEAR}-01-01`}
            max={finishedAt || undefined}
            disabled={isGeneralTab}
            value={isGeneralTab ? generalStartDate : startedAt}
            onChange={e => dispatchEntry({ type: 'UPDATE_LOG', updates: { startedAt: e.target.value } })}
            onBlur={e => {
              const val = clampDateMinYear(e.target.value);
              const updates: Partial<LogState> = {};
              if (val !== e.target.value) updates.startedAt = val;
              if (finishedAt && val > finishedAt) updates.finishedAt = val;
              if (Object.keys(updates).length > 0) dispatchEntry({ type: 'UPDATE_LOG', updates });
            }} />
        </HeaderField>
        <HeaderField label={te.ended}>
          <input type="date" className="me-header-field-input me-header-field-input--date"
            min={startedAt || `${MIN_DATE_YEAR}-01-01`}
            disabled={isGeneralTab}
            value={isGeneralTab ? generalEndDate : finishedAt}
            onChange={e => {
              const val = e.target.value;
              const updates: Partial<LogState> = { finishedAt: val };
              if (val && !isUpcoming) {
                updates.status = 'completed';
                if (activeTotalCount && activeTotalCount > 0) updates.progress = activeTotalCount;
                if (totalCount2 && totalCount2 > 0) updates.progressCount2 = totalCount2;
              }
              dispatchEntry({ type: 'UPDATE_LOG', updates });
            }}
            onBlur={e => {
              const val = clampNotBefore(clampDateMinYear(e.target.value), startedAt);
              if (val !== e.target.value) dispatchEntry({ type: 'UPDATE_LOG', updates: { finishedAt: val } });
            }} />
        </HeaderField>
      </>
    )}
    </>
  );
}
