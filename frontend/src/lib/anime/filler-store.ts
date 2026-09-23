// The library-wide filler map (profile stats, library grid, home, backlog,
// local playback, saga completion): ONE filler_get_info call for every
// stored link, memoised until a link or a show changes
// (FILLER_INFO_CHANGED_EVENT) or the library reloads. The pure helpers in
// ./filler.ts then read it synchronously through getLoadedFillerInfo — no
// per-entry IPC. Kept apart from ./filler-data.ts (the media page's
// resolving/auto-linking) so the stats modules don't import all of that.

import { getFillerInfo, type FillerInfoRow } from '../tauri/anime-filler';
import { toFillerInfo, type FillerInfo } from './filler';

export const FILLER_INFO_CHANGED_EVENT = 'metadea:filler-info-changed';

let allInfo: Promise<Map<string, FillerInfo>> | null = null;
let loadedInfo: ReadonlyMap<string, FillerInfo> = new Map();

export function fillerRowsToMap(rows: readonly FillerInfoRow[]): Map<string, FillerInfo> {
  const map = new Map<string, FillerInfo>();
  for (const row of rows) {
    const info = toFillerInfo(row);
    if (info) map.set(info.externalId, info);
  }
  return map;
}

/** Every linked entry's filler info, one IPC call per visit. */
export function loadAllFillerInfo(): Promise<Map<string, FillerInfo>> {
  if (!allInfo) {
    const pending = getFillerInfo()
      .then(rows => {
        const map = fillerRowsToMap(rows);
        if (allInfo === pending) loadedInfo = map;
        return map;
      })
      .catch(() => {
        if (allInfo === pending) allInfo = null;
        return new Map<string, FillerInfo>();
      });
    allInfo = pending;
  }
  return allInfo;
}

/** Synchronous read of what loadAllFillerInfo last loaded. */
export function getLoadedFillerInfo(externalId: string): FillerInfo | undefined {
  return loadedInfo.get(externalId);
}

export function notifyFillerInfoChanged(): void {
  allInfo = null;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(FILLER_INFO_CHANGED_EVENT));
}

