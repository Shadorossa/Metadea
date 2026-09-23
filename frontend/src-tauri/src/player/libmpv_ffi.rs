// Runtime binding to libmpv. The library is opened with `libloading` when the
// player is first used — never linked at build time — so `cargo build`, CI and
// a machine without the DLL all work; a missing library is reported as
// `PlayerError::engine_unavailable` and the app tells the user it cannot play.
//
// Only the entry points the engine uses are bound. Struct layouts and enum
// values follow client.h of the libmpv 2.x client API.

use std::ffi::{c_char, c_int, c_ulong, c_void, CStr, CString};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use libloading::Library;

use super::error::PlayerError;
use super::mpv_api::{EndFileReason, MpvApi, MpvEvent, PropertyFormat, PropertyValue};

const MPV_FORMAT_NONE: c_int = 0;
const MPV_FORMAT_STRING: c_int = 1;
const MPV_FORMAT_FLAG: c_int = 3;
const MPV_FORMAT_INT64: c_int = 4;
const MPV_FORMAT_DOUBLE: c_int = 5;
const MPV_FORMAT_NODE_MAP: c_int = 8;
const MPV_FORMAT_BYTE_ARRAY: c_int = 9;

const MPV_EVENT_NONE: c_int = 0;
const MPV_EVENT_SHUTDOWN: c_int = 1;
const MPV_EVENT_START_FILE: c_int = 6;
const MPV_EVENT_END_FILE: c_int = 7;
const MPV_EVENT_FILE_LOADED: c_int = 8;
const MPV_EVENT_PLAYBACK_RESTART: c_int = 21;
const MPV_EVENT_PROPERTY_CHANGE: c_int = 22;

/// Minimum client API version this binding was written against (2.0).
const MIN_API_VERSION: c_ulong = 2 << 16;

type MpvHandle = *mut c_void;

#[repr(C)]
struct MpvEventRaw {
    event_id: c_int,
    error: c_int,
    reply_userdata: u64,
    data: *mut c_void,
}

#[repr(C)]
struct MpvEventPropertyRaw {
    name: *const c_char,
    format: c_int,
    data: *mut c_void,
}

/// `mpv_node` (client.h): an 8-byte union followed by the format tag.
#[repr(C)]
#[derive(Clone, Copy)]
union MpvNodeValue {
    string: *mut c_char,
    flag: c_int,
    int64: i64,
    double_: f64,
    list: *mut MpvNodeList,
    ba: *mut MpvByteArray,
}

#[repr(C)]
struct MpvNode {
    u: MpvNodeValue,
    format: c_int,
}

#[repr(C)]
struct MpvNodeList {
    num: c_int,
    values: *mut MpvNode,
    keys: *mut *mut c_char,
}

#[repr(C)]
struct MpvByteArray {
    data: *mut c_void,
    size: usize,
}

/// One decoded video frame as `screenshot-raw` hands it out: packed 4-byte
/// pixels, `stride` bytes per row, in mpv's `format` (normally `bgr0`).
pub struct RawFrame {
    pub width: u32,
    pub height: u32,
    pub stride: usize,
    pub format: String,
    pub data: Vec<u8>,
}

#[repr(C)]
struct MpvEventEndFileRaw {
    reason: c_int,
    error: c_int,
    playlist_entry_id: i64,
    playlist_insert_id: i64,
    playlist_insert_num_entries: c_int,
}

type FnClientApiVersion = unsafe extern "C" fn() -> c_ulong;
type FnCreate = unsafe extern "C" fn() -> MpvHandle;
type FnInitialize = unsafe extern "C" fn(MpvHandle) -> c_int;
type FnSetString = unsafe extern "C" fn(MpvHandle, *const c_char, *const c_char) -> c_int;
type FnGetProperty = unsafe extern "C" fn(MpvHandle, *const c_char, c_int, *mut c_void) -> c_int;
type FnCommand = unsafe extern "C" fn(MpvHandle, *mut *const c_char) -> c_int;
type FnCommandString = unsafe extern "C" fn(MpvHandle, *const c_char) -> c_int;
type FnObserveProperty = unsafe extern "C" fn(MpvHandle, u64, *const c_char, c_int) -> c_int;
type FnWaitEvent = unsafe extern "C" fn(MpvHandle, f64) -> *mut MpvEventRaw;
type FnWakeupCallback = Option<unsafe extern "C" fn(*mut c_void)>;
type FnSetWakeupCallback = unsafe extern "C" fn(MpvHandle, FnWakeupCallback, *mut c_void);
type FnWakeup = unsafe extern "C" fn(MpvHandle);
type FnTerminateDestroy = unsafe extern "C" fn(MpvHandle);
type FnFree = unsafe extern "C" fn(*mut c_void);
type FnErrorString = unsafe extern "C" fn(c_int) -> *const c_char;
type FnCommandRet = unsafe extern "C" fn(MpvHandle, *mut *const c_char, *mut MpvNode) -> c_int;
type FnFreeNodeContents = unsafe extern "C" fn(*mut MpvNode);

struct MpvFns {
    client_api_version: FnClientApiVersion,
    create: FnCreate,
    initialize: FnInitialize,
    set_option_string: FnSetString,
    set_property_string: FnSetString,
    get_property: FnGetProperty,
    command: FnCommand,
    command_string: FnCommandString,
    observe_property: FnObserveProperty,
    wait_event: FnWaitEvent,
    set_wakeup_callback: FnSetWakeupCallback,
    wakeup: FnWakeup,
    terminate_destroy: FnTerminateDestroy,
    free: FnFree,
    error_string: FnErrorString,
    /// Optional: only the seek-bar thumbnailer needs them (`screenshot-raw`
    /// returns a node map); a build without them just has no thumbnails.
    command_ret: Option<FnCommandRet>,
    free_node_contents: Option<FnFreeNodeContents>,
}

/// The loaded library. Kept alive for as long as any client exists.
pub struct LibMpv {
    // Field order matters: `fns` holds raw pointers into `_lib`, so the
    // library must be dropped last (fields drop in declaration order).
    fns: MpvFns,
    _lib: Library,
}

pub fn library_file_name() -> &'static str {
    if cfg!(windows) {
        "libmpv-2.dll"
    } else if cfg!(target_os = "macos") {
        "libmpv.2.dylib"
    } else {
        "libmpv.so.2"
    }
}

/// Ordered list of full paths to try before falling back to the loader's
/// default search path (plain file name).
pub fn library_candidates(
    resource_dir: Option<&Path>,
    exe_dir: Option<&Path>,
    env_dir: Option<&str>,
) -> Vec<PathBuf> {
    let file_name = library_file_name();
    let mut candidates = Vec::new();
    if let Some(dir) = resource_dir {
        candidates.push(dir.join(file_name));
    }
    if let Some(dir) = exe_dir {
        candidates.push(dir.join(file_name));
    }
    if let Some(dir) = env_dir.map(str::trim).filter(|dir| !dir.is_empty()) {
        candidates.push(Path::new(dir).join(file_name));
    }
    candidates.dedup();
    candidates
}

impl LibMpv {
    pub fn load(resource_dir: Option<&Path>, exe_dir: Option<&Path>) -> Result<Arc<LibMpv>, PlayerError> {
        let env_dir = std::env::var("METADEA_MPV_DIR").ok();
        let mut attempts = Vec::new();
        for candidate in library_candidates(resource_dir, exe_dir, env_dir.as_deref()) {
            if !candidate.is_file() {
                continue;
            }
            match Self::open(candidate.as_os_str()) {
                Ok(lib) => return Ok(Arc::new(lib)),
                Err(error) => attempts.push(format!("{}: {error}", candidate.display())),
            }
        }
        match Self::open(std::ffi::OsStr::new(library_file_name())) {
            Ok(lib) => Ok(Arc::new(lib)),
            Err(error) => {
                attempts.push(format!("{}: {error}", library_file_name()));
                Err(PlayerError::engine_unavailable(attempts.join("; ")))
            }
        }
    }

    fn open(path: &std::ffi::OsStr) -> Result<LibMpv, String> {
        // SAFETY: loading libmpv runs its DllMain/constructors, which are
        // well-behaved for this library; every symbol is bound to the exact
        // C signature declared in client.h.
        let lib = unsafe { Library::new(path) }.map_err(|error| error.to_string())?;
        let fns = unsafe {
            MpvFns {
                client_api_version: *lib.get::<FnClientApiVersion>(b"mpv_client_api_version\0").map_err(|e| e.to_string())?,
                create: *lib.get::<FnCreate>(b"mpv_create\0").map_err(|e| e.to_string())?,
                initialize: *lib.get::<FnInitialize>(b"mpv_initialize\0").map_err(|e| e.to_string())?,
                set_option_string: *lib.get::<FnSetString>(b"mpv_set_option_string\0").map_err(|e| e.to_string())?,
                set_property_string: *lib.get::<FnSetString>(b"mpv_set_property_string\0").map_err(|e| e.to_string())?,
                get_property: *lib.get::<FnGetProperty>(b"mpv_get_property\0").map_err(|e| e.to_string())?,
                command: *lib.get::<FnCommand>(b"mpv_command\0").map_err(|e| e.to_string())?,
                command_string: *lib.get::<FnCommandString>(b"mpv_command_string\0").map_err(|e| e.to_string())?,
                observe_property: *lib.get::<FnObserveProperty>(b"mpv_observe_property\0").map_err(|e| e.to_string())?,
                wait_event: *lib.get::<FnWaitEvent>(b"mpv_wait_event\0").map_err(|e| e.to_string())?,
                set_wakeup_callback: *lib.get::<FnSetWakeupCallback>(b"mpv_set_wakeup_callback\0").map_err(|e| e.to_string())?,
                wakeup: *lib.get::<FnWakeup>(b"mpv_wakeup\0").map_err(|e| e.to_string())?,
                terminate_destroy: *lib.get::<FnTerminateDestroy>(b"mpv_terminate_destroy\0").map_err(|e| e.to_string())?,
                free: *lib.get::<FnFree>(b"mpv_free\0").map_err(|e| e.to_string())?,
                error_string: *lib.get::<FnErrorString>(b"mpv_error_string\0").map_err(|e| e.to_string())?,
                command_ret: lib.get::<FnCommandRet>(b"mpv_command_ret\0").ok().map(|symbol| *symbol),
                free_node_contents: lib.get::<FnFreeNodeContents>(b"mpv_free_node_contents\0").ok().map(|symbol| *symbol),
            }
        };
        // SAFETY: plain call into a bound symbol with no arguments.
        let version = unsafe { (fns.client_api_version)() };
        if version < MIN_API_VERSION {
            return Err(format!("libmpv client API {}.{} is older than the required 2.0", version >> 16, version & 0xffff));
        }
        Ok(LibMpv { fns, _lib: lib })
    }

    fn error_text(&self, code: c_int) -> String {
        // SAFETY: mpv_error_string returns a pointer to a static C string.
        unsafe {
            let ptr = (self.fns.error_string)(code);
            if ptr.is_null() { format!("mpv error {code}") } else { CStr::from_ptr(ptr).to_string_lossy().into_owned() }
        }
    }
}

/// One `mpv_handle`. libmpv itself is thread-safe for everything except
/// `mpv_wait_event`, which the engine only ever calls from its event thread.
pub struct MpvClient {
    lib: Arc<LibMpv>,
    handle: MpvHandle,
}

// SAFETY: see the struct comment; the raw handle is an opaque, thread-safe
// libmpv object.
unsafe impl Send for MpvClient {}
unsafe impl Sync for MpvClient {}

fn c_string(value: &str) -> Result<CString, PlayerError> {
    CString::new(value).map_err(|_| PlayerError::invalid_argument("string contains a NUL byte"))
}

impl MpvClient {
    /// Creates and initializes a handle. `options` are applied with
    /// `mpv_set_option_string` before `mpv_initialize`, which is the only
    /// point where `wid` and `vo` may be set. A rejected option is logged, not
    /// fatal — an older libmpv simply ignores what it does not know.
    pub fn create(lib: Arc<LibMpv>, options: &[(String, String)]) -> Result<MpvClient, PlayerError> {
        Self::create_requiring(lib, options, &[])
    }

    /// Like `create`, but an option named in `required` that libmpv rejects
    /// fails with `PlayerError::unsupported(name)` instead of a warning —
    /// how the clip encoder finds out that a build has no encoding (`o`).
    pub fn create_requiring(lib: Arc<LibMpv>, options: &[(String, String)], required: &[&str]) -> Result<MpvClient, PlayerError> {
        // SAFETY: mpv_create has no preconditions; a null return is checked.
        let handle = unsafe { (lib.fns.create)() };
        if handle.is_null() {
            return Err(PlayerError::engine_unavailable("mpv_create returned NULL"));
        }
        let client = MpvClient { lib, handle };
        for (name, value) in options {
            let (name_c, value_c) = (c_string(name)?, c_string(value)?);
            // SAFETY: valid handle, NUL-terminated strings outlive the call.
            let code = unsafe { (client.lib.fns.set_option_string)(client.handle, name_c.as_ptr(), value_c.as_ptr()) };
            if code < 0 {
                if required.contains(&name.as_str()) {
                    return Err(PlayerError::unsupported(format!("{name}: {}", client.lib.error_text(code))));
                }
                log::warn!("libmpv rejected option {name}={value}: {}", client.lib.error_text(code));
            }
        }
        // SAFETY: valid, not yet initialized handle.
        let code = unsafe { (client.lib.fns.initialize)(client.handle) };
        if code < 0 {
            return Err(PlayerError::engine_unavailable(format!("mpv_initialize failed: {}", client.lib.error_text(code))));
        }
        Ok(client)
    }

    fn check(&self, code: c_int) -> Result<(), PlayerError> {
        if code < 0 { Err(PlayerError::mpv(self.lib.error_text(code))) } else { Ok(()) }
    }

    fn get_raw<T: Copy>(&self, name: &str, format: c_int, mut slot: T) -> Option<T> {
        let name_c = c_string(name).ok()?;
        // SAFETY: `slot` is a properly sized out-parameter for `format`
        // (int/i64/f64/char* as chosen by the callers below).
        let code = unsafe {
            (self.lib.fns.get_property)(self.handle, name_c.as_ptr(), format, &mut slot as *mut T as *mut c_void)
        };
        (code >= 0).then_some(slot)
    }

    /// Reads a C string owned by mpv into a Rust `String`, then frees it.
    fn take_string(&self, ptr: *const c_char) -> Option<String> {
        if ptr.is_null() {
            return None;
        }
        // SAFETY: mpv returned a NUL-terminated string we own; it is freed
        // exactly once with mpv_free.
        unsafe {
            let value = CStr::from_ptr(ptr).to_string_lossy().into_owned();
            (self.lib.fns.free)(ptr as *mut c_void);
            Some(value)
        }
    }

    /// `screenshot-raw video`: the frame the VO last received (with
    /// `vo=null` too — mpv keeps the current frame in the VO core, not the
    /// driver), before subtitles/OSD, copied out of mpv's node map.
    pub fn screenshot_raw(&self) -> Result<RawFrame, PlayerError> {
        let (Some(command_ret), Some(free_node)) = (self.lib.fns.command_ret, self.lib.fns.free_node_contents) else {
            return Err(PlayerError::engine_unavailable("mpv_command_ret is not exported"));
        };
        let owned = [c_string("screenshot-raw")?, c_string("video")?];
        let mut argv: Vec<*const c_char> = owned.iter().map(|arg| arg.as_ptr()).collect();
        argv.push(std::ptr::null());
        let mut result = MpvNode { u: MpvNodeValue { int64: 0 }, format: MPV_FORMAT_NONE };
        // SAFETY: NULL-terminated argv of live C strings; `result` is a
        // valid out-node that mpv fills on success.
        let code = unsafe { command_ret(self.handle, argv.as_mut_ptr(), &mut result) };
        self.check(code)?;
        // SAFETY: on success `result` is an mpv-owned node tree; it is read
        // (copied) and then released exactly once.
        let frame = unsafe { read_raw_frame(&result) };
        unsafe { free_node(&mut result) };
        frame.ok_or_else(|| PlayerError::mpv("screenshot-raw returned an unexpected node"))
    }
}

/// Copies the `w`/`h`/`stride`/`format`/`data` entries of a
/// `screenshot-raw` result map.
///
/// # Safety
/// `node` must be a node tree returned by libmpv and not yet freed.
unsafe fn read_raw_frame(node: &MpvNode) -> Option<RawFrame> {
    if node.format != MPV_FORMAT_NODE_MAP || node.u.list.is_null() {
        return None;
    }
    let list = &*node.u.list;
    let (mut width, mut height, mut stride) = (0i64, 0i64, 0i64);
    let mut format = String::new();
    let mut data: Option<Vec<u8>> = None;
    for index in 0..usize::try_from(list.num).unwrap_or(0) {
        let key_ptr = *list.keys.add(index);
        if key_ptr.is_null() {
            continue;
        }
        let value = &*list.values.add(index);
        match CStr::from_ptr(key_ptr).to_bytes() {
            b"w" if value.format == MPV_FORMAT_INT64 => width = value.u.int64,
            b"h" if value.format == MPV_FORMAT_INT64 => height = value.u.int64,
            b"stride" if value.format == MPV_FORMAT_INT64 => stride = value.u.int64,
            b"format" if value.format == MPV_FORMAT_STRING && !value.u.string.is_null() => {
                format = CStr::from_ptr(value.u.string).to_string_lossy().into_owned();
            }
            b"data" if value.format == MPV_FORMAT_BYTE_ARRAY && !value.u.ba.is_null() => {
                let bytes = &*value.u.ba;
                if !bytes.data.is_null() {
                    data = Some(std::slice::from_raw_parts(bytes.data as *const u8, bytes.size).to_vec());
                }
            }
            _ => {}
        }
    }
    let (width, height, stride) = (u32::try_from(width).ok()?, u32::try_from(height).ok()?, usize::try_from(stride).ok()?);
    let data = data?;
    if width == 0 || height == 0 || stride < width as usize * 4 || data.len() < stride * height as usize {
        return None;
    }
    Some(RawFrame { width, height, stride, format, data })
}

impl Drop for MpvClient {
    fn drop(&mut self) {
        // SAFETY: the handle is valid and no other thread uses it any more —
        // the engine drops its Arc only after the event thread has exited.
        unsafe { (self.lib.fns.terminate_destroy)(self.handle) };
    }
}

fn format_code(format: PropertyFormat) -> c_int {
    match format {
        PropertyFormat::String => MPV_FORMAT_STRING,
        PropertyFormat::Flag => MPV_FORMAT_FLAG,
        PropertyFormat::Int64 => MPV_FORMAT_INT64,
        PropertyFormat::Double => MPV_FORMAT_DOUBLE,
    }
}

impl MpvApi for MpvClient {
    fn set_property(&self, name: &str, value: &str) -> Result<(), PlayerError> {
        let (name_c, value_c) = (c_string(name)?, c_string(value)?);
        // SAFETY: valid handle; strings outlive the call.
        self.check(unsafe { (self.lib.fns.set_property_string)(self.handle, name_c.as_ptr(), value_c.as_ptr()) })
    }

    fn get_property_i64(&self, name: &str) -> Option<i64> {
        self.get_raw::<i64>(name, MPV_FORMAT_INT64, 0)
    }

    fn get_property_f64(&self, name: &str) -> Option<f64> {
        self.get_raw::<f64>(name, MPV_FORMAT_DOUBLE, 0.0)
    }

    fn get_property_flag(&self, name: &str) -> Option<bool> {
        self.get_raw::<c_int>(name, MPV_FORMAT_FLAG, 0).map(|flag| flag != 0)
    }

    fn get_property_string(&self, name: &str) -> Option<String> {
        let ptr = self.get_raw::<*const c_char>(name, MPV_FORMAT_STRING, std::ptr::null())?;
        self.take_string(ptr)
    }

    fn command(&self, args: &[&str]) -> Result<(), PlayerError> {
        let owned: Vec<CString> = args.iter().map(|arg| c_string(arg)).collect::<Result<_, _>>()?;
        let mut argv: Vec<*const c_char> = owned.iter().map(|arg| arg.as_ptr()).collect();
        argv.push(std::ptr::null());
        // SAFETY: NULL-terminated argv of NUL-terminated strings, all alive
        // for the duration of the call.
        self.check(unsafe { (self.lib.fns.command)(self.handle, argv.as_mut_ptr()) })
    }

    fn observe_property(&self, id: u64, name: &str, format: PropertyFormat) -> Result<(), PlayerError> {
        let name_c = c_string(name)?;
        // SAFETY: valid handle; the name outlives the call.
        self.check(unsafe { (self.lib.fns.observe_property)(self.handle, id, name_c.as_ptr(), format_code(format)) })
    }

    fn wait_event(&self, timeout_secs: f64) -> MpvEvent {
        // SAFETY: the engine guarantees a single caller thread; the returned
        // event is valid until the next wait_event call and is copied out
        // here before returning.
        unsafe {
            let event = (self.lib.fns.wait_event)(self.handle, timeout_secs);
            if event.is_null() {
                return MpvEvent::Timeout;
            }
            let event = &*event;
            match event.event_id {
                MPV_EVENT_NONE => MpvEvent::Timeout,
                MPV_EVENT_SHUTDOWN => MpvEvent::Shutdown,
                MPV_EVENT_START_FILE => MpvEvent::StartFile,
                MPV_EVENT_FILE_LOADED => MpvEvent::FileLoaded,
                MPV_EVENT_PLAYBACK_RESTART => MpvEvent::PlaybackRestart,
                MPV_EVENT_END_FILE => {
                    let data = event.data as *const MpvEventEndFileRaw;
                    let reason = if data.is_null() { EndFileReason::Unknown } else { EndFileReason::from_raw((*data).reason) };
                    MpvEvent::EndFile(reason)
                }
                MPV_EVENT_PROPERTY_CHANGE => {
                    let property = event.data as *const MpvEventPropertyRaw;
                    if property.is_null() {
                        return MpvEvent::Other;
                    }
                    let property = &*property;
                    let name = if property.name.is_null() {
                        String::new()
                    } else {
                        CStr::from_ptr(property.name).to_string_lossy().into_owned()
                    };
                    let value = if property.data.is_null() {
                        PropertyValue::None
                    } else {
                        match property.format {
                            MPV_FORMAT_FLAG => PropertyValue::Flag(*(property.data as *const c_int) != 0),
                            MPV_FORMAT_INT64 => PropertyValue::Int(*(property.data as *const i64)),
                            MPV_FORMAT_DOUBLE => PropertyValue::Double(*(property.data as *const f64)),
                            MPV_FORMAT_STRING => {
                                let ptr = *(property.data as *const *const c_char);
                                if ptr.is_null() {
                                    PropertyValue::None
                                } else {
                                    PropertyValue::Str(CStr::from_ptr(ptr).to_string_lossy().into_owned())
                                }
                            }
                            MPV_FORMAT_NONE => PropertyValue::None,
                            _ => PropertyValue::None,
                        }
                    };
                    MpvEvent::PropertyChange { name, value }
                }
                _ => MpvEvent::Other,
            }
        }
    }

    fn wakeup(&self) {
        // SAFETY: valid handle; mpv_wakeup is safe from any thread.
        unsafe { (self.lib.fns.wakeup)(self.handle) };
    }
}

// Bound so the symbol set stays complete even though the engine drives the
// event thread with a blocking `wait_event` instead of the callback.
#[allow(dead_code)]
impl MpvClient {
    pub fn set_wakeup_callback(&self, callback: FnWakeupCallback, data: *mut c_void) {
        // SAFETY: valid handle; libmpv stores the pointer pair verbatim.
        unsafe { (self.lib.fns.set_wakeup_callback)(self.handle, callback, data) };
    }

    pub fn command_string(&self, command: &str) -> Result<(), PlayerError> {
        let command_c = c_string(command)?;
        // SAFETY: valid handle; the string outlives the call.
        self.check(unsafe { (self.lib.fns.command_string)(self.handle, command_c.as_ptr()) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidates_follow_resource_exe_env_order_and_skip_blank_env() {
        let resource = Path::new("/res");
        let exe = Path::new("/exe");
        let candidates = library_candidates(Some(resource), Some(exe), Some("  "));
        assert_eq!(candidates, vec![resource.join(library_file_name()), exe.join(library_file_name())]);

        let with_env = library_candidates(None, Some(exe), Some("/custom"));
        assert_eq!(with_env, vec![exe.join(library_file_name()), Path::new("/custom").join(library_file_name())]);
    }

    #[test]
    fn duplicate_directories_are_collapsed() {
        let dir = Path::new("/same");
        assert_eq!(library_candidates(Some(dir), Some(dir), None).len(), 1);
    }

    #[test]
    fn file_name_matches_the_platform() {
        let name = library_file_name();
        if cfg!(windows) {
            assert_eq!(name, "libmpv-2.dll");
        } else {
            assert!(name.starts_with("libmpv"));
        }
    }

    #[test]
    fn a_missing_library_is_reported_as_engine_unavailable() {
        let missing = Path::new("/definitely/not/here");
        // The default-loader fallback may succeed on a developer machine
        // with libmpv on PATH; only assert the failure shape otherwise.
        if let Err(error) = LibMpv::load(Some(missing), None) {
            assert_eq!(error.code, "engine_unavailable");
        }
    }
}
