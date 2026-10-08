// GitDesk on Tauri: a system webview plus the file and process primitives
// the engine needs. The engine itself runs in the webview (see ../web.ts).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod files;
mod processes;

use tauri::{Emitter, Manager};

#[tauri::command]
fn launch_args() -> Vec<String> {
    std::env::args().collect()
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
        ])
        .run(tauri::generate_context!())
        .expect("GitDesk failed to start");
}
