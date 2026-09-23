// MediaEditorModal's persistence sequence: the per-log write loop, the
// monthly-history/favorites writes and the journey event. The AniList sync
// and modal-closing that follow it stay in the component.
import { saveLibraryEntry, writeMonthlyHistory, syncFavorites } from '../../../lib/tauri';
import type { LibraryEntry } from '../../../lib/tauri';
import { createDefaultLog, type LogState } from '../../../lib/media/editor/library-log-state';
import type { SagaEntry } from '../../../lib/anilist/saga';

export interface SaveMediaEditorLogsParams {
  logs: Record<string, LogState>;
  monthlyHistory: Record<string, string[]>;
  activeLog: LogState;
  externalId: string;
  baseId: string;
  type: string;
  totalCount?: number | null;
  animeSeasonChain: SagaEntry[];
}

export async function saveMediaEditorLogs({
  logs, monthlyHistory, activeLog, externalId, baseId, type, totalCount, animeSeasonChain,
}: SaveMediaEditorLogsParams): Promise<LibraryEntry | null> {
  // Editing a version's own page IS the intent to link it to its base -
  // don't require the user to have clicked through the Log tab switcher
  // for that link to actually get persisted.
  let logsToSave = logs;
  if (externalId !== baseId) {
    const baseLog = logsToSave[baseId] || createDefaultLog();
    const linkedIds = baseLog.selectedVersion ? baseLog.selectedVersion.split(',') : [];
    if (!linkedIds.includes(externalId)) {
      const nextSelectedVersion = [...linkedIds, externalId].join(',');
      logsToSave = { ...logsToSave, [baseId]: { ...baseLog, selectedVersion: nextSelectedVersion } };
    }
  }

  let primarySaved: LibraryEntry | null = null;

  for (const [logId, entryLog] of Object.entries(logsToSave)) {
    if (logId.startsWith('general:')) {
      const rootId = animeSeasonChain[0]?.externalId;
      if (rootId) {
        if (entryLog.rating > 0) {
          localStorage.setItem(`general_rating:${rootId}`, String(entryLog.rating));
        } else {
          localStorage.removeItem(`general_rating:${rootId}`);
        }
      }
      continue;
    }

    const isBase = logId === baseId;
    const hasLink = isBase && !!entryLog.selectedVersion;

    const isEmpty =
      !entryLog.status &&
      entryLog.rating === 0 &&
      entryLog.rating2 === 0 &&
      entryLog.progress === 0 &&
      !entryLog.notes &&
      !entryLog.isFavorite &&
      !entryLog.isPlatinum &&
      entryLog.tags.length === 0 &&
      !entryLog.platform &&
      !entryLog.startedAt &&
      !entryLog.finishedAt &&
      !hasLink;

    if (isEmpty && !entryLog.existing) continue;

    const saved = await saveLibraryEntry({
      id:               entryLog.existing?.id ?? '',
      user_id:          'local',
      external_id:      logId,
      // data.type is this MODAL's own media (the one actually open) —
      // correct for logId === baseId/externalId, but wrong for any other
      // log in this same save loop, like a cross-type related work
      // (e.g. a manga's anime adaptation) whose own entry got loaded
      // into `logs` via loadAllVersions' unfiltered relations scan. Its
      // own already-saved type is the source of truth for it; only a
      // genuinely new log (no `existing` row yet — in practice always
      // logId === baseId, since loadAllVersions only ever loads logs
      // for relations that already had a saved entry) falls back to
      // data.type.
      type:             entryLog.existing?.type ?? type,
      status:           entryLog.status || null,
      rating:           entryLog.rating > 0 ? entryLog.rating : null,
      rating_2:         entryLog.rating2 > 0 ? entryLog.rating2 : null,
      progress:         entryLog.progress,
      progress_2:       entryLog.progressCount2,
      minutes_spent:    entryLog.progress * 60,
      is_favorite:      entryLog.isFavorite ? 1 : 0,
      is_platinum:      entryLog.isPlatinum ? 1 : 0,
      tags:             entryLog.tags.length > 0 ? entryLog.tags : null,
      notes:            entryLog.notes.trim() || null,
      added_at:         entryLog.existing?.added_at ?? null,
      updated_at:       null,
      selected_platform: entryLog.platform || null,
      selected_version:  isBase ? (entryLog.selectedVersion || null) : null,
      started_at:       entryLog.startedAt || null,
      finished_at:      entryLog.finishedAt || null,
    });

    if (logId === externalId) {
      primarySaved = saved;
    }
  }

  await writeMonthlyHistory(monthlyHistory);
  await syncFavorites(type, externalId, activeLog.isFavorite)
    .catch(e => console.error('Failed to sync favorites', e));

  try {
    const { logJourneyEvent } = await import('../../../lib/profile/journey');
    if (primarySaved) {
      await logJourneyEvent(activeLog.existing, primarySaved, type, totalCount ?? undefined);
    }
  } catch (e) {
    console.error('Failed to log journey event', e);
  }

  return primarySaved;
}
