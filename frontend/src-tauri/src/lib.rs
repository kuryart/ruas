mod appearance;
mod contacts;
mod notes;
mod plugins;
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

    // Load native plugins from the resources directory
    load_native_plugins(&mut registry);

    registry
}

/// Load native WASM plugins from `resources/plugins/` (embedded via build.rs).
fn load_native_plugins(registry: &mut ruas_core::ModuleRegistry) {
    let resources = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    // In dev mode, the resources are at the project root level.
    // Try several paths: relative to CWD (works with `cargo tauri dev`)
    // and relative to the workspace root (works with `cargo run --bin Ruas`).
    let plugins_dir = if cfg!(debug_assertions) {
        #[cfg(debug_assertions)]
        {
            let cwd = std::env::current_dir().unwrap_or_default();
            eprintln!("[native-plugins] CWD: {}", cwd.display());
        }

        let dev_paths = [
            std::path::PathBuf::from("resources/plugins"),                        // cwd = frontend/src-tauri/
            std::path::PathBuf::from("../resources/plugins"),                     // cwd = frontend/
            std::path::PathBuf::from("../../resources/plugins"),                  // cwd = frontend/src/ (Astro)
            std::path::PathBuf::from("frontend/src-tauri/resources/plugins"),     // cwd = repo root
        ];
        let mut found = None;
        for p in &dev_paths {
            eprintln!("[native-plugins] trying path: {} -> exists={}", p.display(), p.is_dir());
            if p.is_dir() {
                found = Some(p.clone());
                break;
            }
        }
        found.unwrap_or_else(|| std::path::PathBuf::from("resources/plugins"))
    } else {
        resources.join("resources/plugins")
    };

    eprintln!("[native-plugins] resolved plugins_dir: {}", plugins_dir.display());

    if !plugins_dir.is_dir() {
        eprintln!("[native-plugins] DIRECTORY NOT FOUND, giving up.");
        log::info!("[native-plugins] Directory not found: {}", plugins_dir.display());
        return;
    }

    for entry in std::fs::read_dir(&plugins_dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if !path.is_dir() {
            eprintln!("[native-plugins] skipping non-dir: {}", path.display());
            continue;
        }
        let manifest_path = path.join("manifest.json");
        if !manifest_path.exists() {
            eprintln!("[native-plugins] skipping (no manifest): {}", path.display());
            continue;
        }

        eprintln!("[native-plugins] found plugin dir: {}", path.display());

        match ruas_core::plugin::load_manifest(&manifest_path) {
            Ok(manifest) => {
                eprintln!("[native-plugins] manifest loaded: id={}", manifest.id);
                match ruas_core::plugin::wasm::try_load_plugin_from_dir(&path, &manifest) {
                    Ok(wasm_plugin) => {
                        registry.register_native(wasm_plugin);
                        eprintln!(
                            "[native-plugins] REGISTERED: {} v{}",
                            manifest.id,
                            manifest.version
                        );
                        log::info!(
                            "[native-plugins] Loaded: {} v{}",
                            manifest.id,
                            manifest.version
                        );
                    }
                    Err(e) => {
                        eprintln!("[native-plugins] FAILED to load '{}': {e}", manifest.id);
                        log::warn!(
                            "[native-plugins] Failed to load '{}': {e}",
                            manifest.id
                        );
                    }
                }
            }
            Err(e) => {
                eprintln!("[native-plugins] invalid manifest in '{}': {e}", path.display());
                log::warn!(
                    "[native-plugins] Invalid manifest in '{}': {e}",
                    path.display()
                );
            }
        }
    }
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
                    ruas_core::TrustLevel::Native => "native",
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
/// Uses Tantivy for BM25 scoring, then applies Frecency + Context scoring.
#[tauri::command]
fn search_index(
    query: String,
    limit: Option<usize>,
    registry: tauri::State<RegistryState>,
) -> Result<Vec<ruas_core::SearchResult>, String> {
    let reg = registry.0.lock().unwrap();
    let idx = reg.index().ok_or("Nenhum cofre aberto")?;
    let tantivy = reg.tantivy().ok_or("Tantivy não disponível")?;

    let limit = limit.unwrap_or(20);

    // 1. Get raw BM25 hits from Tantivy (fetch more for re-scoring).
    let raw_limit = (limit * 3).min(ruas_core::scorer::RAW_HIT_LIMIT);
    let tantivy_hits = tantivy.search(&query, raw_limit)?;

    // 2. Convert to SearchResult with bm25_score populated.
    let raw_results: Vec<ruas_core::SearchResult> = tantivy_hits
        .into_iter()
        .map(|h| ruas_core::SearchResult {
            path: h.path,
            uid: h.uid,
            entity: h.entity,
            title: h.title,
            snippet: String::new(), // Tantivy doesn't generate snippets yet
            rank: h.bm25_score,
            bm25_score: h.bm25_score,
            final_score: h.bm25_score, // placeholder, scorer overrides
        })
        .collect();

    // 3. Apply smart scoring (Frecency + Context).
    let last_path = reg
        .last_selected_arc()
        .read()
        .ok()
        .and_then(|g| g.clone());

    ruas_core::scorer::apply_smart_scoring(
        raw_results,
        idx,
        last_path.as_deref(),
        limit,
    )
}

/// Record an access to a file (frecency tracking).
/// Called as fire-and-forget from the frontend when a user opens an entity.
#[tauri::command]
fn record_access(
    path: String,
    registry: tauri::State<RegistryState>,
) -> Result<(), String> {
    let reg = registry.0.lock().unwrap();
    reg.record_access(&path)
}

/// Set the last entity the user selected (for context-based search scoring).
#[tauri::command]
fn set_last_selected_entity(
    path: Option<String>,
    registry: tauri::State<RegistryState>,
) {
    let reg = registry.0.lock().unwrap();
    reg.set_last_selected(path);
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
            record_access,
            set_last_selected_entity,
            // Vault management
            vault::select_folder,
            vault::new_vault,
            vault::open_vault,
            vault::get_active_vault,
            // Typed contacts commands (thin adapters over invoke_module)
            contacts::list_contacts,
            contacts::list_contacts_tree,
            contacts::read_contact,
            contacts::save_contact,
            contacts::create_contact,
            contacts::delete_contact,
            contacts::create_contact_folder,
            contacts::delete_contact_folder,
            contacts::move_contact,
            contacts::get_contacts_dir,
            contacts::rename_contact_folder,
            contacts::search_contacts,
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
            notes::move_note,
            notes::get_notes_dir,
            notes::rename_note_folder,
            // Appearance (user themes & snippets)
            appearance::list_appearance,
            appearance::read_appearance_css,
            appearance::get_appearance_config,
            appearance::set_appearance_config,
            appearance::open_appearance_folder,
            // Plugin management
            plugins::list_plugins,
            plugins::enable_plugin,
            plugins::disable_plugin,
            plugins::uninstall_plugin,
            plugins::install_plugin_files,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
