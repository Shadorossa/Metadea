// Pure mapping between the Backup tab's controls and what the Rust side
// stores (src-tauri/src/google_drive/schedule.rs): schedule values, the
// "keep last N" bounds, byte sizes and which i18n label a progress phase uses.

export const DRIVE_SCHEDULES = ['off', 'daily', 'weekly'] as const;
export type DriveSchedule = typeof DRIVE_SCHEDULES[number];

/** Same bounds as `schedule::clamp_keep_last` in Rust. */
export const KEEP_LAST_MIN = 1;
export const KEEP_LAST_MAX = 50;
export const KEEP_LAST_DEFAULT = 5;

export function parseSchedule(value: string | null | undefined): DriveSchedule {
  return (DRIVE_SCHEDULES as readonly string[]).includes(value ?? '') ? (value as DriveSchedule) : 'off';
}

/** Input value → a valid "keep last N"; anything unparseable falls back to the default. */
export function parseKeepLast(value: string | number | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return KEEP_LAST_DEFAULT;
  return Math.min(KEEP_LAST_MAX, Math.max(KEEP_LAST_MIN, Math.trunc(parsed)));
}

export type ScheduleLabelKey = 'schedule_off' | 'schedule_daily' | 'schedule_weekly';

export function scheduleLabelKey(schedule: DriveSchedule): ScheduleLabelKey {
  return `schedule_${schedule}`;
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** 1536 → "1.5 KB" (binary multiples, one decimal from KB up). */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} ${UNITS[0]}` : `${value.toFixed(1)} ${UNITS[unit]}`;
}

export type ProgressLabelKey =
  | 'phase_snapshot' | 'phase_hashing' | 'phase_compress' | 'phase_extract'
  | 'phase_safety_backup' | 'phase_upload' | 'phase_download' | 'phase_done';

const PHASES = ['snapshot', 'hashing', 'compress', 'extract', 'safety_backup', 'upload', 'download', 'done'] as const;

/** i18n key (under `backup.`) of a `backup://progress` phase; unknown phases read as "working". */
export function progressLabelKey(phase: string): ProgressLabelKey | 'phase_working' {
  return (PHASES as readonly string[]).includes(phase) ? (`phase_${phase}` as ProgressLabelKey) : 'phase_working';
}

/** Percent for a `<progress>`/bar width: clamped, whole numbers. */
export function progressPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.round(Math.min(100, Math.max(0, percent)));
}

/** Error codes that mean the Drive link itself is gone and needs redoing. */
export function needsRelink(error: string | null | undefined): boolean {
  return !!error && (error.startsWith('E_GDRIVE_AUTH') || error.startsWith('E_GDRIVE_NOT_LINKED'));
}
