// Queue navigation helpers shared by the overlay UI and playback-service.
// Paths are compared by basename, case-insensitively.

export function fileBasename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function isSameFile(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return fileBasename(a).toLowerCase() === fileBasename(b).toLowerCase();
}

export function findQueueIndexByPath(queuePaths: readonly string[], path: string | null | undefined): number {
  if (!path) return -1;
  return queuePaths.findIndex(candidate => isSameFile(candidate, path));
}

export function nextQueueIndex(index: number, length: number): number | null {
  if (length <= 0) return null;
  return index < length - 1 ? index + 1 : null;
}

export function prevQueueIndex(index: number, length: number): number | null {
  if (length <= 0) return null;
  return index > 0 ? index - 1 : null;
}

export function clampQueueIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(0, Math.trunc(index)), length - 1);
}

// The heading shown over the video: work title, then the episode's own
// title when there is one, else its label (S01E03, M01, ...).
export function queueEntryHeading(
  workName: string,
  index: number,
  titles: readonly string[],
  labels: readonly string[],
): string {
  const title = titles[index]?.trim();
  const label = labels[index]?.trim();
  const detail = title || label;
  return detail ? `${workName} · ${detail}` : workName;
}
