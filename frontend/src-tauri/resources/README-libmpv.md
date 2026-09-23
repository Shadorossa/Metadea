# libmpv for the built-in player

Metadea's built-in video player decodes and renders through **libmpv** (the
library only — mpv's own UI is disabled with `osc=no` /
`input-default-bindings=no`; every control is drawn by the app). The library
is loaded **at runtime** (`src/player/libmpv_ffi.rs`, via `libloading`), so
the app builds and runs without it: when it cannot be found, "Play" falls
back to VLC and shows a translated notice.

## 1. Get the LGPL build (scripted)

Run once per checkout (CI does the same before `cargo` / `tauri build`):

```powershell
powershell -File scripts/fetch-libmpv.ps1
```

It downloads the pinned **LGPL** `mpv-dev-lgpl-x86_64-*.7z` from
zhongfly/mpv-winbuild, verifies its SHA-256, and extracts `libmpv-2.dll`
into this folder. The DLL is git-ignored (≈100 MB). To update mpv, bump the
URL and hash in the script together. The client API must be **2.0 or
newer** (the app checks `mpv_client_api_version()` and refuses older ones).

## 2. Where to put it

Search order at runtime (first hit wins):

1. `<app resource dir>/libmpv-2.dll` — the bundled location (see step 3)
2. `<directory of Metadea.exe>/libmpv-2.dll` — handy for `tauri dev`
   (`src-tauri/target/debug/libmpv-2.dll`)
3. `%METADEA_MPV_DIR%\libmpv-2.dll` — an explicit override
4. the system loader's default search path (PATH)

For development, either drop the DLL into `src-tauri/target/debug/` or set
`METADEA_MPV_DIR` to the folder that holds it.

On Linux/macOS the file names are `libmpv.so.2` / `libmpv.2.dylib`; embedding
the video into the main window (the player overlay) is only implemented on
Windows so far (elsewhere mpv opens its own window).

If the transparent controls overlay misbehaves on a machine, switch
Settings > Environment > "Player controls" to the docked bar: no extra
window is created and the controls render in the page under the video.

## 3. Bundling it with the installer

Copy `libmpv-2.dll` into **this folder** (`src-tauri/resources/`) and add the
resource entry to `src-tauri/tauri.conf.json` under `bundle`:

```json
"bundle": {
  "resources": ["resources/libmpv-2.dll"],
  ...
}
```

The entry is deliberately **not** committed: Tauri fails the build when a
listed resource is missing, and a zero-match glob (`resources/*.dll`) is
rejected the same way (`GlobPathNotFound` in tauri-utils), so the line only
belongs in the config once the DLL is actually in place. The DLL itself
must not be committed either (`.gitignore` it if in doubt).

## Licensing note

libmpv (LGPL build) is dynamically loaded and unmodified; keep the LGPL
notice from the archive alongside the DLL when distributing.
