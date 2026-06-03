use crate::{RegistryState, WatcherState};
use ruas_core::{create_vault, validate_vault};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

pub struct VaultState(pub Mutex<Option<PathBuf>>);

#[derive(Debug, Clone, Serialize)]
pub struct VaultInfo {
    pub path: String,
    pub name: String,
}

// ── Helpers ────────────────────────────────────────────────────────────────

fn last_vault_file(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("last_vault.json")
}

pub fn load_last_vault(app: &tauri::AppHandle) -> Option<PathBuf> {
    let content = fs::read_to_string(last_vault_file(app)).ok()?;
    let val: serde_json::Value = serde_json::from_str(&content).ok()?;
    val["path"].as_str().map(PathBuf::from)
}

fn persist_vault(app: &tauri::AppHandle, path: &Path) {
    if let Ok(dir) = app.path().app_config_dir() {
        let _ = fs::create_dir_all(&dir);
    }
    let json = serde_json::json!({ "path": path.to_string_lossy() }).to_string();
    let _ = fs::write(last_vault_file(app), json);
}

fn read_vault_name(vault_path: &Path) -> String {
    let config_path = vault_path.join(".ruas").join("config.json");
    fs::read_to_string(&config_path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v["name"].as_str().map(String::from))
        .unwrap_or_else(|| {
            vault_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default()
        })
}

/// Extract the active vault path from state, returning an error if no vault is open.
pub fn get_vault_path(state: &tauri::State<VaultState>) -> Result<PathBuf, String> {
    state
        .0
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "Nenhum cofre aberto".to_string())
}

/// Stop any existing watcher, run registry lifecycle, then start a fresh watcher.
fn activate_vault(
    app: &tauri::AppHandle,
    vault_path: &PathBuf,
    registry: &tauri::State<RegistryState>,
    watcher_state: &tauri::State<WatcherState>,
) {
    // Drop old watcher before opening registry for new vault
    *watcher_state.0.lock().unwrap() = None;

    for (id, err) in registry.0.lock().unwrap().on_vault_open(vault_path) {
        log::warn!("Module '{id}' failed on vault open: {err}");
    }

    let registry_arc = Arc::clone(&registry.0);
    match crate::watcher::start(vault_path.clone(), registry_arc, app.clone()) {
        Ok(w) => *watcher_state.0.lock().unwrap() = Some(w),
        Err(e) => log::warn!("Failed to start file watcher: {e}"),
    }
}

// ── Commands ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn select_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<tauri_plugin_dialog::FilePath>>();
    let tx = std::sync::Mutex::new(Some(tx));
    app.dialog().file().pick_folder(move |path| {
        if let Some(sender) = tx.lock().unwrap().take() {
            let _ = sender.send(path);
        }
    });
    rx.await
        .map_err(|_| "Erro no diálogo".to_string())
        .map(|opt| opt.map(|p| p.to_string()))
}

#[tauri::command]
pub fn new_vault(
    app: tauri::AppHandle,
    vault_state: tauri::State<VaultState>,
    registry: tauri::State<RegistryState>,
    watcher_state: tauri::State<WatcherState>,
    path: String,
    name: String,
) -> Result<VaultInfo, String> {
    let vault_path = PathBuf::from(&path);
    create_vault(&vault_path, name.trim())?;

    activate_vault(&app, &vault_path, &registry, &watcher_state);

    persist_vault(&app, &vault_path);
    *vault_state.0.lock().unwrap() = Some(vault_path);
    Ok(VaultInfo { path, name: name.trim().to_string() })
}

#[tauri::command]
pub fn open_vault(
    app: tauri::AppHandle,
    vault_state: tauri::State<VaultState>,
    registry: tauri::State<RegistryState>,
    watcher_state: tauri::State<WatcherState>,
    path: String,
) -> Result<VaultInfo, String> {
    let vault_path = PathBuf::from(&path);
    let config = validate_vault(&vault_path)?;

    activate_vault(&app, &vault_path, &registry, &watcher_state);

    persist_vault(&app, &vault_path);
    *vault_state.0.lock().unwrap() = Some(vault_path);
    Ok(VaultInfo { path, name: config.name })
}

#[tauri::command]
pub fn get_active_vault(state: tauri::State<VaultState>) -> Option<VaultInfo> {
    let guard = state.0.lock().unwrap();
    let path = guard.as_ref()?;
    let name = read_vault_name(path);
    Some(VaultInfo {
        path: path.to_string_lossy().to_string(),
        name,
    })
}
