use chrono::Utc;
use ruas_core::{contact_to_meta, parse_contact, serialize_contact, Contact, ContactFrontmatter, ContactMeta};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use uuid::Uuid;

// ── Contacts directory ─────────────────────────────────────────────────────

fn contacts_dir(app: &tauri::AppHandle) -> PathBuf {
    // On Android/iOS, home_dir() resolves to /root (not writable by apps).
    // Use app_data_dir() → Context.getFilesDir() on Android, which is always writable.
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        return app.path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("contacts");
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    app.path()
        .home_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("ruas")
        .join("contacts")
}

fn ensure_contacts_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = contacts_dir(app);
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create contacts dir: {e}"))?;
    Ok(dir)
}

// ── Commands ───────────────────────────────────────────────────────────────

#[tauri::command]
fn list_contacts(app: tauri::AppHandle) -> Result<Vec<ContactMeta>, String> {
    let dir = ensure_contacts_dir(&app)?;
    let mut metas = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let p = entry.path();
        if p.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let content = fs::read_to_string(&p).map_err(|e| e.to_string())?;
        if let Ok(c) = parse_contact(&p.to_string_lossy(), &content) {
            metas.push(contact_to_meta(&c));
        }
    }
    metas.sort_by(|a, b| a.display_name.cmp(&b.display_name));
    Ok(metas)
}

#[tauri::command]
fn read_contact(path: String) -> Result<Contact, String> {
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    parse_contact(&path, &content)
}

#[tauri::command]
fn save_contact(contact: Contact) -> Result<(), String> {
    let content = serialize_contact(&contact.frontmatter, &contact.body)?;
    fs::write(&contact.path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_contact(
    app: tauri::AppHandle,
    given_name: String,
    family_name: String,
) -> Result<Contact, String> {
    let dir = ensure_contacts_dir(&app)?;
    let uid = Uuid::new_v4().to_string();
    let path = dir.join(format!("{uid}.md"));
    let now = Utc::now().to_rfc3339();
    let full = format!("{given_name} {family_name}").trim().to_string();
    let fm = ContactFrontmatter {
        uid: Some(uid),
        full_name: Some(full),
        given_name: Some(given_name),
        family_name: Some(family_name),
        created: Some(now.clone()),
        modified: Some(now),
        ..Default::default()
    };
    let contact = Contact {
        path: path.to_string_lossy().to_string(),
        frontmatter: fm,
        body: String::new(),
    };
    let content = serialize_contact(&contact.frontmatter, &contact.body)?;
    fs::write(&contact.path, content).map_err(|e| e.to_string())?;
    Ok(contact)
}

#[tauri::command]
fn delete_contact(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| e.to_string())
}

// ── Seed ──────────────────────────────────────────────────────────────────

fn seed_sample_contacts(app: &tauri::AppHandle) {
    let Ok(dir) = ensure_contacts_dir(app) else { return };
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
            email: Some(vec![ruas_core::ContactEmail {
                field_type: email_type.to_string(),
                value: email.to_string(),
            }]),
            org: Some(org.to_string()),
            title: Some(title.to_string()),
            created: Some(now.clone()),
            modified: Some(now),
            ..Default::default()
        };
        let contact = Contact { path: path.to_string_lossy().to_string(), frontmatter: fm, body: String::new() };
        if let Ok(content) = serialize_contact(&contact.frontmatter, &contact.body) {
            let _ = fs::write(&contact.path, content);
        }
    }
}

// ── Entry point ────────────────────────────────────────────────────────────

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
            // Seed sample data on first run
            let dir = contacts_dir(app.handle());
            let is_empty = dir.read_dir().map(|mut d| d.next().is_none()).unwrap_or(true);
            if is_empty {
                seed_sample_contacts(app.handle());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_contacts,
            read_contact,
            save_contact,
            create_contact,
            delete_contact,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
