// The narrow surface the engine needs from libmpv, as a trait so engine.rs
// can be exercised in tests with a scripted fake instead of the real DLL.

use super::error::PlayerError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PropertyFormat {
    String,
    Flag,
    Int64,
    Double,
}

#[derive(Debug, Clone, PartialEq)]
pub enum PropertyValue {
    None,
    Flag(bool),
    Int(i64),
    Double(f64),
    Str(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EndFileReason {
    Eof,
    Stop,
    Quit,
    Error,
    Redirect,
    Unknown,
}

impl EndFileReason {
    pub fn from_raw(reason: i32) -> Self {
        match reason {
            0 => EndFileReason::Eof,
            2 => EndFileReason::Stop,
            3 => EndFileReason::Quit,
            4 => EndFileReason::Error,
            5 => EndFileReason::Redirect,
            _ => EndFileReason::Unknown,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum MpvEvent {
    /// `mpv_wait_event` timed out without anything to report.
    Timeout,
    Shutdown,
    StartFile,
    FileLoaded,
    EndFile(EndFileReason),
    PropertyChange { name: String, value: PropertyValue },
    Other,
}

pub trait MpvApi: Send + Sync {
    fn set_property(&self, name: &str, value: &str) -> Result<(), PlayerError>;
    fn get_property_i64(&self, name: &str) -> Option<i64>;
    fn get_property_f64(&self, name: &str) -> Option<f64>;
    fn get_property_flag(&self, name: &str) -> Option<bool>;
    fn get_property_string(&self, name: &str) -> Option<String>;
    fn command(&self, args: &[&str]) -> Result<(), PlayerError>;
    fn observe_property(&self, id: u64, name: &str, format: PropertyFormat) -> Result<(), PlayerError>;
    /// Blocks for at most `timeout_secs`. Only one thread may call this.
    fn wait_event(&self, timeout_secs: f64) -> MpvEvent;
    /// Makes a pending `wait_event` return early.
    fn wakeup(&self);
}
