mod appearance;
mod contacts;
mod notes;
mod vault;
mod watcher;

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use tauri::Manager;
use vault::VaultState;

// ── Registry state ─────────────────────────────────────────────────────────

pub struct RegistryState(pub Arc<Mutex<ruas_core::ModuleRegistry>>);

fn build_registry(rename_guard: Arc<Mutex<HashSet<String>>>) -> ruas_core::ModuleRegistry {
    let mut registry = ruas_core::ModuleRegistry::new();
    registry.set_rename_guard(rename_guard);
    registry.register(ruas_core::ContactsModule::default());
    registry.register(ruas_core::NotesModule::default());
    // Future built-ins — add here as they are implemented:
    // registry.register(ruas_core::AgendaModule::default());
    // registry.register(ruas_core::CalendarModule::default());
    // registry.register(ruas_core::ProjectsModule::default());
    // registry.register(ruas_core::EmailModule::default());
    registry
}

// ── Watcher state ──────────────────────────────────────────────────────────

/// Holds the active file watcher. Dropping the inner value stops watching.
pub struct WatcherState(pub Mutex<Option<notify::RecommendedWatcher>>);

// ── Rename guard state ─────────────────────────────────────────────────────

/// Shared set of paths currently being renamed by the app.
/// Injected into VaultContext (for module commands) and the file watcher
/// (to suppress spurious FileDeleted events during programmatic renames).
pub struct RenameGuardState(pub Arc<Mutex<HashSet<String>>>);

// ── Generic module commands ────────────────────────────────────────────────

/// Generic dispatcher — the primary entry point for future plugins.
/// Routes any command to the correct module, enforces capabilities, and
/// propagates events emitted during the command.
#[tauri::command]
fn invoke_module(
    module_id: String,
    command: String,
    args: serde_json::Value,
    vault_state: tauri::State<VaultState>,
    registry: tauri::State<RegistryState>,
) -> Result<serde_json::Value, String> {
    let vault_path = vault::get_vault_path(&vault_state)?;
    registry.0.lock().unwrap().dispatch(&module_id, &command, args, &vault_path)
}

/// List all registered modules with their metadata, commands, and settings schema.
/// Useful for the plugin manager UI and for debugging.
#[tauri::command]
fn list_modules(registry: tauri::State<RegistryState>) -> serde_json::Value {
    let reg = registry.0.lock().unwrap();
    let entries: Vec<_> = reg
        .entries()
        .iter()
        .map(|entry| {
            serde_json::json!({
                "id":          entry.module.info().id,
                "name":        entry.module.info().name,
                "version":     entry.module.info().version.to_string(),
                "description": entry.module.info().description,
                "trust": match entry.trust {
                    ruas_core::TrustLevel::Core   => "core",
                    ruas_core::TrustLevel::Plugin => "plugin",
                },
                "capabilities": entry.module.capabilities().iter()
                    .map(|c| format!("{:?}", c))
                    .collect::<Vec<_>>(),
                "commands": entry.module.commands().iter().map(|c| serde_json::json!({
                    "name":            c.name,
                    "label_key":       c.label_key,
                    "description_key": c.description_key,
                    "params": c.params.iter().map(|p| serde_json::json!({
                        "name":     p.name,
                        "kind":     format!("{:?}", p.kind),
                        "required": p.required,
                    })).collect::<Vec<_>>(),
                })).collect::<Vec<_>>(),
                "settings": entry.module.settings_schema().iter().map(|s| serde_json::json!({
                    "key":              s.key,
                    "label_key":        s.label_key,
                    "description_key":  s.description_key,
                    "kind":             format!("{:?}", s.kind),
                    "required":         s.required,
                })).collect::<Vec<_>>(),
            })
        })
        .collect();
    serde_json::json!(entries)
}

/// Read all persisted settings for a module.
#[tauri::command]
fn get_module_settings(
    module_id: String,
    vault_state: tauri::State<VaultState>,
) -> Result<serde_json::Value, String> {
    let vault_path = vault::get_vault_path(&vault_state)?;
    Ok(ruas_core::ModuleSettings::for_module(&vault_path, &module_id).get_all())
}

/// Persist a full settings object for a module (replaces existing config).
#[tauri::command]
fn set_module_settings(
    module_id: String,
    settings: serde_json::Value,
    vault_state: tauri::State<VaultState>,
) -> Result<(), String> {
    let vault_path = vault::get_vault_path(&vault_state)?;
    ruas_core::ModuleSettings::for_module(&vault_path, &module_id).set_all(settings)
}

// ── Index commands ─────────────────────────────────────────────────────────

/// Full-text search across all indexed vault entities.
#[tauri::command]
fn search_index(
    query: String,
    limit: Option<usize>,
    registry: tauri::State<RegistryState>,
) -> Result<Vec<ruas_core::SearchResult>, String> {
    let reg = registry.0.lock().unwrap();
    let idx = reg.index().ok_or("Nenhum cofre aberto")?;
    idx.search(&query, limit.unwrap_or(20))
}

/// Resolve a `ruas://` UID to its current file path.
#[tauri::command]
fn resolve_uid(
    uid: String,
    registry: tauri::State<RegistryState>,
) -> Result<Option<String>, String> {
    let reg = registry.0.lock().unwrap();
    let idx = reg.index().ok_or("Nenhum cofre aberto")?;
    idx.path_for_uid(&uid)
}

// ── Entry point ────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let rename_guard: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(VaultState(Mutex::new(None)))
        .manage(RegistryState(Arc::new(Mutex::new(build_registry(Arc::clone(&rename_guard))))))
        .manage(WatcherState(Mutex::new(None)))
        .manage(RenameGuardState(Arc::clone(&rename_guard)))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Restore last vault if it's still valid
            if let Some(vault_path) = vault::load_last_vault(app.handle()) {
                if ruas_core::validate_vault(&vault_path).is_ok() {
                    *app.state::<VaultState>().0.lock().unwrap() = Some(vault_path.clone());

                    for (id, err) in app.state::<RegistryState>().0.lock().unwrap()
                        .on_vault_open(&vault_path)
                    {
                        log::warn!("Module '{id}' failed on vault restore: {err}");
                    }

                    let registry_arc = Arc::clone(&app.state::<RegistryState>().0);
                    let guard_arc = Arc::clone(&app.state::<RenameGuardState>().0);
                    match watcher::start(vault_path.clone(), registry_arc, app.handle().clone(), guard_arc) {
                        Ok(w) => *app.state::<WatcherState>().0.lock().unwrap() = Some(w),
                        Err(e) => log::warn!("Failed to start file watcher: {e}"),
                    }

                    #[cfg(debug_assertions)]
                    {
                        let is_empty = contacts::contacts_dir(&vault_path)
                            .read_dir()
                            .map(|mut d| d.next().is_none())
                            .unwrap_or(true);
                        if is_empty {
                            contacts::seed_sample_contacts(&vault_path);
                        }
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Generic module interface
            invoke_module,
            list_modules,
            get_module_settings,
            set_module_settings,
            // Index queries
            search_index,
            resolve_uid,
            // Vault management
            vault::select_folder,
            vault::new_vault,
            vault::open_vault,
            vault::get_active_vault,
            // Typed contacts commands (thin adapters over invoke_module)
            contacts::list_contacts,
            contacts::read_contact,
            contacts::save_contact,
            contacts::create_contact,
            contacts::delete_contact,
            // Typed notes commands (thin adapters over invoke_module)
            notes::list_notes,
            notes::read_note,
            notes::search_notes,
            notes::create_note,
            notes::save_note,
            notes::delete_note,
            notes::list_blocks,
            notes::get_backlinks,
            notes::list_notes_tree,
            notes::create_folder,
            notes::delete_folder,
            // Appearance (user themes & snippets)
            appearance::list_appearance,
            appearance::read_appearance_css,
            appearance::get_appearance_config,
            appearance::set_appearance_config,
            appearance::open_appearance_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
