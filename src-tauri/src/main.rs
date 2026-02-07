mod commands;

use commands::{
    export_logs, list_markdown_files, load_recovery_draft, open_document, save_as_document,
    save_document, store_recovery_draft,
};
use tauri::menu::{MenuBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::Emitter;

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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
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
            export_logs
        ])
        .run(tauri::generate_context!())
        .expect("error while running Md Editor");
}
