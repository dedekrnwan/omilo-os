//! Omilo for macOS.
//!
//! The app is a thin native shell around the bundled runtime (see scripts/desktop/build-runtime.sh):
//!   1. It shows a start screen (../splash) and starts the bundled Python with `-m omilo_api.desktop`, which runs
//!      Postgres, Valkey and the Omilo gateway on 127.0.0.1 and prints `OMILO_READY <url>` when the office is open.
//!   2. The window then loads that address. The page gets a small bridge (`window.omiloDesktop`) for Mac
//!      notifications, the Dock badge and opening links in the default browser.
//!   3. Closing the window keeps Omilo running in the menu bar, so helpers keep working; Quit stops everything
//!      cleanly (the launcher shuts Postgres down properly, so no data is lost).

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::webview::DownloadEvent;
use tauri::{
    AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as _};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use url::Url;

const SPLASH: &str = "index.html";

/// What the page in the window can call (runs on every page; only acts on the local office).
const BRIDGE: &str = r#"
(function () {
  var local = /^https?:$/.test(location.protocol) && (location.hostname === "127.0.0.1" || location.hostname === "localhost");
  if (!local || window.omiloDesktop) return;
  function inv(cmd, args) {
    try { var i = window.__TAURI_INTERNALS__; if (i) return i.invoke(cmd, args || {}).catch(function () {}); } catch (e) {}
  }
  window.omiloDesktop = {
    app: "macos",
    notify: function (n) { inv("notify", { title: String(n.title || "Omilo"), body: String(n.body || ""), url: String(n.url || "") }); },
    openExternal: function (u) { inv("open_external", { url: String(u) }); }
  };
  // the Inbox count Omilo puts in the title, "(3) Omilo", becomes the Dock badge
  var last = -1;
  setInterval(function () {
    var m = /^\((\d+)\)/.exec(document.title || ""), n = m ? +m[1] : 0;
    if (n !== last) { last = n; inv("set_badge", { count: n }); }
  }, 1500);
  // links to other sites open in the default browser, not inside the app
  function outside(href) {
    try { var x = new URL(href, location.href); return x.origin !== location.origin && /^(https?|mailto):$/.test(x.protocol) ? x.href : null; } catch (e) { return null; }
  }
  var open = window.open;
  window.open = function (u) { var x = u && outside(u); if (x) { inv("open_external", { url: x }); return null; } return open.apply(window, arguments); };
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest && e.target.closest("a[href]");
    var x = a && outside(a.getAttribute("href"));
    if (x) { e.preventDefault(); inv("open_external", { url: x }); }
  }, true);
})();
"#;

#[derive(Default, Clone, Serialize)]
struct Shown {
    status: String,
    error: Option<String>,
    url: Option<String>,
}

#[derive(Default)]
struct Backend {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
    shown: Mutex<Shown>,
    quitting: AtomicBool,
    stopped: AtomicBool,
}

fn data_dir(app: &AppHandle) -> PathBuf {
    if let Ok(d) = std::env::var("OMILO_DESKTOP_DATA") {
        return PathBuf::from(d);
    }
    let home = app
        .path()
        .home_dir()
        .unwrap_or_else(|_| PathBuf::from("/tmp"));
    home.join("Library")
        .join("Application Support")
        .join("Omilo")
}

fn runtime_dir(app: &AppHandle) -> PathBuf {
    if let Ok(d) = std::env::var("OMILO_RUNTIME_DIR") {
        return PathBuf::from(d); // development: a runtime built with scripts/desktop/build-runtime.sh
    }
    app.path()
        .resource_dir()
        .map(|r| r.join("runtime"))
        .unwrap_or_default()
}

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

fn splash_url(error: Option<&str>) -> Url {
    let mut u = Url::parse(if cfg!(windows) {
        "http://tauri.localhost/"
    } else {
        "tauri://localhost/"
    })
    .unwrap();
    u.set_path(SPLASH);
    if let Some(e) = error {
        u.query_pairs_mut().append_pair("error", e);
    }
    u
}

fn show(app: &AppHandle) {
    if let Some(w) = window(app) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn set_shown(app: &AppHandle, f: impl FnOnce(&mut Shown)) {
    let b = app.state::<Arc<Backend>>();
    let snapshot = {
        let mut s = b.shown.lock().unwrap();
        f(&mut s);
        s.clone()
    };
    let _ = app.emit("backend", snapshot);
}

/// Start the bundled runtime and follow what it says.
fn start_backend(app: &AppHandle) {
    let b = app.state::<Arc<Backend>>().inner().clone();
    if b.child.lock().unwrap().is_some() {
        return;
    }
    b.stopped.store(false, Ordering::SeqCst);
    let runtime = runtime_dir(app);
    let data = data_dir(app);
    let python = std::env::var("OMILO_DESKTOP_PYTHON")
        .map(PathBuf::from)
        .unwrap_or_else(|_| runtime.join("python").join("bin").join("python3"));
    let logs = data.join("logs");
    let _ = std::fs::create_dir_all(&logs);
    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(logs.join("omilo.log"));

    set_shown(app, |s| {
        s.status = "Starting…".into();
        s.error = None;
        s.url = None;
    });
    let mut cmd = Command::new(&python);
    cmd.args(["-m", "omilo_api.desktop", "--watch-stdin", "--runtime"])
        .arg(&runtime)
        .arg("--data")
        .arg(&data)
        .env("PYTHONNOUSERSITE", "1")
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONDONTWRITEBYTECODE", "1") // the app bundle is read-only (and signed); bytecode is built in
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(match log {
            Ok(f) => Stdio::from(f),
            Err(_) => Stdio::null(),
        });
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let msg = format!("Could not start Omilo's engine ({}): {e}", python.display());
            set_shown(app, |s| s.error = Some(msg.clone()));
            return;
        }
    };
    let stdout = child.stdout.take().unwrap();
    *b.stdin.lock().unwrap() = child.stdin.take();
    *b.child.lock().unwrap() = Some(child);

    let app = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let (kind, rest) = line.split_once(' ').unwrap_or((line.as_str(), ""));
            eprintln!("[omilo] {line}");
            match kind {
                "OMILO_STATUS" => set_shown(&app, |s| s.status = rest.to_string()),
                "OMILO_READY" | "OMILO_ALREADY" if !rest.is_empty() => {
                    let url = rest.trim().to_string();
                    set_shown(&app, |s| s.url = Some(url.clone()));
                    if let (Some(w), Ok(u)) = (window(&app), Url::parse(&url)) {
                        if let Err(e) = w.navigate(u) {
                            eprintln!("[omilo] could not open {url}: {e}");
                        }
                    }
                }
                "OMILO_ALREADY" => set_shown(&app, |s| {
                    s.error = Some("Omilo is already running from another copy of the app.".into())
                }),
                "OMILO_ERROR" => set_shown(&app, |s| s.error = Some(rest.to_string())),
                _ => {}
            }
        }
        // the engine stopped
        let b = app.state::<Arc<Backend>>().inner().clone();
        if let Some(mut c) = b.child.lock().unwrap().take() {
            let _ = c.wait();
        }
        b.stdin.lock().unwrap().take();
        b.stopped.store(true, Ordering::SeqCst);
        if b.quitting.load(Ordering::SeqCst) {
            return;
        }
        let err = b
            .shown
            .lock()
            .unwrap()
            .error
            .clone()
            .unwrap_or_else(|| "Omilo stopped unexpectedly.".into());
        set_shown(&app, |s| {
            s.error = Some(err.clone());
            s.url = None;
        });
        if let Some(w) = window(&app) {
            let _ = w.navigate(splash_url(Some(&err)));
            let _ = w.set_badge_count(None);
        }
    });
}

/// Ask the engine to stop (it shuts Postgres down cleanly) and wait for it.
fn stop_backend(app: &AppHandle, wait: Duration) {
    let b = app.state::<Arc<Backend>>().inner().clone();
    b.stdin.lock().unwrap().take(); // closing stdin is the polite signal
    let pid = b.child.lock().unwrap().as_ref().map(|c| c.id());
    if let Some(pid) = pid {
        let _ = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status();
    }
    let end = Instant::now() + wait;
    while Instant::now() < end
        && !b.stopped.load(Ordering::SeqCst)
        && b.child.lock().unwrap().is_some()
    {
        std::thread::sleep(Duration::from_millis(100));
    }
    let leftover = b.child.lock().unwrap().take();
    if let Some(mut c) = leftover {
        let _ = c.kill();
        let _ = c.wait();
    }
}

// ------------------------------------------------------------------ commands
#[tauri::command]
fn backend_state(state: tauri::State<'_, Arc<Backend>>) -> Shown {
    state.shown.lock().unwrap().clone()
}

#[tauri::command]
fn retry(app: AppHandle) {
    std::thread::spawn(move || {
        stop_backend(&app, Duration::from_secs(20));
        start_backend(&app);
    });
}

#[tauri::command]
fn open_logs(app: AppHandle) {
    let logs = data_dir(&app).join("logs").join("omilo.log");
    let _ = app.opener().reveal_item_in_dir(logs);
}

#[tauri::command]
fn notify(app: AppHandle, title: String, body: String, url: String) {
    let _ = url; // clicking a Mac notification brings Omilo to the front; the Inbox shows the item
    let _ = app.notification().builder().title(title).body(body).show();
}

#[tauri::command]
fn set_badge(app: AppHandle, count: i64) {
    if let Some(w) = window(&app) {
        let _ = w.set_badge_count(if count > 0 { Some(count) } else { None });
    }
}

#[tauri::command]
fn open_external(app: AppHandle, url: String) {
    if let Ok(u) = Url::parse(&url) {
        if matches!(u.scheme(), "http" | "https" | "mailto") {
            let _ = app.opener().open_url(u.as_str(), None::<&str>);
        }
    }
}

/// Quit: hide the window, stop the engine cleanly (up to 40 s), then exit.
fn begin_quit(app: &AppHandle) {
    let b = app.state::<Arc<Backend>>().inner().clone();
    if b.quitting.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Some(w) = window(app) {
        let _ = w.hide();
    }
    let app = app.clone();
    std::thread::spawn(move || {
        stop_backend(&app, Duration::from_secs(40));
        app.exit(0);
    });
}

#[tauri::command]
fn quit(app: AppHandle) {
    begin_quit(&app);
}

// ------------------------------------------------------------------ window, menu bar
fn is_local(u: &Url) -> bool {
    matches!(u.scheme(), "tauri" | "asset" | "about" | "data" | "blob")
        || (matches!(u.scheme(), "http" | "https")
            && matches!(
                u.host_str(),
                Some("127.0.0.1") | Some("localhost") | Some("tauri.localhost")
            ))
}

fn build_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let nav_app = app.clone();
    let dl_app = app.clone();
    let downloads = app.path().download_dir().unwrap_or_else(|_| data_dir(app));
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App(SPLASH.into()))
        .title("Omilo")
        .inner_size(1280.0, 820.0)
        .min_inner_size(880.0, 600.0)
        .center()
        .initialization_script(BRIDGE)
        .on_navigation(move |u| {
            if is_local(u) {
                return true;
            }
            if matches!(u.scheme(), "http" | "https" | "mailto") {
                let _ = nav_app.opener().open_url(u.as_str(), None::<&str>);
            }
            false
        })
        .on_download(move |_w, event| {
            match event {
                DownloadEvent::Requested { url, destination } => {
                    // save into Downloads under the file's own name, never overwriting
                    let name = destination
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .filter(|n| !n.is_empty())
                        .or_else(|| {
                            url.path_segments()
                                .and_then(|mut s| s.next_back().map(|x| x.to_string()))
                        })
                        .unwrap_or_else(|| "download".into());
                    let mut path = downloads.join(&name);
                    let (stem, ext) = match name.rsplit_once('.') {
                        Some((s, e)) => (s.to_string(), format!(".{e}")),
                        None => (name.clone(), String::new()),
                    };
                    let mut i = 1;
                    while path.exists() {
                        path = downloads.join(format!("{stem} ({i}){ext}"));
                        i += 1;
                    }
                    *destination = path;
                }
                DownloadEvent::Finished {
                    path: Some(p),
                    success: true,
                    ..
                } => {
                    let _ = dl_app.opener().reveal_item_in_dir(p);
                }
                _ => {}
            }
            true
        })
        .build()
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Omilo", true, None::<&str>)?;
    let browser = MenuItem::with_id(app, "browser", "Open in Browser", true, None::<&str>)?;
    let login = CheckMenuItem::with_id(
        app,
        "login",
        "Open at Login",
        true,
        app.autolaunch().is_enabled().unwrap_or(false),
        None::<&str>,
    )?;
    let folder = MenuItem::with_id(app, "folder", "Show Data Folder", true, None::<&str>)?;
    let logs = MenuItem::with_id(app, "logs", "Show Logs", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Omilo", true, Some("CmdOrCtrl+Q"))?;
    let sep = || PredefinedMenuItem::separator(app);
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &browser,
            &sep()?,
            &login,
            &folder,
            &logs,
            &sep()?,
            &quit,
        ],
    )?;

    let res = app.path().resource_dir().unwrap_or_default();
    let mut tray = TrayIconBuilder::with_id("omilo")
        .tooltip("Omilo")
        .menu(&menu)
        .show_menu_on_left_click(true);
    if let Ok(icon) = tauri::image::Image::from_path(res.join("tray@2x.png"))
        .or_else(|_| tauri::image::Image::from_path(res.join("tray.png")))
    {
        tray = tray.icon(icon).icon_as_template(true);
    } else if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    let login_item = login.clone();
    tray.on_menu_event(move |app, e| match e.id().as_ref() {
        "open" => show(app),
        "browser" => {
            if let Some(u) = app
                .state::<Arc<Backend>>()
                .shown
                .lock()
                .unwrap()
                .url
                .clone()
            {
                let _ = app.opener().open_url(u, None::<&str>);
            }
        }
        "login" => {
            let al = app.autolaunch();
            let on = al.is_enabled().unwrap_or(false);
            let _ = if on { al.disable() } else { al.enable() };
            let _ = login_item.set_checked(al.is_enabled().unwrap_or(!on));
        }
        "folder" => {
            let _ = app
                .opener()
                .open_path(data_dir(app).to_string_lossy(), None::<&str>);
        }
        "logs" => open_logs(app.clone()),
        "quit" => begin_quit(app),
        _ => {}
    })
    .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show(app)
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(Arc::new(Backend::default()))
        .invoke_handler(tauri::generate_handler![
            backend_state,
            retry,
            open_logs,
            notify,
            set_badge,
            open_external,
            quit
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            build_window(&handle)?;
            build_tray(&handle)?;
            start_backend(&handle);
            Ok(())
        })
        .on_window_event(|w, e| {
            if let WindowEvent::CloseRequested { api, .. } = e {
                // closing the window keeps the office running in the menu bar
                if !w
                    .app_handle()
                    .state::<Arc<Backend>>()
                    .quitting
                    .load(Ordering::SeqCst)
                {
                    api.prevent_close();
                    let _ = w.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Omilo");

    app.run(|app, event| match event {
        RunEvent::ExitRequested { api, .. } => {
            let b = app.state::<Arc<Backend>>().inner().clone();
            if b.stopped.load(Ordering::SeqCst) || b.child.lock().unwrap().is_none() {
                return; // nothing running: quit now
            }
            api.prevent_exit(); // Cmd+Q: stop the engine first; begin_quit exits when it is done
            begin_quit(app);
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => show(app),
        _ => {}
    });
}
