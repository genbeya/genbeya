// GitDesk on Tauri: a system webview plus the file and process primitives
// the managers need. The managers run in the webview (see src/platforms/tauri).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod files;
mod processes;
mod terminals;

use tauri::webview::NewWindowResponse;
use tauri::{App, Emitter, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
fn launch_args() -> Vec<String> {
    std::env::args().collect()
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
        .title("GitDesk")
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(processes::Processes::default())
        .manage(terminals::Terminals::default())
        .setup(|app| Ok(create_main_window(app)?))
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
        ])
        .build(tauri::generate_context!())
        .expect("GitDesk failed to start")
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
}
