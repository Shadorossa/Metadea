//! Pure decisions of the automatic Drive backup: when a run is due, and
//! which remote backups fall outside "keep the last N".

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

pub const DEFAULT_KEEP_LAST: u32 = 5;
pub const MIN_KEEP_LAST: u32 = 1;
pub const MAX_KEEP_LAST: u32 = 50;

/// How often the running app re-checks whether a scheduled run is due.
pub const CHECK_EVERY: std::time::Duration = std::time::Duration::from_secs(3 * 60 * 60);
/// First check after startup, late enough not to compete with launch work.
pub const FIRST_CHECK_AFTER: std::time::Duration = std::time::Duration::from_secs(90);

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Schedule {
    #[default]
    Off,
    Daily,
    Weekly,
}

impl Schedule {
    pub fn interval(self) -> Option<Duration> {
        match self {
            Schedule::Off => None,
            Schedule::Daily => Some(Duration::days(1)),
            Schedule::Weekly => Some(Duration::days(7)),
        }
    }
}

pub fn clamp_keep_last(value: u32) -> u32 {
    value.clamp(MIN_KEEP_LAST, MAX_KEEP_LAST)
}

/// A run is due when the schedule is on and a full interval has passed since
/// the last completed run (an upload, or a check that found nothing new).
/// A clock that went backwards counts as due rather than never.
pub fn is_due(schedule: Schedule, last_run: Option<DateTime<Utc>>, now: DateTime<Utc>) -> bool {
    let Some(interval) = schedule.interval() else { return false };
    match last_run {
        None => true,
        Some(last) if last > now => true,
        Some(last) => now - last >= interval,
    }
}

/// Whether a due run uploads: only when the content changed since the last
/// upload (fingerprint of every file's hash, see `backup::archive`).
pub fn should_upload(current_fingerprint: &str, last_uploaded: Option<&str>) -> bool {
    last_uploaded != Some(current_fingerprint)
}

/// The later of two optional RFC 3339 timestamps.
pub fn latest(a: Option<&str>, b: Option<&str>) -> Option<DateTime<Utc>> {
    let parse = |s: Option<&str>| s.and_then(|s| DateTime::parse_from_rfc3339(s).ok()).map(|d| d.with_timezone(&Utc));
    match (parse(a), parse(b)) {
        (Some(a), Some(b)) => Some(a.max(b)),
        (a, b) => a.or(b),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBackup {
    pub id: String,
    pub name: String,
    pub size: u64,
    /// RFC 3339, as Drive reports `createdTime`.
    pub created_at: String,
    pub app_version: Option<String>,
}

/// Ids of the backups to delete so that only the newest `keep_last` remain.
pub fn backups_to_prune(remote: &[RemoteBackup], keep_last: u32) -> Vec<String> {
    let mut sorted: Vec<&RemoteBackup> = remote.iter().collect();
    sorted.sort_by(|a, b| {
        let key = |r: &RemoteBackup| DateTime::parse_from_rfc3339(&r.created_at).ok();
        key(b).cmp(&key(a)).then_with(|| b.name.cmp(&a.name))
    });
    sorted.into_iter().skip(clamp_keep_last(keep_last) as usize).map(|r| r.id.clone()).collect()
}

pub fn remote_backup_name(now: DateTime<Utc>) -> String {
    format!("metadea-backup-{}.7z", now.format("%Y%m%d-%H%M%S"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn off_is_never_due() {
        assert!(!is_due(Schedule::Off, None, at("2026-09-23T00:00:00Z")));
    }

    #[test]
    fn due_after_a_full_interval() {
        let now = at("2026-09-23T12:00:00Z");
        assert!(is_due(Schedule::Daily, None, now));
        assert!(!is_due(Schedule::Daily, Some(at("2026-09-23T00:00:01Z")), now));
        assert!(is_due(Schedule::Daily, Some(at("2026-09-22T12:00:00Z")), now));
        assert!(!is_due(Schedule::Weekly, Some(at("2026-09-20T12:00:00Z")), now));
        assert!(is_due(Schedule::Weekly, Some(at("2026-09-16T12:00:00Z")), now));
        // Clock moved backwards: run instead of waiting forever.
        assert!(is_due(Schedule::Weekly, Some(at("2027-01-01T00:00:00Z")), now));
    }

    #[test]
    fn uploads_only_changed_content() {
        assert!(should_upload("abc", None));
        assert!(should_upload("abc", Some("def")));
        assert!(!should_upload("abc", Some("abc")));
    }

    #[test]
    fn latest_picks_the_newer_timestamp() {
        let newer = latest(Some("2026-09-01T00:00:00Z"), Some("2026-09-02T00:00:00+02:00")).unwrap();
        assert_eq!(newer, at("2026-09-01T22:00:00Z"));
        assert_eq!(latest(None, Some("2026-09-01T00:00:00Z")), Some(at("2026-09-01T00:00:00Z")));
        assert_eq!(latest(Some("garbage"), None), None);
    }

    fn remote(id: &str, created: &str) -> RemoteBackup {
        RemoteBackup { id: id.into(), name: format!("{id}.7z"), size: 1, created_at: created.into(), app_version: None }
    }

    #[test]
    fn prunes_all_but_the_newest() {
        let list = vec![
            remote("a", "2026-09-01T00:00:00.000Z"),
            remote("c", "2026-09-03T00:00:00.000Z"),
            remote("b", "2026-09-02T00:00:00.000Z"),
            remote("d", "2026-09-04T00:00:00.000Z"),
        ];
        assert_eq!(backups_to_prune(&list, 2), vec!["b".to_string(), "a".to_string()]);
        assert!(backups_to_prune(&list, 5).is_empty());
        // Keep at least one, whatever the setting says.
        assert_eq!(backups_to_prune(&list, 0).len(), 3);
    }

    #[test]
    fn keep_last_is_clamped_and_names_sort_by_time() {
        assert_eq!(clamp_keep_last(0), 1);
        assert_eq!(clamp_keep_last(500), 50);
        assert_eq!(remote_backup_name(at("2026-09-23T10:15:00Z")), "metadea-backup-20260923-101500.7z");
    }

    #[test]
    fn schedule_serializes_lowercase() {
        assert_eq!(serde_json::to_string(&Schedule::Weekly).unwrap(), "\"weekly\"");
        assert_eq!(serde_json::from_str::<Schedule>("\"daily\"").unwrap(), Schedule::Daily);
    }
}
