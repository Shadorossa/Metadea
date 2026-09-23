import React from 'react';
import { type LogState, type EntryAction } from '../../../lib/media/editor/library-log-state';
import type { SeasonMeta } from './media-editor-load';

export function MediaEditorStatusRow({
  statusButtons, status, isGeneralTab, generalStatus, isUpcoming, unifiedSeasonIds,
  seasonMetaMap, activeTotalCount, totalCount2, dispatchEntry,
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
}) {
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
    </div>
  );
}
