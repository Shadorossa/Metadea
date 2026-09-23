// Putting the finished clip on the clipboard as a *file* (CF_HDROP), the
// way Explorer's "Copy" does, so Ctrl+V in Discord/Telegram attaches it.
//
// The payload is a DROPFILES header followed by the paths as UTF-16, each
// NUL-terminated, with one extra NUL closing the list. The builder is pure
// (and tested); only `copy_files_to_clipboard` touches Win32.

/// `sizeof(DROPFILES)`: pFiles (u32) + pt (2 × i32) + fNC (i32) + fWide (i32).
pub const DROPFILES_SIZE: usize = 20;
/// Standard clipboard format id of CF_HDROP.
#[cfg(windows)]
const CF_HDROP: u32 = 15;

/// The complete CF_HDROP memory block for `paths` (wide-character list).
pub fn build_hdrop(paths: &[&str]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(DROPFILES_SIZE + paths.iter().map(|path| (path.len() + 1) * 2).sum::<usize>() + 2);
    bytes.extend_from_slice(&(DROPFILES_SIZE as u32).to_le_bytes()); // pFiles: offset of the list
    bytes.extend_from_slice(&0i32.to_le_bytes()); // pt.x
    bytes.extend_from_slice(&0i32.to_le_bytes()); // pt.y
    bytes.extend_from_slice(&0i32.to_le_bytes()); // fNC
    bytes.extend_from_slice(&1i32.to_le_bytes()); // fWide: UTF-16 paths
    for path in paths {
        for unit in path.encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        bytes.extend_from_slice(&[0, 0]);
    }
    bytes.extend_from_slice(&[0, 0]);
    bytes
}

#[cfg(windows)]
pub fn copy_files_to_clipboard(paths: &[&str]) -> Result<(), String> {
    use windows_sys::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData};
    use windows_sys::Win32::Foundation::GlobalFree;
    use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

    let payload = build_hdrop(paths);
    // Another app may hold the clipboard for a moment; retry briefly.
    // SAFETY: plain Win32 calls; a null owner window is allowed.
    let opened = (0..10).any(|attempt| {
        if attempt > 0 {
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
        unsafe { OpenClipboard(std::ptr::null_mut()) != 0 }
    });
    if !opened {
        return Err("OpenClipboard failed".into());
    }
    // SAFETY: the clipboard is open on this thread until CloseClipboard; the
    // global block is sized for `payload`, written while locked, and owned
    // by the system once SetClipboardData succeeds (freed by us otherwise).
    unsafe {
        let outcome = (|| {
            if EmptyClipboard() == 0 {
                return Err("EmptyClipboard failed".to_string());
            }
            let memory = GlobalAlloc(GMEM_MOVEABLE, payload.len());
            if memory.is_null() {
                return Err("GlobalAlloc failed".to_string());
            }
            let target = GlobalLock(memory) as *mut u8;
            if target.is_null() {
                GlobalFree(memory);
                return Err("GlobalLock failed".to_string());
            }
            std::ptr::copy_nonoverlapping(payload.as_ptr(), target, payload.len());
            GlobalUnlock(memory);
            if SetClipboardData(CF_HDROP, memory).is_null() {
                GlobalFree(memory);
                return Err("SetClipboardData failed".to_string());
            }
            Ok(())
        })();
        CloseClipboard();
        outcome
    }
}

#[cfg(not(windows))]
pub fn copy_files_to_clipboard(_paths: &[&str]) -> Result<(), String> {
    Err("file clipboard is only implemented on Windows".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u32_at(bytes: &[u8], at: usize) -> u32 {
        u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap())
    }

    #[test]
    fn header_is_a_wide_dropfiles_pointing_past_itself() {
        let bytes = build_hdrop(&["C:\\a.mp4"]);
        assert_eq!(u32_at(&bytes, 0), 20); // pFiles
        assert_eq!(u32_at(&bytes, 4), 0); // pt.x
        assert_eq!(u32_at(&bytes, 8), 0); // pt.y
        assert_eq!(u32_at(&bytes, 12), 0); // fNC
        assert_eq!(u32_at(&bytes, 16), 1); // fWide
    }

    #[test]
    fn paths_are_utf16_nul_terminated_with_a_closing_nul() {
        let bytes = build_hdrop(&["C:\\ñ.mp4", "D:\\b.gif"]);
        let units: Vec<u16> = bytes[DROPFILES_SIZE..].chunks(2).map(|pair| u16::from_le_bytes([pair[0], pair[1]])).collect();
        let mut expected: Vec<u16> = "C:\\ñ.mp4".encode_utf16().collect();
        expected.push(0);
        expected.extend("D:\\b.gif".encode_utf16());
        expected.extend([0, 0]);
        assert_eq!(units, expected);
        assert_eq!(bytes.len(), DROPFILES_SIZE + expected.len() * 2);
    }

    #[test]
    fn an_empty_list_is_just_the_closing_nul() {
        let bytes = build_hdrop(&[]);
        assert_eq!(bytes.len(), DROPFILES_SIZE + 2);
        assert_eq!(&bytes[DROPFILES_SIZE..], &[0, 0]);
    }
}
