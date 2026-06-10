// ── Plugin & module API routes ─────────────────────────────────────────────
//
// These routes mirror the Tauri plugin commands for the HTTP API.
// Built-in modules (contacts, notes) route to their existing handlers.
// Third-party plugins are listed but not invoked (API server has no WASM runtime).

use actix_web::{HttpResponse, Responder, post, web};
use ruas_core::plugin;
use serde::Deserialize;
use std::path::PathBuf;

// ── Vault path ─────────────────────────────────────────────────────────────

/// The API uses a hardcoded vault directory (no vault selection UI in web mode).
fn vault_dir() -> PathBuf {
    PathBuf::from(
        std::env::var("RUAS_VAULT_PATH")
            .unwrap_or_else(|_| {
                let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
                format!("{home}/ruas")
            }),
    )
}

// ── Request types ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[allow(dead_code)]
struct InvokeArgs {
    #[serde(rename = "moduleId")]
    module_id: String,
    command: String,
    args: serde_json::Value,
}

#[derive(Deserialize)]
struct PluginActionArgs {
    #[serde(rename = "pluginId")]
    plugin_id: String,
}

#[derive(Deserialize)]
struct InstallPluginArgs {
    #[serde(rename = "pluginId")]
    plugin_id: String,
    manifest: String,
    wasm: Vec<u8>,
}

// ── Module metadata (built-ins) ────────────────────────────────────────────

fn builtin_modules() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({
            "id": "ruas.contacts",
            "name": "Contacts",
            "version": "0.1.0",
            "description": "Contact management with vCard-style frontmatter",
            "trust": "core",
            "kind": "wasm",
            "capabilities": ["VaultRead", "VaultWrite", "IndexRead", "IndexWrite"],
            "approved": ["VaultRead", "VaultWrite", "IndexRead", "IndexWrite"],
            "enabled": true,
        }),
        serde_json::json!({
            "id": "ruas.notes",
            "name": "Notes",
            "version": "0.1.0",
            "description": "Markdown notes with wiki-links, backlinks, and live preview",
            "trust": "core",
            "kind": "wasm",
            "capabilities": ["VaultRead", "VaultWrite", "IndexRead", "IndexWrite", "CrossModuleRead"],
            "approved": ["VaultRead", "VaultWrite", "IndexRead", "IndexWrite", "CrossModuleRead"],
            "enabled": true,
        }),
    ]
}

// ── Handlers ───────────────────────────────────────────────────────────────

/// List all registered modules (built-ins + discovered plugins).
#[post("/list_modules")]
pub async fn list_modules() -> impl Responder {
    modules_json().await
}

/// Alias for `/list_modules` — same data, same format.
#[post("/list_plugins")]
pub async fn list_plugins() -> impl Responder {
    modules_json().await
}

// ── Shared logic ────────────────────────────────────────────────────────

async fn modules_json() -> HttpResponse {
    let mut entries = builtin_modules();

    let vault = vault_dir();
    let discovered = plugin::discover_plugins(&vault);
    for mf in discovered {
        entries.push(serde_json::json!({
            "id": mf.id,
            "name": mf.name,
            "version": mf.version.to_string(),
            "description": mf.description,
            "author": mf.author,
            "trust": "plugin",
            "kind": mf.kind,
            "capabilities": mf.capabilities.iter().map(|c| format!("{c:?}")).collect::<Vec<_>>(),
            "approved": [],
            "enabled": false,
        }));
    }

    HttpResponse::Ok().json(entries)
}

/// Generic module dispatch.
/// Built-in modules are routed to their existing handlers.
/// Plugin modules return an error (no WASM runtime in the API server).
#[post("/invoke_module")]
pub async fn invoke_module(body: web::Json<InvokeArgs>) -> impl Responder {
    let module_id = &body.module_id;
    let command = &body.command;

    // Route built-in modules to the correct handler
    // (The API server doesn't use ModuleRegistry — commands are direct functions).
    // For now, return a clear error for plugin invocations.
    if !module_id.starts_with("ruas.") {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "err": format!("Plugin '{module_id}' cannot be invoked via the HTTP API. Use the Tauri desktop app for plugin support.")
        }));
    }

    // Built-in modules: the frontend already calls their typed commands directly
    // (e.g. /list_contacts, /create_note). This endpoint is informational.
    HttpResponse::Ok().json(serde_json::json!({
        "ok": {
            "module": module_id,
            "command": command,
            "note": "Built-in modules use their typed endpoints. Plugin invocation requires the desktop app."
        }
    }))
}

/// Enable a plugin by writing its config.
#[post("/enable_plugin")]
pub async fn enable_plugin(body: web::Json<PluginActionArgs>) -> impl Responder {
    let vault = vault_dir();
    let config_path = plugin::plugin_dir(&vault, &body.plugin_id).join("config.json");
    if let Some(parent) = config_path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return HttpResponse::InternalServerError().body(e.to_string());
        }
    }
    let config = serde_json::json!({ "enabled": true });
    match std::fs::write(
        &config_path,
        serde_json::to_string_pretty(&config).unwrap_or_default(),
    ) {
        Ok(_) => HttpResponse::Ok().finish(),
        Err(e) => HttpResponse::InternalServerError().body(e.to_string()),
    }
}

/// Disable a plugin by writing its config.
#[post("/disable_plugin")]
pub async fn disable_plugin(body: web::Json<PluginActionArgs>) -> impl Responder {
    let vault = vault_dir();
    let config_path = plugin::plugin_dir(&vault, &body.plugin_id).join("config.json");
    if let Some(parent) = config_path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return HttpResponse::InternalServerError().body(e.to_string());
        }
    }
    let config = serde_json::json!({ "enabled": false });
    match std::fs::write(
        &config_path,
        serde_json::to_string_pretty(&config).unwrap_or_default(),
    ) {
        Ok(_) => HttpResponse::Ok().finish(),
        Err(e) => HttpResponse::InternalServerError().body(e.to_string()),
    }
}

/// Uninstall a plugin (remove its directory).
#[post("/uninstall_plugin")]
pub async fn uninstall_plugin(body: web::Json<PluginActionArgs>) -> impl Responder {
    let vault = vault_dir();
    let dir = plugin::plugin_dir(&vault, &body.plugin_id);
    if dir.exists() {
        match std::fs::remove_dir_all(&dir) {
            Ok(_) => HttpResponse::Ok().finish(),
            Err(e) => HttpResponse::InternalServerError().body(e.to_string()),
        }
    } else {
        HttpResponse::Ok().finish()
    }
}

/// Install plugin files from the marketplace.
#[post("/install_plugin_files")]
pub async fn install_plugin_files(body: web::Json<InstallPluginArgs>) -> impl Responder {
    let vault = vault_dir();
    let dir = plugin::plugin_dir(&vault, &body.plugin_id);
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return HttpResponse::InternalServerError().body(e.to_string());
    }

    // Validate manifest JSON
    if serde_json::from_str::<serde_json::Value>(&body.manifest).is_err() {
        return HttpResponse::BadRequest().body("invalid manifest JSON");
    }

    if let Err(e) = std::fs::write(dir.join("manifest.json"), &body.manifest) {
        return HttpResponse::InternalServerError().body(e.to_string());
    }
    if let Err(e) = std::fs::write(dir.join("plugin.wasm"), &body.wasm) {
        return HttpResponse::InternalServerError().body(e.to_string());
    }

    // Auto-enable
    let config = serde_json::json!({ "enabled": true });
    let config_path = dir.join("config.json");
    if let Err(e) = std::fs::write(
        &config_path,
        serde_json::to_string_pretty(&config).unwrap_or_default(),
    ) {
        return HttpResponse::InternalServerError().body(e.to_string());
    }

    HttpResponse::Ok().finish()
}

/// Get module settings.
#[post("/get_module_settings")]
pub async fn get_module_settings(body: web::Json<PluginActionArgs>) -> impl Responder {
    let vault = vault_dir();
    let settings = ruas_core::ModuleSettings::for_module(&vault, &body.plugin_id);
    HttpResponse::Ok().json(settings.get_all())
}

/// Set module settings.
#[derive(Deserialize)]
struct SetSettingsArgs {
    #[serde(rename = "moduleId")]
    module_id: String,
    settings: serde_json::Value,
}

#[post("/set_module_settings")]
pub async fn set_module_settings(body: web::Json<SetSettingsArgs>) -> impl Responder {
    let vault = vault_dir();
    let settings = ruas_core::ModuleSettings::for_module(&vault, &body.module_id);
    match settings.set_all(body.settings.clone()) {
        Ok(_) => HttpResponse::Ok().finish(),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}
