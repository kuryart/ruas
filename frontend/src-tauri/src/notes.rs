use crate::vault::VaultState;
use crate::RegistryState;
use ruas_core::{BacklinkMeta, BlockMeta, Note, NoteMeta, NoteTreeNode};

// ── Shared dispatch helper ─────────────────────────────────────────────────

fn dispatch(
    vault_state: &tauri::State<VaultState>,
    registry: &tauri::State<RegistryState>,
    command: &str,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let vault_path = crate::vault::get_vault_path(vault_state)?;
    registry.0.lock().unwrap().dispatch("ruas.notes", command, args, &vault_path)
}

// ── Typed commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_notes(
    state: tauri::State<VaultState>,
    registry: tauri::State<RegistryState>,
) -> Result<Vec<NoteMeta>, String> {
    let result = dispatch(&state, &registry, "list", serde_json::json!({}))?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_note(
    path: String,
    state: tauri::State<VaultState>,
    registry: tauri::State<RegistryState>,
) -> Result<Note, String> {
    let result = dispatch(&state, &registry, "read", serde_json::json!({ "path": path }))?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_notes(
    query: String,
    state: tauri::State<VaultState>,
    registry: tauri::State<RegistryState>,
) -> Result<Vec<NoteMeta>, String> {
    let result = dispatch(&state, &registry, "search", serde_json::json!({ "query": query }))?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_note(
    title: String,
    folder: Option<String>,
    state: tauri::State<VaultState>,
    registry: tauri::State<RegistryState>,
) -> Result<Note, String> {
    let result = dispatch(&state, &registry, "create", serde_json::json!({ "title": title, "folder": folder }))?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_note(
    note: Note,
    state: tauri::State<VaultState>,
    registry: tauri::State<RegistryState>,
) -> Result<(), String> {
    dispatch(&state, &registry, "save", serde_json::json!({ "note": note }))?;
    Ok(())
}

#[tauri::command]
pub fn delete_note(
    path: String,
    state: tauri::State<VaultState>,
    registry: tauri::State<RegistryState>,
) -> Result<(), String> {
    dispatch(&state, &registry, "delete", serde_json::json!({ "path": path }))?;
    Ok(())
}

#[tauri::command]
pub fn list_blocks(
    path: String,
    state: tauri::State<VaultState>,
    registry: tauri::State<RegistryState>,
) -> Result<Vec<BlockMeta>, String> {
    let result = dispatch(&state, &registry, "list_blocks", serde_json::json!({ "path": path }))?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_backlinks(
    path: String,
    state: tauri::State<VaultState>,
    registry: tauri::State<RegistryState>,
) -> Result<Vec<BacklinkMeta>, String> {
    let result = dispatch(&state, &registry, "backlinks", serde_json::json!({ "path": path }))?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_notes_tree(
    state: tauri::State<VaultState>,
    registry: tauri::State<RegistryState>,
) -> Result<Vec<NoteTreeNode>, String> {
    let result = dispatch(&state, &registry, "tree", serde_json::json!({}))?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_folder(
    name: String,
    state: tauri::State<VaultState>,
    registry: tauri::State<RegistryState>,
) -> Result<String, String> {
    let result = dispatch(&state, &registry, "create_folder", serde_json::json!({ "name": name }))?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_folder(
    path: String,
    state: tauri::State<VaultState>,
    registry: tauri::State<RegistryState>,
) -> Result<(), String> {
    dispatch(&state, &registry, "delete_folder", serde_json::json!({ "path": path }))?;
    Ok(())
}

#[tauri::command]
pub fn move_note(
    path: String,
    folder: String,
    state: tauri::State<VaultState>,
    registry: tauri::State<RegistryState>,
) -> Result<(), String> {
    dispatch(&state, &registry, "move", serde_json::json!({ "path": path, "folder": folder })).map(|_| ())
}

#[tauri::command]
pub fn get_notes_dir(
    state: tauri::State<VaultState>,
) -> Result<String, String> {
    Ok(crate::vault::get_vault_path(&state)?.join("notes").to_string_lossy().to_string())
}

#[tauri::command]
pub fn rename_note_folder(
    path: String,
    name: String,
    state: tauri::State<VaultState>,
    registry: tauri::State<RegistryState>,
) -> Result<String, String> {
    let result = dispatch(&state, &registry, "rename_folder", serde_json::json!({ "path": path, "name": name }))?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}
