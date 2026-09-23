//! Break reminder and clock alerts while a game launched from Metadea runs.
//!
//! - Break reminder: every N hours of a session's own running time (paused
//!   intervals excluded, see `game_sessions::set_paused`), one floating toast
//!   suggesting a short break. The next threshold is always computed from
//!   the elapsed time, so a re-attach or a sleep never fires a burst.
//! - Clock alerts: at chosen times of day (HH:MM, optionally weekdays
//!   only), while any session is active: once per day per time, never
//!   retroactively (the session must have been running at that time), and
//!   only within 2 minutes of the target (sleep/resume, DST jumps skip it).
//!
//! Both use the always-on-top toast window (folders/toast_window.rs); the
//! toast page localises the text itself, like the screenshot notice.
//! Settings live in `game_break_settings` (migration 87).

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use chrono::{Datelike, Local, NaiveDate, NaiveDateTime, TimeZone, Weekday};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::db::{MetadeaDb, ToStringErr};
use crate::game_sessions::{active_seconds, now_unix, ActiveSession, GameSessionsState};

pub const MIN_INTERVAL_MINUTES: u32 = 30;
pub const MAX_INTERVAL_MINUTES: u32 = 720;
pub const MAX_CLOCK_ALERTS: usize = 6;
const CLOCK_TOLERANCE_SECS: i64 = 120;
const TICK: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClockAlert {
    /// "HH:MM", 24 h, local time.
    pub time: String,
    #[serde(default)]
    pub weekdays_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct BreakReminderSettings {
    /// 0 = off; otherwise 30–720.
    pub interval_minutes: u32,
    #[serde(default)]
    pub clock_alerts: Vec<ClockAlert>,
}

/// What the toast page shows; it formats and localises it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct GameBreakToastPayload {
    /// "break" or "clock".
    pub kind: &'static str,
    pub title: String,
    pub cover_url: Option<String>,
    pub played_minutes: i64,
    pub started_unix: i64,
    /// Today's total, only when other sessions already ran today.
    pub today_minutes: Option<i64>,
    /// The alert's "HH:MM" (clock alerts).
    pub clock_time: Option<String>,
}

// ─── settings ────────────────────────────────────────────────────────────────

pub(crate) fn parse_clock_time(text: &str) -> Option<(u32, u32)> {
    let (h, m) = text.trim().split_once(':')?;
    let (h, m): (u32, u32) = (h.parse().ok()?, m.parse().ok()?);
    (h < 24 && m < 60).then_some((h, m))
}

/// Clamps the interval (0 stays off), keeps valid, distinct alert times
/// ("7:5" → "07:05"), sorted, at most six.
pub(crate) fn normalize_settings(input: BreakReminderSettings) -> BreakReminderSettings {
    let interval_minutes = if input.interval_minutes == 0 {
        0
    } else {
        input.interval_minutes.clamp(MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES)
    };
    let mut seen = HashSet::new();
    let mut clock_alerts: Vec<ClockAlert> = input
        .clock_alerts
        .into_iter()
        .filter_map(|alert| {
            let (h, m) = parse_clock_time(&alert.time)?;
            let time = format!("{h:02}:{m:02}");
            seen.insert(time.clone()).then_some(ClockAlert { time, weekdays_only: alert.weekdays_only })
        })
        .collect();
    clock_alerts.sort_by(|a, b| a.time.cmp(&b.time));
    clock_alerts.truncate(MAX_CLOCK_ALERTS);
    BreakReminderSettings { interval_minutes, clock_alerts }
}

pub(crate) fn load_settings_in(conn: &Connection) -> rusqlite::Result<BreakReminderSettings> {
    let row: Option<(u32, String)> = conn
        .query_row("SELECT interval_minutes, clock_alerts FROM game_break_settings WHERE id = 1", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .optional()?;
    Ok(row
        .map(|(interval_minutes, alerts)| {
            normalize_settings(BreakReminderSettings {
                interval_minutes,
                clock_alerts: serde_json::from_str(&alerts).unwrap_or_default(),
            })
        })
        .unwrap_or_default())
}

pub(crate) fn save_settings_in(conn: &Connection, settings: &BreakReminderSettings) -> Result<(), String> {
    let alerts = serde_json::to_string(&settings.clock_alerts).str_err()?;
    conn.execute(
        "INSERT INTO game_break_settings (id, interval_minutes, clock_alerts) VALUES (1, ?1, ?2)
         ON CONFLICT(id) DO UPDATE SET interval_minutes = excluded.interval_minutes, clock_alerts = excluded.clock_alerts",
        rusqlite::params![settings.interval_minutes, alerts],
    )
    .map(|_| ())
    .str_err()
}

#[tauri::command]
pub fn get_break_reminder_settings(db: tauri::State<'_, MetadeaDb>) -> Result<BreakReminderSettings, String> {
    let conn = db.conn.lock().str_err()?;
    load_settings_in(&conn).str_err()
}

/// Saves the settings (normalised) and returns what was stored.
#[tauri::command]
pub fn set_break_reminder_settings(
    db: tauri::State<'_, MetadeaDb>,
    settings: BreakReminderSettings,
) -> Result<BreakReminderSettings, String> {
    let settings = normalize_settings(settings);
    let conn = db.conn.lock().str_err()?;
    save_settings_in(&conn, &settings)?;
    Ok(settings)
}

// ─── break reminder scheduling ───────────────────────────────────────────────

/// The first multiple of `interval_secs` strictly after `active_secs`.
pub(crate) fn next_break_threshold(active_secs: i64, interval_secs: i64) -> i64 {
    (active_secs.max(0) / interval_secs + 1) * interval_secs
}

/// Per-session next thresholds. A session seen for the first time (new, or
/// re-attached after a restart) starts from its current running time.
#[derive(Default)]
pub(crate) struct BreakTracker {
    interval_secs: i64,
    next_due: HashMap<String, i64>,
}

impl BreakTracker {
    /// The threshold just reached (in running seconds), at most one per call.
    pub(crate) fn check(&mut self, session_id: &str, active_secs: i64, interval_secs: i64) -> Option<i64> {
        if interval_secs <= 0 {
            self.next_due.clear();
            return None;
        }
        if interval_secs != self.interval_secs {
            self.interval_secs = interval_secs;
            self.next_due.clear();
        }
        let next = *self
            .next_due
            .entry(session_id.to_string())
            .or_insert_with(|| next_break_threshold(active_secs, interval_secs));
        if active_secs < next {
            return None;
        }
        self.next_due.insert(session_id.to_string(), next_break_threshold(active_secs, interval_secs));
        Some(active_secs / interval_secs * interval_secs)
    }

    pub(crate) fn retain(&mut self, active_ids: &HashSet<&str>) {
        self.next_due.retain(|id, _| active_ids.contains(id.as_str()));
    }
}

// ─── clock alerts scheduling ─────────────────────────────────────────────────

fn is_weekend(date: NaiveDate) -> bool {
    matches!(date.weekday(), Weekday::Sat | Weekday::Sun)
}

/// Every alert occurrence at or after `from`, within the next 8 days, sorted.
pub(crate) fn upcoming_clock_alerts(alerts: &[ClockAlert], from: NaiveDateTime) -> Vec<(NaiveDateTime, String)> {
    let mut out = Vec::new();
    for offset in 0..8 {
        let Some(date) = from.date().checked_add_days(chrono::Days::new(offset)) else { continue };
        for alert in alerts {
            let Some((h, m)) = parse_clock_time(&alert.time) else { continue };
            let Some(target) = date.and_hms_opt(h, m, 0) else { continue };
            if target < from || (alert.weekdays_only && is_weekend(date)) {
                continue;
            }
            out.push((target, format!("{h:02}:{m:02}")));
        }
    }
    out.sort();
    out
}

/// The next alert strictly after `now`, if any.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn next_clock_alert(alerts: &[ClockAlert], now: NaiveDateTime) -> Option<(NaiveDateTime, String)> {
    upcoming_clock_alerts(alerts, now).into_iter().find(|(target, _)| *target > now)
}

/// Alerts to fire at `now`: reached within the last 2 minutes, while the
/// session was already running, and not fired yet today for that time.
/// Keys are (the alert's date, "HH:MM").
pub(crate) fn due_clock_alerts(
    alerts: &[ClockAlert],
    now: NaiveDateTime,
    session_started: NaiveDateTime,
    fired: &HashSet<(NaiveDate, String)>,
) -> Vec<(NaiveDate, String)> {
    let window_start = now - chrono::Duration::seconds(CLOCK_TOLERANCE_SECS);
    upcoming_clock_alerts(alerts, window_start)
        .into_iter()
        .take_while(|(target, _)| *target <= now)
        .filter(|(target, _)| *target >= session_started)
        .map(|(target, time)| (target.date(), time))
        .filter(|key| !fired.contains(key))
        .collect()
}

// ─── runtime ─────────────────────────────────────────────────────────────────

fn local_naive(unix: i64) -> Option<NaiveDateTime> {
    Local.timestamp_opt(unix, 0).single().map(|t| t.naive_local())
}

fn local_midnight_unix(now: NaiveDateTime) -> Option<i64> {
    let midnight = now.date().and_hms_opt(0, 0, 0)?;
    Local.from_local_datetime(&midnight).earliest().map(|t| t.timestamp())
}

fn logged_seconds_since(conn: &Connection, since_unix: i64) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COALESCE(SUM(seconds), 0) FROM game_sessions_log WHERE ended_at >= ?1",
        [since_unix],
        |r| r.get(0),
    )
}

fn payload_for(app: &AppHandle, session: &ActiveSession, kind: &'static str, played_secs: i64, clock_time: Option<String>) -> GameBreakToastPayload {
    let now_local = Local::now().naive_local();
    let db = app.state::<MetadeaDb>();
    let earlier_today = local_midnight_unix(now_local)
        .and_then(|midnight| {
            let conn = db.conn.lock().ok()?;
            logged_seconds_since(&conn, midnight).ok()
        })
        .unwrap_or(0);
    let current = active_seconds(session, now_unix());
    GameBreakToastPayload {
        kind,
        title: session.title.clone(),
        cover_url: session.cover_url.clone(),
        played_minutes: played_secs / 60,
        started_unix: session.started_unix,
        today_minutes: (earlier_today > 0).then(|| (earlier_today + current) / 60),
        clock_time,
    }
}

/// Starts the 20-second scheduler. Call once from `setup`, after the session
/// registry and the database are managed.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut breaks = BreakTracker::default();
        let mut fired: HashSet<(NaiveDate, String)> = HashSet::new();
        loop {
            tokio::time::sleep(TICK).await;
            let sessions: Vec<ActiveSession> = app
                .state::<GameSessionsState>()
                .snapshot()
                .into_iter()
                .filter(|s| s.running)
                .collect();
            let ids: HashSet<&str> = sessions.iter().map(|s| s.session_id.as_str()).collect();
            breaks.retain(&ids);
            let Some(newest) = sessions.first() else { continue };
            let settings = match app.state::<MetadeaDb>().conn.lock() {
                Ok(conn) => load_settings_in(&conn).unwrap_or_default(),
                Err(_) => continue,
            };
            let now = now_unix();

            let interval_secs = i64::from(settings.interval_minutes) * 60;
            for session in &sessions {
                if let Some(threshold) = breaks.check(&session.session_id, active_seconds(session, now), interval_secs) {
                    let payload = payload_for(&app, session, "break", threshold, None);
                    crate::folders::show_game_break_toast(&app, payload);
                }
            }

            if settings.clock_alerts.is_empty() {
                continue;
            }
            let now_local = Local::now().naive_local();
            let earliest_start = sessions.iter().map(|s| s.started_unix).min().unwrap_or(now);
            let Some(started_local) = local_naive(earliest_start) else { continue };
            let due = due_clock_alerts(&settings.clock_alerts, now_local, started_local, &fired);
            if let Some((_, time)) = due.last() {
                let payload = payload_for(&app, newest, "clock", active_seconds(newest, now), Some(time.clone()));
                crate::folders::show_game_break_toast(&app, payload);
            }
            fired.extend(due);
            let yesterday = now_local.date().pred_opt().unwrap_or(now_local.date());
            fired.retain(|(date, _)| *date >= yesterday);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(y: i32, mo: u32, d: u32, h: u32, mi: u32, s: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(y, mo, d).unwrap().and_hms_opt(h, mi, s).unwrap()
    }

    fn alert(time: &str, weekdays_only: bool) -> ClockAlert {
        ClockAlert { time: time.into(), weekdays_only }
    }

    #[test]
    fn settings_are_clamped_deduplicated_sorted_and_capped() {
        let raw = BreakReminderSettings {
            interval_minutes: 5,
            clock_alerts: vec![
                alert("23:00", false), alert("7:5", true), alert("23:00", true), alert("25:00", false),
                alert("nope", false), alert("01:00", false), alert("02:00", false), alert("03:00", false),
                alert("04:00", false), alert("05:00", false),
            ],
        };
        let s = normalize_settings(raw);
        assert_eq!(s.interval_minutes, 30);
        let times: Vec<&str> = s.clock_alerts.iter().map(|a| a.time.as_str()).collect();
        assert_eq!(times, vec!["01:00", "02:00", "03:00", "04:00", "05:00", "07:05"]);
        assert_eq!(normalize_settings(BreakReminderSettings { interval_minutes: 0, clock_alerts: vec![] }).interval_minutes, 0);
        assert_eq!(normalize_settings(BreakReminderSettings { interval_minutes: 9_999, clock_alerts: vec![] }).interval_minutes, 720);
    }

    #[test]
    fn settings_round_trip_through_the_table() {
        let db = MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        assert_eq!(load_settings_in(&conn).unwrap(), BreakReminderSettings::default());
        let s = BreakReminderSettings { interval_minutes: 120, clock_alerts: vec![alert("23:00", true)] };
        save_settings_in(&conn, &s).unwrap();
        save_settings_in(&conn, &s).unwrap();
        assert_eq!(load_settings_in(&conn).unwrap(), s);
    }

    #[test]
    fn break_thresholds_follow_running_time() {
        assert_eq!(next_break_threshold(0, 3_600), 3_600);
        assert_eq!(next_break_threshold(3_599, 3_600), 3_600);
        assert_eq!(next_break_threshold(3_600, 3_600), 7_200);
        assert_eq!(next_break_threshold(9_000, 3_600), 10_800);
    }

    #[test]
    fn one_reminder_per_threshold() {
        let mut t = BreakTracker::default();
        assert_eq!(t.check("a", 0, 3_600), None);
        assert_eq!(t.check("a", 3_599, 3_600), None);
        assert_eq!(t.check("a", 3_600, 3_600), Some(3_600));
        assert_eq!(t.check("a", 3_620, 3_600), None);
        // Asleep for hours: one reminder, then the next multiple.
        assert_eq!(t.check("a", 11_000, 3_600), Some(10_800));
        assert_eq!(t.check("a", 11_020, 3_600), None);
        assert_eq!(t.check("a", 14_400, 3_600), Some(14_400));
    }

    #[test]
    fn reattach_never_bursts() {
        let mut t = BreakTracker::default();
        // First seen 2.5 h in (restart + re-attach): nothing until 3 h.
        assert_eq!(t.check("b", 9_000, 3_600), None);
        assert_eq!(t.check("b", 10_799, 3_600), None);
        assert_eq!(t.check("b", 10_800, 3_600), Some(10_800));
    }

    #[test]
    fn paused_time_delays_the_reminder() {
        let mut s = crate::game_sessions::ActiveSession {
            session_id: "p".into(), external_id: String::new(), title: "T".into(), cover_url: None,
            platform: None, launcher: String::new(), app_id: None, install_path: None, exe_path: None,
            pids: vec![], started_unix: 0, last_heartbeat_unix: 0, running: true,
            paused_seconds: 0, paused_since: None,
        };
        let mut t = BreakTracker::default();
        assert_eq!(t.check("p", active_seconds(&s, 0), 3_600), None);
        crate::game_sessions::apply_pause(&mut s, true, 1_800);
        crate::game_sessions::apply_pause(&mut s, false, 2_400);
        assert_eq!(t.check("p", active_seconds(&s, 3_600), 3_600), None);
        assert_eq!(t.check("p", active_seconds(&s, 4_200), 3_600), Some(3_600));
    }

    #[test]
    fn changing_the_interval_restarts_from_the_current_time() {
        let mut t = BreakTracker::default();
        assert_eq!(t.check("c", 5_000, 3_600), None);
        assert_eq!(t.check("c", 5_000, 1_800), None);
        assert_eq!(t.check("c", 5_400, 1_800), Some(5_400));
        assert_eq!(t.check("c", 9_999, 0), None);
    }

    #[test]
    fn next_clock_alert_after_now_respects_weekdays() {
        let alerts = [alert("23:00", false), alert("07:30", true)];
        // Wednesday 2026-09-23 22:00.
        assert_eq!(next_clock_alert(&alerts, at(2026, 9, 23, 22, 0, 0)).unwrap().0, at(2026, 9, 23, 23, 0, 0));
        assert_eq!(next_clock_alert(&alerts, at(2026, 9, 23, 23, 0, 0)).unwrap().0, at(2026, 9, 24, 7, 30, 0));
        // Friday 23:30 → Monday 07:30: weekdays-only skips the weekend.
        let weekdays = [alert("07:30", true)];
        assert_eq!(next_clock_alert(&weekdays, at(2026, 9, 25, 23, 30, 0)).unwrap().0, at(2026, 9, 28, 7, 30, 0));
        assert!(next_clock_alert(&[], at(2026, 9, 25, 23, 30, 0)).is_none());
    }

    #[test]
    fn clock_alert_fires_once_within_two_minutes() {
        let alerts = [alert("23:00", false)];
        let started = at(2026, 9, 23, 20, 0, 0);
        let mut fired = HashSet::new();
        assert!(due_clock_alerts(&alerts, at(2026, 9, 23, 22, 59, 59), started, &fired).is_empty());
        let due = due_clock_alerts(&alerts, at(2026, 9, 23, 23, 0, 10), started, &fired);
        assert_eq!(due, vec![(NaiveDate::from_ymd_opt(2026, 9, 23).unwrap(), "23:00".to_string())]);
        fired.extend(due);
        assert!(due_clock_alerts(&alerts, at(2026, 9, 23, 23, 1, 0), started, &fired).is_empty());
        // Next day it fires again.
        assert_eq!(due_clock_alerts(&alerts, at(2026, 9, 24, 23, 0, 30), started, &fired).len(), 1);
    }

    #[test]
    fn clock_alert_is_skipped_after_sleep_or_before_the_session() {
        let alerts = [alert("23:00", false)];
        let fired = HashSet::new();
        // Detected 3 minutes late (sleep/resume, DST jump): skipped.
        assert!(due_clock_alerts(&alerts, at(2026, 9, 23, 23, 3, 0), at(2026, 9, 23, 20, 0, 0), &fired).is_empty());
        // Exactly 2 minutes late still counts.
        assert_eq!(due_clock_alerts(&alerts, at(2026, 9, 23, 23, 2, 0), at(2026, 9, 23, 20, 0, 0), &fired).len(), 1);
        // The session started after 23:00: no retroactive alert.
        assert!(due_clock_alerts(&alerts, at(2026, 9, 23, 23, 1, 0), at(2026, 9, 23, 23, 0, 30), &fired).is_empty());
    }

    #[test]
    fn clock_alert_weekdays_only_and_midnight() {
        let fired = HashSet::new();
        let started = at(2026, 9, 25, 20, 0, 0);
        // Saturday 2026-09-26.
        assert!(due_clock_alerts(&[alert("23:00", true)], at(2026, 9, 26, 23, 0, 5), started, &fired).is_empty());
        assert_eq!(due_clock_alerts(&[alert("23:00", true)], at(2026, 9, 25, 23, 0, 5), started, &fired).len(), 1);
        // 23:59 detected at 00:00:30: yesterday's alert, still within 2 min.
        let due = due_clock_alerts(&[alert("23:59", false)], at(2026, 9, 26, 0, 0, 30), started, &fired);
        assert_eq!(due, vec![(NaiveDate::from_ymd_opt(2026, 9, 25).unwrap(), "23:59".to_string())]);
    }
}
