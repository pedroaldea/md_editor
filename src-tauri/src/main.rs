mod commands;

use commands::{
    export_logs, list_markdown_files, load_recovery_draft, open_document, save_as_document,
    save_document, store_recovery_draft,
};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{Emitter, Manager, RunEvent, State};

#[derive(Default)]
struct PendingOpenPath(Mutex<Option<String>>);

fn is_supported_open_path(path: &Path) -> bool {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    matches!(extension.as_str(), "md" | "markdown" | "txt")
}

fn first_launch_open_path() -> Option<String> {
    std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .find(|path| path.is_file() && is_supported_open_path(path))
        .map(|path| path.to_string_lossy().to_string())
}

fn maybe_emit_open_path(app: &tauri::AppHandle, path: PathBuf) {
    if !path.is_file() || !is_supported_open_path(&path) {
        return;
    }

    let path_string = path.to_string_lossy().to_string();
    if let Ok(mut pending_open_path) = app.state::<PendingOpenPath>().0.lock() {
        *pending_open_path = Some(path_string.clone());
    }
    let _ = app.emit("app://open-path", path_string);
}

#[tauri::command]
fn take_pending_open_path(state: State<'_, PendingOpenPath>) -> Option<String> {
    let mut pending_open_path = state.0.lock().ok()?;
    pending_open_path.take()
}

fn build_file_menu(app: &mut tauri::App) -> tauri::Result<()> {
    let file_menu = SubmenuBuilder::new(app, "File")
        .text("file_new", "New")
        .text("file_open", "Open...")
        .text("file_save", "Save")
        .text("file_save_as", "Save As...")
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some("Quit"))?)
        .build()?;

    let help_menu = SubmenuBuilder::new(app, "Help")
        .text("help_export_logs", "Export Logs...")
        .build()?;

    let menu = MenuBuilder::new(app)
        .item(&file_menu)
        .item(&help_menu)
        .build()?;
    app.set_menu(menu)?;
    Ok(())
}

fn emit_menu_command(app: &tauri::AppHandle, payload: &str) {
    let _ = app.emit("menu://command", payload);
}

fn main() {
    tauri::Builder::default()
        .manage(PendingOpenPath::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if let Some(path) = first_launch_open_path() {
                if let Ok(mut pending_open_path) = app.state::<PendingOpenPath>().0.lock() {
                    *pending_open_path = Some(path);
                }
            }
            build_file_menu(app)?;
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "file_new" => emit_menu_command(app, "new"),
            "file_open" => emit_menu_command(app, "open"),
            "file_save" => emit_menu_command(app, "save"),
            "file_save_as" => emit_menu_command(app, "save_as"),
            "help_export_logs" => emit_menu_command(app, "export_logs"),
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            open_document,
            save_document,
            save_as_document,
            load_recovery_draft,
            store_recovery_draft,
            list_markdown_files,
            export_logs,
            take_pending_open_path
        ])
        .build(tauri::generate_context!())
        .expect("error while building Md Editor")
        .run(|app, event| {
            if let RunEvent::Opened { urls } = event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        maybe_emit_open_path(app, path);
                        break;
                    }
                }
            }
        });
}
