import React from 'react';
import { Repeat } from 'lucide-react';
import { type LogState, type EntryAction } from '../../../lib/media/editor/library-log-state';
import {
  canStartReconsumptionRun, startReconsumptionRun, cancelReconsumptionRun, clampReconsumptionCount,
} from '../../../lib/media/editor/reconsumption-run';
import type { SeasonMeta } from './media-editor-load';

// The "re-watching / re-reading / re-playing" toggle + "×N" stepper that sit
// next to the status buttons. Absent on the general tab (the aggregate has
// no row of its own to count on).
export interface ReconsumptionControls {
  count: number;
  reconsuming: boolean;
  /** Status the toggle switches to: watching / reading / playing. */
  inProgressStatus: string;
  toggleLabel: string;
  countLabel: string;
}

export function MediaEditorStatusRow({
  statusButtons, status, isGeneralTab, generalStatus, isUpcoming, unifiedSeasonIds,
  seasonMetaMap, activeTotalCount, totalCount2, dispatchEntry, reconsumption,
}: {
  statusButtons: { value: string; label: string; Icon: React.ComponentType }[];
  status: string;
  isGeneralTab: boolean;
  generalStatus: string;
  isUpcoming: boolean;
  unifiedSeasonIds: string[];
  seasonMetaMap: Record<string, SeasonMeta>;
  activeTotalCount: number | null | undefined;
  totalCount2: number | null | undefined;
  dispatchEntry: (action: EntryAction) => void;
  reconsumption?: ReconsumptionControls;
}) {
  const showReconsumption = !!reconsumption && !isGeneralTab && !isUpcoming;
  const canToggleReconsumption = !!reconsumption
    && (reconsumption.reconsuming || canStartReconsumptionRun({ status, reconsuming: reconsumption.reconsuming }));

  return (
    <div className="me-header-status-row">
      {statusButtons.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          className={`me-header-status-icon${(isGeneralTab ? generalStatus : status) === value ? ' active' : ''}`}
          // The general tab's status is always the auto-derived
          // aggregate (see generalStatus) - every button except
          // "completed" is inert there, since only "I finished
          // the whole thing" is a real bulk action; the other
          // four states already come from whichever season
          // actually has them, so clicking them here would have
          // nothing real to write.
          //
          // Nothing not yet released can honestly be completed/
          // dropped/paused/in-progress — only "planning" (queued
          // up for whenever it comes out) makes sense.
          disabled={(isGeneralTab && value !== 'completed') || (isUpcoming && value !== 'planning')}
          onClick={() => {
            if (isGeneralTab) {
              if (value !== 'completed') return;
              const updatesById: Record<string, Partial<LogState>> = {};
              for (const id of unifiedSeasonIds) {
                const seasonTotal = seasonMetaMap[id]?.totalCount;
                const su: Partial<LogState> = { status: 'completed' };
                if (seasonTotal && seasonTotal > 0) su.progress = seasonTotal;
                updatesById[id] = su;
              }
              dispatchEntry({ type: 'UPDATE_LOGS_BULK', updatesById });
              return;
            }
            const next = status === value ? '' : value;
            const updates: Partial<LogState> = { status: next };
            if (value === 'completed' && next === 'completed') {
              if (activeTotalCount && activeTotalCount > 0) updates.progress = activeTotalCount;
              if (totalCount2 && totalCount2 > 0) updates.progressCount2 = totalCount2;
            }
            dispatchEntry({ type: 'UPDATE_LOG', updates });
          }}
          title={label}
        >
          <Icon />
        </button>
      ))}
      {showReconsumption && reconsumption && (
        <span className="me-header-reconsumption">
          <button
            type="button"
            className={`me-header-status-icon me-header-reconsumption-toggle${reconsumption.reconsuming ? ' active' : ''}`}
            // Only a finished work can be started over; while a re-run is
            // on, the same button cancels it (back to completed, uncounted).
            // Completing the re-run again is what actually counts it — see
            // save_library_entry in user_library.rs.
            disabled={!canToggleReconsumption}
            aria-pressed={reconsumption.reconsuming}
            aria-label={reconsumption.toggleLabel}
            title={reconsumption.toggleLabel}
            onClick={() => {
              const updates = reconsumption.reconsuming
                ? cancelReconsumptionRun({ totalCount: activeTotalCount, totalCount2 })
                : startReconsumptionRun(reconsumption.inProgressStatus);
              dispatchEntry({ type: 'UPDATE_LOG', updates });
            }}
          >
            <Repeat size={14} aria-hidden="true" />
          </button>
          <label className="me-header-reconsumption-count" title={reconsumption.countLabel}>
            <span aria-hidden="true">×</span>
            <input
              type="number"
              className="me-header-field-input me-header-field-input--number"
              min={0}
              step={1}
              aria-label={reconsumption.countLabel}
              value={reconsumption.count}
              onChange={e => dispatchEntry({
                type: 'UPDATE_LOG',
                updates: { reconsumptionCount: clampReconsumptionCount(parseInt(e.target.value, 10)) },
              })}
            />
          </label>
        </span>
      )}
    </div>
  );
}
