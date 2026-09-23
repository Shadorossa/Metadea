// The native surface mpv renders into. On Windows it is a plain Win32 child
// window of the `player` Tauri window, passed to mpv as `wid`; mpv then
// creates its own child inside it. Everything here is thread-affine: create,
// resize and destroy only ever run on the main (event loop) thread, which
// commands reach through `AppHandle::run_on_main_thread`.
//
// Other platforms: no embedding yet — `create` fails, the engine starts with
// no `wid`, and mpv opens its own top-level window (best-effort, see report).

use super::error::PlayerError;

#[derive(Debug, Clone, Copy)]
pub struct VideoHost {
    hwnd: isize,
}

#[cfg(windows)]
mod win {
    use std::sync::OnceLock;

    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::Graphics::Gdi::{GetStockObject, BLACK_BRUSH};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, GetWindow, RegisterClassW, SetWindowPos, GW_CHILD, GW_HWNDNEXT,
        HWND_TOP, SWP_NOACTIVATE, SWP_NOZORDER, SWP_SHOWWINDOW, WNDCLASSW, WS_CHILD, WS_CLIPCHILDREN, WS_CLIPSIBLINGS,
        WS_VISIBLE,
    };

    static CLASS_NAME: OnceLock<Vec<u16>> = OnceLock::new();
    static CLASS_REGISTERED: OnceLock<bool> = OnceLock::new();

    fn class_name() -> &'static [u16] {
        CLASS_NAME.get_or_init(|| "MetadeaVideoHost\0".encode_utf16().collect())
    }

    unsafe extern "system" fn host_window_proc(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        // SAFETY: forwarding to the default procedure with the exact
        // arguments Windows handed us.
        unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
    }

    fn ensure_class() -> bool {
        *CLASS_REGISTERED.get_or_init(|| {
            // SAFETY: all pointers reference static or null data; the class
            // name is NUL-terminated UTF-16 kept alive by the OnceLock.
            unsafe {
                let class = WNDCLASSW {
                    style: 0,
                    lpfnWndProc: Some(host_window_proc),
                    cbClsExtra: 0,
                    cbWndExtra: 0,
                    hInstance: GetModuleHandleW(std::ptr::null()),
                    hIcon: std::ptr::null_mut(),
                    hCursor: std::ptr::null_mut(),
                    hbrBackground: GetStockObject(BLACK_BRUSH),
                    lpszMenuName: std::ptr::null(),
                    lpszClassName: class_name().as_ptr(),
                };
                RegisterClassW(&class) != 0
            }
        })
    }

    pub fn create(parent: isize, width: i32, height: i32) -> Option<isize> {
        if !ensure_class() {
            return None;
        }
        // SAFETY: the class is registered; `parent` is a live HWND owned by
        // this process (the Tauri player window) and this runs on its thread.
        let hwnd = unsafe {
            CreateWindowExW(
                0,
                class_name().as_ptr(),
                std::ptr::null(),
                WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN,
                0,
                0,
                width.max(1),
                height.max(1),
                parent as HWND,
                std::ptr::null_mut(),
                GetModuleHandleW(std::ptr::null()),
                std::ptr::null(),
            )
        };
        (!hwnd.is_null()).then_some(hwnd as isize)
    }

    pub fn set_bounds(hwnd: isize, x: i32, y: i32, width: i32, height: i32) {
        let (width, height) = (width.max(1), height.max(1));
        // SAFETY: `hwnd` was created by `create` on this same thread and is
        // destroyed only through `destroy`; children enumerated below belong
        // to mpv and are resized in place, never freed.
        unsafe {
            SetWindowPos(hwnd as HWND, HWND_TOP, x, y, width, height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
            let mut child = GetWindow(hwnd as HWND, GW_CHILD);
            while !child.is_null() {
                SetWindowPos(child, std::ptr::null_mut(), 0, 0, width, height, SWP_NOACTIVATE | SWP_NOZORDER);
                child = GetWindow(child, GW_HWNDNEXT);
            }
        }
    }

    pub fn destroy(hwnd: isize) {
        // SAFETY: see set_bounds; DestroyWindow on a window this thread owns.
        unsafe {
            DestroyWindow(hwnd as HWND);
        }
    }
}

impl VideoHost {
    /// Creates the child surface inside `parent` (an HWND as isize). Main
    /// thread only.
    #[cfg(windows)]
    pub fn create(parent: isize, width: i32, height: i32) -> Result<VideoHost, PlayerError> {
        win::create(parent, width, height)
            .map(|hwnd| VideoHost { hwnd })
            .ok_or_else(|| PlayerError::window("could not create the video host window"))
    }

    #[cfg(not(windows))]
    pub fn create(_parent: isize, _width: i32, _height: i32) -> Result<VideoHost, PlayerError> {
        Err(PlayerError::window("embedded video surface is only implemented on Windows"))
    }

    /// The value handed to mpv's `wid` option.
    pub fn wid(&self) -> i64 {
        self.hwnd as i64
    }

    /// Main thread only. Coordinates are physical pixels inside the parent's
    /// client area.
    pub fn set_bounds(&self, x: i32, y: i32, width: i32, height: i32) {
        #[cfg(windows)]
        win::set_bounds(self.hwnd, x, y, width, height);
        #[cfg(not(windows))]
        let _ = (x, y, width, height);
    }

    /// Main thread only.
    pub fn destroy(self) {
        #[cfg(windows)]
        win::destroy(self.hwnd);
    }
}
