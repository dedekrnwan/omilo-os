fn main() {
    // the app's own commands get permissions (allow-<name>), so capabilities can grant them to the office page,
    // which is served from 127.0.0.1 (a "remote" origin to Tauri)
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "backend_state",
            "retry",
            "open_logs",
            "notify",
            "set_badge",
            "open_external",
            "quit",
        ]),
    ))
    .expect("failed to run tauri-build");
}
