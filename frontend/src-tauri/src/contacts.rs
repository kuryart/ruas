use crate::vault::{VaultState, get_vault_path};
use crate::RegistryState;
use chrono::Utc;
use ruas_core::{
    Contact, ContactEmail, ContactFrontmatter, ContactMeta, ContactTreeNode,
    serialize_contact,
};
use std::fs;
use std::path::Path;
use uuid::Uuid;

// ── Dispatch helper ────────────────────────────────────────────────────────

/// Route a command through the module registry.
/// The registry creates its own VaultContext with a BufferedSink, so
/// events emitted during the command are properly propagated.
fn dispatch(
    vault_state: &tauri::State<VaultState>,
    registry: &tauri::State<RegistryState>,
    command: &str,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let vault_path = get_vault_path(vault_state)?;
    registry.0.lock().unwrap().dispatch("ruas.contacts", command, args, &vault_path)
}

// ── Typed Tauri commands ───────────────────────────────────────────────────
// These are thin transport adapters: they serialise/deserialise types and
// delegate all business logic to ContactsModule via the registry.

#[tauri::command]
pub fn list_contacts(
    state: tauri::State<VaultState>,
    registry: tauri::State<RegistryState>,
) -> Result<Vec<ContactMeta>, String> {
    let result = dispatch(&state, &registry, "list", serde_json::json!({}))?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_contact(
    path: String,
    state: tauri::State<VaultState>,
    registry: tauri::State<RegistryState>,
) -> Result<Contact, String> {
    let result = dispatch(&state, &registry, "read", serde_json::json!({ "path": path }))?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_contact(
    contact: Contact,
    state: tauri::State<VaultState>,
    registry: tauri::State<RegistryState>,
) -> Result<Contact, String> {
    let result = dispatch(&state, &registry, "save", serde_json::json!({ "contact": contact }))?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_contact(
    given_name: String,
    family_name: String,
    folder: Option<String>,
    state: tauri::State<VaultState>,
    registry: tauri::State<RegistryState>,
) -> Result<Contact, String> {
    let result = dispatch(
        &state,
        &registry,
        "create",
        serde_json::json!({ "given_name": given_name, "family_name": family_name, "folder": folder }),
    )?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_contact(
    path: String,
    state: tauri::State<VaultState>,
    registry: tauri::State<RegistryState>,
) -> Result<(), String> {
    dispatch(&state, &registry, "delete", serde_json::json!({ "path": path })).map(|_| ())
}

#[tauri::command]
pub fn create_contact_folder(
    name: String,
    state: tauri::State<VaultState>,
    registry: tauri::State<RegistryState>,
) -> Result<String, String> {
    let result = dispatch(&state, &registry, "create_folder", serde_json::json!({ "name": name }))?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_contact_folder(
    path: String,
    state: tauri::State<VaultState>,
    registry: tauri::State<RegistryState>,
) -> Result<(), String> {
    dispatch(&state, &registry, "delete_folder", serde_json::json!({ "path": path })).map(|_| ())
}

#[tauri::command]
pub fn list_contacts_tree(
    state: tauri::State<VaultState>,
    registry: tauri::State<RegistryState>,
) -> Result<Vec<ContactTreeNode>, String> {
    let result = dispatch(&state, &registry, "tree", serde_json::json!({}))?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn move_contact(
    path: String,
    folder: String,
    state: tauri::State<VaultState>,
    registry: tauri::State<RegistryState>,
) -> Result<(), String> {
    dispatch(&state, &registry, "move", serde_json::json!({ "path": path, "folder": folder })).map(|_| ())
}

#[tauri::command]
pub fn get_contacts_dir(
    state: tauri::State<VaultState>,
) -> Result<String, String> {
    let vault_path = crate::vault::get_vault_path(&state)?;
    Ok(vault_path.join("contacts").to_string_lossy().to_string())
}

#[tauri::command]
pub fn rename_contact_folder(
    path: String,
    name: String,
    state: tauri::State<VaultState>,
    registry: tauri::State<RegistryState>,
) -> Result<String, String> {
    let result = dispatch(&state, &registry, "rename_folder", serde_json::json!({ "path": path, "name": name }))?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_contacts(
    query: String,
    state: tauri::State<VaultState>,
    registry: tauri::State<RegistryState>,
) -> Result<Vec<ContactMeta>, String> {
    let result = dispatch(&state, &registry, "search", serde_json::json!({ "query": query }))?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

// ── Internal helpers ───────────────────────────────────────────────────────

/// Path to the contacts directory within a vault (used by seed and lib setup).
pub fn contacts_dir(vault_path: &Path) -> std::path::PathBuf {
    vault_path.join("contacts")
}

/// Seed sample contacts — debug builds only, never shipped to production.
#[cfg(debug_assertions)]
pub fn seed_sample_contacts(vault_path: &Path) {
    let dir = vault_path.join("contacts");
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let samples = [
        ("Ana", "Silva", "ana.silva@example.com", "work", "Ruas Corp", "CEO"),
        ("Bruno", "Oliveira", "bruno@example.com", "home", "Freelance", "Designer"),
        ("Carla", "Santos", "carla@example.com", "work", "Dev Studio", "Engineer"),
    ];
    for (given, family, email, email_type, org, title) in samples {
        let uid = Uuid::new_v4().to_string();
        let path = dir.join(format!("{uid}.md"));
        let now = Utc::now().to_rfc3339();
        let fm = ContactFrontmatter {
            uid: Some(uid),
            full_name: Some(format!("{given} {family}")),
            given_name: Some(given.to_string()),
            family_name: Some(family.to_string()),
            email: Some(vec![ContactEmail {
                field_type: email_type.to_string(),
                value: email.to_string(),
            }]),
            org: Some(org.to_string()),
            title: Some(title.to_string()),
            created: Some(now.clone()),
            modified: Some(now),
            ..Default::default()
        };
        let contact = Contact {
            path: path.to_string_lossy().to_string(),
            frontmatter: fm,
            body: String::new(),
        };
        if let Ok(content) = serialize_contact(&contact.frontmatter, &contact.body) {
            let _ = fs::write(&contact.path, content);
        }
    }
}
