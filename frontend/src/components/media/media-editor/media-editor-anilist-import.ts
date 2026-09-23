import type { Dispatch } from 'react';
import type { EntryAction, UiAction, LogState } from '../../../lib/media/editor/library-log-state';
import type { SagaEntry } from '../../../lib/anilist/saga';
import { fetchAniListLogData } from '../../../lib/media/anilist-sync';

// Pulls this user's AniList progress onto the active log. On the unified
// general tab every season in the chain is fetched at once and applied as one
// bulk update, so a partially-failing chain still imports what it could.
export async function importLogsFromAniList(
  { isGeneralTab, animeSeasonChain, mediaType, activeLogId, externalId, dispatchEntry, dispatchUi }: {
    isGeneralTab: boolean;
    animeSeasonChain: SagaEntry[];
    mediaType: string;
    activeLogId: string;
    externalId: string;
    dispatchEntry: Dispatch<EntryAction>;
    dispatchUi: Dispatch<UiAction>;
  },
): Promise<void> {
  dispatchUi({ type: 'SET_ANILIST_IMPORT', status: 'syncing' });

  if (isGeneralTab && animeSeasonChain.length > 0) {
    try {
      const results = await Promise.all(
        animeSeasonChain.map(s => fetchAniListLogData(s.externalId, mediaType))
      );
      const updatesById: Record<string, Partial<LogState>> = {};
      let anySuccess = false;
      results.forEach((res, idx) => {
        if (res.ok && res.data) {
          anySuccess = true;
          const { status, rating, progress, progressVolumes, startedAt, finishedAt, notes } = res.data;
          updatesById[animeSeasonChain[idx].externalId] = {
            status, rating, progress, progressCount2: progressVolumes, startedAt, finishedAt, notes,
          };
        }
      });

      if (!anySuccess) {
        const firstError = results.find(r => !r.ok)?.error;
        dispatchUi({ type: 'SET_ANILIST_IMPORT', status: 'error', error: firstError });
        return;
      }

      dispatchEntry({ type: 'UPDATE_LOGS_BULK', updatesById });
      dispatchUi({ type: 'SET_ANILIST_IMPORT', status: 'ok' });
      setTimeout(() => dispatchUi({ type: 'SET_ANILIST_IMPORT', status: 'idle' }), 3000);
    } catch (err) {
      dispatchUi({ type: 'SET_ANILIST_IMPORT', status: 'error', error: String(err) });
    }
    return;
  }

  const targetId = activeLogId && !activeLogId.startsWith('general:') ? activeLogId : externalId;

  const result = await fetchAniListLogData(targetId, mediaType);
  if (!result.ok || !result.data) {
    dispatchUi({ type: 'SET_ANILIST_IMPORT', status: 'error', error: result.error });
    return;
  }
  const { status, rating, progress, progressVolumes, startedAt, finishedAt, notes } = result.data;
  // UPDATE_LOGS_BULK (keyed explicitly by targetId) instead of UPDATE_LOG
  // (which always writes to whatever state.activeLogId is AT DISPATCH
  // TIME) — this fetch is async, so if the user switches tabs while it's
  // in flight, UPDATE_LOG would silently write this response onto
  // whichever OTHER tab they'd switched to by the time it resolved,
  // instead of the one it was actually fetched for.
  dispatchEntry({
    type: 'UPDATE_LOGS_BULK',
    updatesById: { [targetId]: { status, rating, progress, progressCount2: progressVolumes, startedAt, finishedAt, notes } },
  });
  dispatchUi({ type: 'SET_ANILIST_IMPORT', status: 'ok' });
  setTimeout(() => dispatchUi({ type: 'SET_ANILIST_IMPORT', status: 'idle' }), 3000);
}
