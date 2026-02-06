use rustro_core::greet;
use rustro_core::GreetPayload;

#[tauri::command]
fn tauri_greet(payload: GreetPayload) -> String {
    greet(payload)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![tauri_greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
