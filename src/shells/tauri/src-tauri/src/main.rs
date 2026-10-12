// Genbeya on Tauri: a system webview plus the file and process primitives
// the managers need. The managers run in the webview (see src/platforms/tauri).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod files;
mod processes;
mod terminals;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::webview::NewWindowResponse;
use tauri::{App, AppHandle, Emitter, Manager, RunEvent, State, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_deep_link::DeepLinkExt;

/// Whether a page has had the links of this launch; a reloaded page must not open them again.
#[derive(Default)]
struct LinksHandedOver(AtomicBool);

fn is_link(arg: &str) -> bool {
    arg.get(..8).is_some_and(|scheme| scheme.eq_ignore_ascii_case("genbeya:"))
}

/// The launch arguments plus `links`, or without any link once they were handed over.
fn launch_arguments(args: impl Iterator<Item = String>, links: &[Url], handed_over: bool) -> Vec<String> {
    if handed_over {
        return args.filter(|arg| !is_link(arg)).collect();
    }
    args.chain(links.iter().map(Url::to_string)).collect()
}

/// The arguments of this launch, plus the Genbeya link that started it,
/// which only the first call gets. Windows and Linux pass links as
/// arguments, so there they appear twice; the client opens the first.
/// macOS hands them over as an event, which comes before the page can listen.
#[tauri::command]
fn launch_args(app: AppHandle, handed_over: State<'_, LinksHandedOver>) -> Vec<String> {
    let links = app.deep_link().get_current().ok().flatten().unwrap_or_default();
    launch_arguments(std::env::args(), &links, handed_over.0.swap(true, Ordering::SeqCst))
}

/// macOS hands over links that open while the app runs as events; they
/// reach the client like a second launch's arguments. Elsewhere a link
/// starts a second instance, whose arguments the single-instance plugin
/// forwards.
#[cfg(target_os = "macos")]
fn forward_opened_links(app: &App) {
    let handle = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        let urls: Vec<String> = event.urls().iter().map(Url::to_string).collect();
        let _ = handle.emit("open-request", urls);
    });
}

/// Installers register genbeya:// links; an AppImage registers itself when it
/// runs. That needs desktop tools the system may lack, which is no reason not
/// to start.
#[cfg(target_os = "linux")]
fn register_links(app: &App) {
    if app.env().appimage.is_none() {
        return;
    }
    if let Err(error) = app.deep_link().register_all() {
        eprintln!("Genbeya could not register genbeya:// links: {error}");
    }
}

/// The app's own pages: `tauri://localhost`, or `http(s)://tauri.localhost`
/// where the webview cannot load custom schemes (Windows, Android), plus the
/// dev server while developing.
fn is_app_url(url: &Url, dev_url: Option<&Url>) -> bool {
    match (url.scheme(), url.host_str(), url.port()) {
        ("tauri", Some("localhost"), None) | ("http" | "https", Some("tauri.localhost"), None) => true,
        _ => dev_url.is_some_and(|dev| dev.origin() == url.origin()),
    }
}

/// The main window, built here rather than in tauri.conf.json so it never
/// leaves the app: the commands trust whatever page it shows, and that page
/// renders repository content. Links open externally through the opener.
fn create_main_window(app: &App) -> tauri::Result<()> {
    let dev_url = app.config().build.dev_url.clone().filter(|_| tauri::is_dev());
    WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
        .title("Genbeya")
        .inner_size(1440.0, 920.0)
        .min_inner_size(960.0, 600.0)
        .disable_drag_drop_handler()
        .on_navigation(move |url| is_app_url(url, dev_url.as_ref()))
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .build()?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            let _ = app.emit("open-request", argv);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(processes::Processes::default())
        .manage(terminals::Terminals::default())
        .manage(LinksHandedOver::default())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            forward_opened_links(app);
            #[cfg(target_os = "linux")]
            register_links(app);
            Ok(create_main_window(app)?)
        })
        .invoke_handler(tauri::generate_handler![
            launch_args,
            files::fs_stat,
            files::fs_read,
            files::fs_write,
            files::fs_mkdir,
            files::fs_readdir,
            files::fs_rename,
            files::fs_remove,
            processes::proc_run,
            processes::proc_spawn,
            processes::proc_write,
            processes::proc_kill,
            terminals::term_shell,
            terminals::term_open,
            terminals::term_write,
            terminals::term_resize,
            terminals::term_kill,
            terminals::term_kill_all,
        ])
        .build(tauri::generate_context!())
        .expect("Genbeya failed to start")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<processes::Processes>().kill_all();
                app.state::<terminals::Terminals>().kill_all();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(text: &str) -> Url {
        Url::parse(text).unwrap()
    }

    #[test]
    fn navigates_only_within_the_app() {
        for page in ["tauri://localhost/index.html", "http://tauri.localhost/", "https://tauri.localhost/repo?x=1"] {
            assert!(is_app_url(&url(page), None), "{page}");
        }
        for page in ["https://example.com/", "http://tauri.localhost:8080/", "file:///C:/x.html", "about:blank"] {
            assert!(!is_app_url(&url(page), None), "{page}");
        }
        let dev = url("http://localhost:4200/");
        assert!(is_app_url(&url("http://localhost:4200/wiki"), Some(&dev)));
        assert!(!is_app_url(&url("http://localhost:4201/"), Some(&dev)));
    }

    #[test]
    fn hands_launch_links_over_once() {
        let args = || ["genbeya.exe", "Genbeya://open?remote=x&task=a", "--flag"].map(String::from).into_iter();
        let links = [url("genbeya://open?remote=x&task=a")];
        assert_eq!(
            launch_arguments(args(), &links, false),
            ["genbeya.exe", "Genbeya://open?remote=x&task=a", "--flag", "genbeya://open?remote=x&task=a"]
        );
        assert_eq!(launch_arguments(args(), &links, true), ["genbeya.exe", "--flag"]);
    }
}
