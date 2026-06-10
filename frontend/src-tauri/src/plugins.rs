// ── Plugin management Tauri commands ─────────────────────────────────────────

use crate::vault::VaultState;
use crate::RegistryState;
use serde::Serialize;
use tauri::State;

// ── Types returned to the frontend ──────────────────────────────────────────

#[derive(Serialize)]
pub struct PluginEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub trust: String,
    pub kind: String,
    pub capabilities: Vec<String>,
    pub approved: Vec<String>,
    pub enabled: bool,
}

/// List all plugins — both built-in core modules and community plugins
/// discovered in `<vault>/.ruas/plugins/`.
#[tauri::command]
pub fn list_plugins(
    registry: State<RegistryState>,
    vault_state: State<VaultState>,
) -> Vec<PluginEntry> {
    let vault_path = crate::vault::get_vault_path(&vault_state).ok();
    let reg = registry.0.lock().unwrap();

    // Core modules from the registry
    let mut entries: Vec<PluginEntry> = reg
        .entries()
        .iter()
        .map(|e| PluginEntry {
            id: e.module.info().id.clone(),
            name: e.module.info().name.clone(),
            version: e.module.info().version.to_string(),
            description: e.module.info().description.clone(),
            author: String::new(),
            trust: format!("{:?}", e.trust).to_lowercase(),
            kind: "wasm".to_string(),
            capabilities: e
                .module
                .capabilities()
                .iter()
                .map(|c| format!("{c:?}"))
                .collect(),
            approved: e
                .approved_capabilities()
                .iter()
                .map(|c| format!("{c:?}"))
                .collect(),
            enabled: true, // core & native registry-loaded modules are always enabled
        })
        .collect();

    // Add discovered (installed) plugin manifests that aren't yet loaded
    if let Some(ref vp) = vault_path {
        let manifests = ruas_core::plugin::discover_plugins(vp);
        for mf in manifests {
            let already_loaded = entries.iter().any(|e| e.id == mf.id);
            if !already_loaded {
                entries.push(PluginEntry {
                    id: mf.id.clone(),
                    name: mf.name.clone(),
                    version: mf.version.to_string(),
                    description: mf.description.clone(),
                    author: mf.author.clone(),
                    trust: "plugin".to_string(),
                    kind: mf.kind.clone(),
                    capabilities: mf
                        .capabilities
                        .iter()
                        .map(|c| format!("{c:?}"))
                        .collect(),
                    approved: vec![],
                    enabled: false,
                });
            }
        }
    }

    entries
}

/// Enable a plugin. Currently only toggles the persisted enabled state.
/// WASM loading (Phase B) will load the plugin into the registry here.
#[tauri::command]
pub fn enable_plugin(
    plugin_id: String,
    vault_state: State<VaultState>,
) -> Result<(), String> {
    let vault_path = crate::vault::get_vault_path(&vault_state)?;
    let config_path = ruas_core::plugin::plugin_dir(&vault_path, &plugin_id)
        .join("config.json");
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let config = serde_json::json!({ "enabled": true });
    std::fs::write(
        &config_path,
        serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

/// Disable a plugin.
#[tauri::command]
pub fn disable_plugin(
    plugin_id: String,
    vault_state: State<VaultState>,
) -> Result<(), String> {
    let vault_path = crate::vault::get_vault_path(&vault_state)?;
    let config_path = ruas_core::plugin::plugin_dir(&vault_path, &plugin_id)
        .join("config.json");
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let config = serde_json::json!({ "enabled": false });
    std::fs::write(
        &config_path,
        serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

/// Uninstall a plugin by removing its directory from the vault.
#[tauri::command]
pub fn uninstall_plugin(
    plugin_id: String,
    vault_state: State<VaultState>,
) -> Result<(), String> {
    let vault_path = crate::vault::get_vault_path(&vault_state)?;
    let dir = ruas_core::plugin::plugin_dir(&vault_path, &plugin_id);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Install plugin files from the marketplace: write manifest.json and plugin.wasm
/// into `<vault>/.ruas/plugins/<plugin-id>/`, then enable the plugin.
#[tauri::command]
pub fn install_plugin_files(
    plugin_id: String,
    manifest: String,
    wasm: Vec<u8>,
    vault_state: State<VaultState>,
) -> Result<(), String> {
    let vault_path = crate::vault::get_vault_path(&vault_state)?;
    let dir = ruas_core::plugin::plugin_dir(&vault_path, &plugin_id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // Validate the manifest is valid JSON
    let _: serde_json::Value =
        serde_json::from_str(&manifest).map_err(|e| format!("invalid manifest JSON: {e}"))?;

    // Write manifest
    std::fs::write(dir.join("manifest.json"), &manifest).map_err(|e| e.to_string())?;

    // Write wasm
    std::fs::write(dir.join("plugin.wasm"), &wasm).map_err(|e| e.to_string())?;

    // Auto-enable
    let config = serde_json::json!({ "enabled": true });
    let config_path = dir.join("config.json");
    std::fs::write(
        &config_path,
        serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}
