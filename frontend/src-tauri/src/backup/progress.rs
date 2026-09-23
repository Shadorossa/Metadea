//! Progress reporting, cancellation and the one-operation-at-a-time guard
//! shared by local export/restore and the Google Drive upload/download.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::Emitter;

pub const PROGRESS_EVENT: &str = "backup://progress";

static BUSY: AtomicBool = AtomicBool::new(false);
static CANCEL_REQUESTED: AtomicBool = AtomicBool::new(false);

/// Held for the whole of one backup operation. Two operations at once would
/// race on the staging folders and on the pending-restore marker.
pub struct OperationGuard(());

impl OperationGuard {
    pub fn acquire() -> Result<Self, String> {
        if BUSY.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
            return Err(crate::error_codes::BACKUP_BUSY.into());
        }
        CANCEL_REQUESTED.store(false, Ordering::SeqCst);
        Ok(Self(()))
    }
}

impl Drop for OperationGuard {
    fn drop(&mut self) {
        CANCEL_REQUESTED.store(false, Ordering::SeqCst);
        BUSY.store(false, Ordering::SeqCst);
    }
}

pub fn request_cancel() -> bool {
    if BUSY.load(Ordering::SeqCst) {
        CANCEL_REQUESTED.store(true, Ordering::SeqCst);
        true
    } else {
        false
    }
}

/// Where the long-running steps report to. `cancelled()` is polled between
/// files and chunks; a step that sees it returns `E_BACKUP_CANCELLED`.
pub trait ProgressSink: Sync {
    fn report(&self, phase: &str, percent: f64);
    fn cancelled(&self) -> bool;

    fn check_cancelled(&self) -> Result<(), String> {
        if self.cancelled() {
            Err(crate::error_codes::BACKUP_CANCELLED.into())
        } else {
            Ok(())
        }
    }
}

/// For tests: reports nowhere, never cancelled.
#[cfg(test)]
pub struct NoProgress;

#[cfg(test)]
impl ProgressSink for NoProgress {
    fn report(&self, _phase: &str, _percent: f64) {}
    fn cancelled(&self) -> bool {
        false
    }
}

#[derive(Clone, Serialize)]
struct ProgressPayload<'a> {
    operation: &'a str,
    phase: &'a str,
    percent: f64,
}

/// Emits `backup://progress` events, at most one per whole percent per phase.
pub struct EventProgress {
    app: tauri::AppHandle,
    operation: &'static str,
    last: Mutex<(String, i64)>,
}

impl EventProgress {
    pub fn new(app: &tauri::AppHandle, operation: &'static str) -> Self {
        Self { app: app.clone(), operation, last: Mutex::new((String::new(), -1)) }
    }
}

impl ProgressSink for EventProgress {
    fn report(&self, phase: &str, percent: f64) {
        let percent = percent.clamp(0.0, 100.0);
        let whole = percent.floor() as i64;
        if let Ok(mut last) = self.last.lock() {
            if last.0 == phase && last.1 == whole {
                return;
            }
            *last = (phase.to_string(), whole);
        }
        let _ = self.app.emit(PROGRESS_EVENT, ProgressPayload { operation: self.operation, phase, percent });
    }

    fn cancelled(&self) -> bool {
        CANCEL_REQUESTED.load(Ordering::SeqCst)
    }
}
