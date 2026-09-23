//! Suspending, resuming, focusing and closing the emulator process Metadea
//! launched. Only ever a PID from the game session registry whose image
//! path is the configured emulator executable ([`image_matches`]), through a
//! handle held for the whole pause so the PID cannot be recycled under us.
//! An [`OwnedProcess`] that is still suspended when dropped resumes itself.

use std::time::Duration;

/// How long "Quit game" waits for the emulator to close its windows (and
/// flush battery saves) before terminating it.
pub const QUIT_TIMEOUT: Duration = Duration::from_secs(5);

/// `\\?\C:/Emu/RetroArch.EXE` and `c:\emu\retroarch.exe` are the same image.
pub fn normalize_image_path(path: &str) -> String {
    let trimmed = path.trim().trim_matches('"');
    let trimmed = trimmed.strip_prefix(r"\\?\").unwrap_or(trimmed);
    trimmed.replace('/', "\\").to_lowercase()
}

/// Whether a process image is the emulator executable the session launched.
pub fn image_matches(expected_exe: &str, actual_image: &str) -> bool {
    let expected = normalize_image_path(expected_exe);
    !expected.is_empty() && expected == normalize_image_path(actual_image)
}

/// The PIDs of `candidates` whose image is `expected_exe` (`image_of`
/// returns None for a process that is gone or cannot be opened).
pub fn owned_pids(candidates: &[u32], expected_exe: &str, image_of: impl Fn(u32) -> Option<String>) -> Vec<u32> {
    candidates
        .iter()
        .copied()
        .filter(|pid| *pid != 0 && *pid != std::process::id())
        .filter(|pid| image_of(*pid).is_some_and(|image| image_matches(expected_exe, &image)))
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuitAction {
    /// Every owned process has exited.
    Done,
    /// Ask the emulator's top-level windows to close (WM_CLOSE).
    SendClose,
    /// Give it time to save and exit.
    Wait,
    /// Out of patience (or nothing to ask): terminate.
    Terminate,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct QuitProgress {
    pub close_sent: bool,
    /// Windows WM_CLOSE was posted to.
    pub windows_closed: usize,
    pub elapsed: Duration,
    pub exited: bool,
}

/// The graceful quit: WM_CLOSE first, up to `timeout` for the process to
/// exit on its own, then terminate.
pub fn next_quit_action(progress: &QuitProgress, timeout: Duration) -> QuitAction {
    if progress.exited {
        QuitAction::Done
    } else if !progress.close_sent {
        QuitAction::SendClose
    } else if progress.windows_closed == 0 || progress.elapsed >= timeout {
        QuitAction::Terminate
    } else {
        QuitAction::Wait
    }
}

#[cfg(windows)]
mod platform {
    use windows_sys::Win32::Foundation::{CloseHandle, BOOL, HANDLE, HWND, LPARAM, RECT};
    use windows_sys::Win32::System::Threading::{
        AttachThreadInput, GetCurrentThreadId, GetExitCodeProcess, OpenProcess, QueryFullProcessImageNameW, TerminateProcess,
        PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SUSPEND_RESUME, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, EnumWindows, GetForegroundWindow, GetWindow, GetWindowRect, GetWindowThreadProcessId, IsIconic,
        IsWindowVisible, PostMessageW, SetForegroundWindow, ShowWindow, GW_OWNER, SW_RESTORE, WM_CLOSE,
    };

    // Suspends / resumes every thread of a process in one call. Exported by
    // ntdll since Windows XP; linked without an import library.
    #[link(name = "ntdll", kind = "raw-dylib")]
    extern "system" {
        fn NtSuspendProcess(process: HANDLE) -> i32;
        fn NtResumeProcess(process: HANDLE) -> i32;
    }

    const STILL_ACTIVE: u32 = 259;

    fn image_of_handle(handle: HANDLE) -> Option<String> {
        let mut buffer = vec![0u16; 1024];
        let mut size = buffer.len() as u32;
        // SAFETY: buffer/size describe a valid writable UTF-16 buffer.
        let ok = unsafe { QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, buffer.as_mut_ptr(), &mut size) };
        (ok != 0).then(|| String::from_utf16_lossy(&buffer[..size as usize]))
    }

    /// The image path of `pid`, if it can be queried.
    pub fn process_image(pid: u32) -> Option<String> {
        // SAFETY: plain Win32 calls; the handle is closed before returning.
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return None;
            }
            let image = image_of_handle(handle);
            CloseHandle(handle);
            image
        }
    }

    /// A process Metadea launched, opened for the pause. Resumes itself on
    /// drop if it is still suspended (the "never leave it frozen" guard).
    pub struct OwnedProcess {
        pub pid: u32,
        handle: isize,
        suspended: bool,
    }

    impl OwnedProcess {
        /// Opens `pid` only when it is alive and its image is `expected_exe`.
        pub fn open_verified(pid: u32, expected_exe: &str) -> Option<Self> {
            // SAFETY: OpenProcess returns null on failure; the handle is owned by Self.
            let handle = unsafe {
                OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SUSPEND_RESUME | PROCESS_TERMINATE | PROCESS_SYNCHRONIZE, 0, pid)
            };
            if handle.is_null() {
                return None;
            }
            let owned = Self { pid, handle: handle as isize, suspended: false };
            let image = image_of_handle(owned.raw())?;
            (super::image_matches(expected_exe, &image) && owned.is_alive()).then_some(owned)
        }

        fn raw(&self) -> HANDLE {
            self.handle as HANDLE
        }

        pub fn is_alive(&self) -> bool {
            let mut code = 0u32;
            // SAFETY: valid process handle with query rights.
            let ok = unsafe { GetExitCodeProcess(self.raw(), &mut code) };
            ok != 0 && code == STILL_ACTIVE
        }

        pub fn suspend(&mut self) -> bool {
            if self.suspended {
                return true;
            }
            // SAFETY: valid handle with PROCESS_SUSPEND_RESUME.
            self.suspended = unsafe { NtSuspendProcess(self.raw()) } >= 0;
            self.suspended
        }

        pub fn resume(&mut self) -> bool {
            if !self.suspended {
                return true;
            }
            // SAFETY: valid handle with PROCESS_SUSPEND_RESUME; only undoes our own suspend.
            let ok = unsafe { NtResumeProcess(self.raw()) } >= 0;
            if ok {
                self.suspended = false;
            }
            ok
        }

        pub fn terminate(&self) -> bool {
            // SAFETY: valid handle with PROCESS_TERMINATE.
            unsafe { TerminateProcess(self.raw(), 1) != 0 }
        }
    }

    impl Drop for OwnedProcess {
        fn drop(&mut self) {
            if self.suspended && !self.resume() {
                log::warn!("Could not resume process {} on release", self.pid);
            }
            // SAFETY: the handle was opened by open_verified and is closed once.
            unsafe { CloseHandle(self.raw()) };
        }
    }

    struct Collect {
        pids: Vec<u32>,
        found: Vec<(isize, i64)>,
    }

    unsafe extern "system" fn collect_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
        // SAFETY: lparam is the &mut Collect passed to EnumWindows below.
        let collect = &mut *(lparam as *mut Collect);
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if collect.pids.contains(&pid) && IsWindowVisible(hwnd) != 0 && GetWindow(hwnd, GW_OWNER).is_null() {
            let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
            GetWindowRect(hwnd, &mut rect);
            let area = i64::from(rect.right - rect.left) * i64::from(rect.bottom - rect.top);
            collect.found.push((hwnd as isize, area));
        }
        1
    }

    /// Visible, unowned top-level windows of `pids`, largest first.
    pub fn top_level_windows(pids: &[u32]) -> Vec<isize> {
        let mut collect = Collect { pids: pids.to_vec(), found: Vec::new() };
        // SAFETY: the callback only runs during this call and gets &mut collect.
        unsafe { EnumWindows(Some(collect_window), &mut collect as *mut Collect as LPARAM) };
        collect.found.sort_by_key(|found| std::cmp::Reverse(found.1));
        collect.found.into_iter().map(|(hwnd, _)| hwnd).collect()
    }

    /// Posts WM_CLOSE to each window; returns how many accepted it.
    pub fn post_close(windows: &[isize]) -> usize {
        windows
            .iter()
            // SAFETY: posting a message to a window handle is always safe.
            .filter(|hwnd| unsafe { PostMessageW(**hwnd as HWND, WM_CLOSE, 0, 0) } != 0)
            .count()
    }

    /// The PID owning the foreground window.
    pub fn foreground_pid() -> Option<u32> {
        // SAFETY: plain Win32 queries.
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.is_null() {
                return None;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, &mut pid);
            (pid != 0).then_some(pid)
        }
    }

    /// Brings `hwnd` to the front even from a background process: the input
    /// queue of the current foreground thread is attached for the call.
    pub fn force_foreground(hwnd: isize) {
        let hwnd = hwnd as HWND;
        // SAFETY: plain Win32 calls; the attachment is always undone.
        unsafe {
            let current = GetCurrentThreadId();
            let foreground = GetForegroundWindow();
            let foreground_thread = if foreground.is_null() { 0 } else { GetWindowThreadProcessId(foreground, std::ptr::null_mut()) };
            let attached = foreground_thread != 0 && foreground_thread != current && AttachThreadInput(current, foreground_thread, 1) != 0;
            if IsIconic(hwnd) != 0 {
                ShowWindow(hwnd, SW_RESTORE);
            }
            BringWindowToTop(hwnd);
            SetForegroundWindow(hwnd);
            if attached {
                AttachThreadInput(current, foreground_thread, 0);
            }
        }
    }
}

#[cfg(windows)]
pub use platform::*;

// Other platforms: nothing is ever owned, so the pause menu never opens.
#[cfg(not(windows))]
mod platform {
    pub struct OwnedProcess {
        pub pid: u32,
    }

    impl OwnedProcess {
        pub fn open_verified(_pid: u32, _expected_exe: &str) -> Option<Self> {
            None
        }
        pub fn is_alive(&self) -> bool {
            false
        }
        pub fn suspend(&mut self) -> bool {
            false
        }
        pub fn resume(&mut self) -> bool {
            true
        }
        pub fn terminate(&self) -> bool {
            false
        }
    }

    pub fn process_image(_pid: u32) -> Option<String> {
        None
    }
    pub fn top_level_windows(_pids: &[u32]) -> Vec<isize> {
        Vec::new()
    }
    pub fn post_close(_windows: &[isize]) -> usize {
        0
    }
    pub fn foreground_pid() -> Option<u32> {
        None
    }
    pub fn force_foreground(_hwnd: isize) {}
}

#[cfg(not(windows))]
pub use platform::*;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_paths_compare_normalized() {
        assert!(image_matches(r"C:\Emu\RetroArch\retroarch.exe", r"\\?\c:/emu/retroarch/RetroArch.EXE"));
        assert!(image_matches("\"C:\\Emu\\duckstation.exe\"", r"C:\Emu\duckstation.exe"));
        assert!(!image_matches(r"C:\Emu\retroarch.exe", r"C:\Other\retroarch.exe"));
        assert!(!image_matches("", r"C:\Emu\retroarch.exe"), "an unknown executable owns nothing");
    }

    #[test]
    fn only_live_processes_running_the_emulator_image_are_owned() {
        let image_of = |pid: u32| match pid {
            10 => Some(r"C:\Emu\retroarch.exe".to_string()),
            11 => Some(r"C:\Windows\explorer.exe".to_string()),
            12 => None,
            _ => Some(r"c:/emu/RETROARCH.exe".to_string()),
        };
        let own = std::process::id();
        assert_eq!(owned_pids(&[10, 11, 12, 13, 0, own], r"C:\Emu\retroarch.exe", image_of), vec![10, 13]);
        assert!(owned_pids(&[10], "", image_of).is_empty());
    }

    #[test]
    fn quit_closes_waits_then_terminates() {
        let timeout = QUIT_TIMEOUT;
        let mut progress = QuitProgress::default();
        assert_eq!(next_quit_action(&progress, timeout), QuitAction::SendClose);
        progress.close_sent = true;
        progress.windows_closed = 1;
        progress.elapsed = Duration::from_millis(4900);
        assert_eq!(next_quit_action(&progress, timeout), QuitAction::Wait);
        progress.elapsed = Duration::from_secs(5);
        assert_eq!(next_quit_action(&progress, timeout), QuitAction::Terminate);
        progress.exited = true;
        assert_eq!(next_quit_action(&progress, timeout), QuitAction::Done);
    }

    #[test]
    fn quit_terminates_at_once_when_there_is_no_window_to_close() {
        let progress = QuitProgress { close_sent: true, windows_closed: 0, ..QuitProgress::default() };
        assert_eq!(next_quit_action(&progress, QUIT_TIMEOUT), QuitAction::Terminate);
        let exited_early = QuitProgress { exited: true, ..QuitProgress::default() };
        assert_eq!(next_quit_action(&exited_early, QUIT_TIMEOUT), QuitAction::Done);
    }
}
