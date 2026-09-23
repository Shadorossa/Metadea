use std::path::Path;

fn main() {
    println!("cargo:rerun-if-changed=icons");
    println!("cargo:rerun-if-changed=icons/icon.ico");
    build_rcheevos_hash();
    tauri_build::build();
}

// RetroAchievements game hashes are system-specific (rcheevos' rc_hash), not
// a plain MD5 of the file. When the vendored rcheevos tree exists
// (vendor/rcheevos, see its VENDORED.md) its rhash sources are compiled in
// and `cfg(rcheevos_vendored)` switches src/retro_achievements/hash.rs to
// the real FFI hasher. Without it the crate still builds and the hash-based
// lookup reports E_RA_HASH_UNAVAILABLE instead of silently hashing wrong.
fn build_rcheevos_hash() {
    println!("cargo:rustc-check-cfg=cfg(rcheevos_vendored)");
    println!("cargo:rerun-if-changed=vendor/rcheevos");
    let vendor = Path::new(env!("CARGO_MANIFEST_DIR")).join("vendor").join("rcheevos");
    if !vendor.join("include").join("rc_hash.h").exists() {
        return;
    }
    let rhash_dir = vendor.join("src").join("rhash");
    let mut sources: Vec<_> = std::fs::read_dir(&rhash_dir)
        .expect("read vendor/rcheevos/src/rhash")
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "c"))
        .collect();
    sources.sort();
    for compat in ["rc_compat.c", "rc_util.c", "rc_version.c"] {
        let path = vendor.join("src").join(compat);
        if path.exists() {
            sources.push(path);
        }
    }
    cc::Build::new()
        .files(sources)
        .include(vendor.join("include"))
        .include(vendor.join("src"))
        .include(&rhash_dir)
        .define("RC_DISABLE_LUA", None)
        .define("RC_STATIC", None)
        .define("_CRT_SECURE_NO_WARNINGS", None)
        .warnings(false)
        .compile("rcheevos_hash");
    println!("cargo:rustc-cfg=rcheevos_vendored");
}
