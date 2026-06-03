use crate::vault::{get_vault_path, VaultState};
use ruas_core::{AppearanceConfig, AppearanceList};
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub fn list_appearance(state: tauri::State<VaultState>) -> Result<AppearanceList, String> {
    let vault = get_vault_path(&state)?;
    Ok(ruas_core::list_appearance(&vault))
}

#[tauri::command]
pub fn read_appearance_css(path: String, state: tauri::State<VaultState>) -> Result<String, String> {
    let vault = get_vault_path(&state)?;
    ruas_core::read_appearance_css(&vault, &path)
}

#[tauri::command]
pub fn get_appearance_config(state: tauri::State<VaultState>) -> Result<AppearanceConfig, String> {
    let vault = get_vault_path(&state)?;
    Ok(ruas_core::read_appearance_config(&vault))
}

#[tauri::command]
pub fn set_appearance_config(
    config: AppearanceConfig,
    state: tauri::State<VaultState>,
) -> Result<(), String> {
    let vault = get_vault_path(&state)?;
    ruas_core::write_appearance_config(&vault, &config)
}

#[tauri::command]
pub fn open_appearance_folder(
    kind: String,
    state: tauri::State<VaultState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let vault = get_vault_path(&state)?;
    let sub = if kind == "themes" { "themes" } else { "snippets" };
    let dir = vault.join(".ruas").join(sub);
    let _ = std::fs::create_dir_all(&dir);
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}
