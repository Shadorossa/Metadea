import { tauriCmd, invoke } from './bridge';

// Break reminder and clock alerts while a game runs (src-tauri/src/
// game_break_reminder.rs). Rust schedules them and shows the toast.
export interface ClockAlert {
  /** "HH:MM", 24 h, local time. */
  time: string;
  weekdaysOnly: boolean;
}

export interface BreakReminderSettings {
  /** 0 = off; otherwise 30–720. */
  intervalMinutes: number;
  clockAlerts: ClockAlert[];
}

export async function getBreakReminderSettings(): Promise<BreakReminderSettings> {
  return tauriCmd<BreakReminderSettings>('get_break_reminder_settings', { intervalMinutes: 0, clockAlerts: [] });
}

/** Saves and returns what Rust stored (clamped, sorted, at most 6 alerts). */
export async function setBreakReminderSettings(settings: BreakReminderSettings): Promise<BreakReminderSettings> {
  return invoke<BreakReminderSettings>('set_break_reminder_settings', { settings });
}
