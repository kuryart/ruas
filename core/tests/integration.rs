//! Integration tests for the ruas_core crate.
//!
//! Each test spins up a real `ModuleRegistry` against a `TempDir` vault,
//! exercises the full dispatch pipeline (the same path the Tauri commands use),
//! and asserts on filesystem state and returned JSON values.

use ruas_core::{
    Contact, ContactAddress, ContactEmail, ContactsModule,
    ModuleRegistry, Note, NoteFrontmatter, NotesModule, serialize_note,
};
use serde_json::json;
use tempfile::TempDir;

// ── Helpers ────────────────────────────────────────────────────────────────────

/// Open a fresh vault with both built-in modules registered.
fn open_vault() -> (TempDir, ModuleRegistry) {
    let dir = TempDir::new().unwrap();
    let mut reg = ModuleRegistry::new();
    reg.register(NotesModule::default());
    reg.register(ContactsModule::default());
    let errors = reg.on_vault_open(dir.path());
    assert!(errors.is_empty(), "vault open errors: {:?}", errors);
    (dir, reg)
}

/// Write note files directly to `vault/notes/` before opening the vault,
/// so `on_vault_open` indexes them (used for backlink tests).
fn open_vault_with_notes(notes: &[(&str, &str, &str)]) -> (TempDir, ModuleRegistry) {
    let dir = TempDir::new().unwrap();
    let notes_dir = dir.path().join("notes");
    std::fs::create_dir_all(&notes_dir).unwrap();
    for (title, uid, body) in notes {
        let fm = NoteFrontmatter {
            title: Some(title.to_string()),
            uid: Some(uid.to_string()),
            ..Default::default()
        };
        let content = serialize_note(&fm, body).unwrap();
        std::fs::write(notes_dir.join(format!("{uid}.md")), content).unwrap();
    }
    let mut reg = ModuleRegistry::new();
    reg.register(NotesModule::default());
    reg.register(ContactsModule::default());
    let errors = reg.on_vault_open(dir.path());
    assert!(errors.is_empty(), "vault open errors: {:?}", errors);
    (dir, reg)
}

fn dispatch_note(reg: &ModuleRegistry, vault: &TempDir, cmd: &str, args: serde_json::Value) -> serde_json::Value {
    reg.dispatch("ruas.notes", cmd, args, vault.path()).expect(&format!("notes.{cmd} failed"))
}

fn dispatch_contact(reg: &ModuleRegistry, vault: &TempDir, cmd: &str, args: serde_json::Value) -> serde_json::Value {
    reg.dispatch("ruas.contacts", cmd, args, vault.path()).expect(&format!("contacts.{cmd} failed"))
}

// ── Notes: CRUD ────────────────────────────────────────────────────────────────

#[test]
fn notes_create_writes_file_to_disk() {
    let (vault, reg) = open_vault();
    let result = dispatch_note(&reg, &vault, "create", json!({ "title": "My Note" }));
    let note: Note = serde_json::from_value(result).unwrap();
    assert_eq!(note.frontmatter.title.as_deref(), Some("My Note"));
    assert!(std::path::Path::new(&note.path).exists(), "file should exist on disk");
}

#[test]
fn notes_create_empty_title_defaults_to_untitled() {
    let (vault, reg) = open_vault();
    let result = dispatch_note(&reg, &vault, "create", json!({ "title": "" }));
    let note: Note = serde_json::from_value(result).unwrap();
    assert_eq!(note.frontmatter.title.as_deref(), Some("Untitled"));
}

#[test]
fn notes_read_returns_created_note() {
    let (vault, reg) = open_vault();
    let created: Note = serde_json::from_value(
        dispatch_note(&reg, &vault, "create", json!({ "title": "Read Me" }))
    ).unwrap();

    let read: Note = serde_json::from_value(
        dispatch_note(&reg, &vault, "read", json!({ "path": created.path }))
    ).unwrap();

    assert_eq!(read.frontmatter.title.as_deref(), Some("Read Me"));
    assert_eq!(read.frontmatter.uid, created.frontmatter.uid);
}

#[test]
fn notes_save_updates_body_and_modified() {
    let (vault, reg) = open_vault();
    let mut note: Note = serde_json::from_value(
        dispatch_note(&reg, &vault, "create", json!({ "title": "Save Test" }))
    ).unwrap();

    note.body = "Updated body content.".to_string();
    dispatch_note(&reg, &vault, "save", json!({ "note": note }));

    let read: Note = serde_json::from_value(
        dispatch_note(&reg, &vault, "read", json!({ "path": note.path }))
    ).unwrap();
    assert!(read.body.contains("Updated body content."));
    assert!(read.frontmatter.modified.is_some(), "save should set modified timestamp");
}

#[test]
fn notes_delete_removes_file_and_excludes_from_list() {
    let (vault, reg) = open_vault();
    let note: Note = serde_json::from_value(
        dispatch_note(&reg, &vault, "create", json!({ "title": "To Delete" }))
    ).unwrap();

    dispatch_note(&reg, &vault, "delete", json!({ "path": note.path }));

    assert!(!std::path::Path::new(&note.path).exists(), "file should be deleted from disk");
    let list: Vec<serde_json::Value> = serde_json::from_value(
        dispatch_note(&reg, &vault, "list", json!({}))
    ).unwrap();
    assert!(list.iter().all(|n| n["path"].as_str() != Some(&note.path)), "deleted note should not appear in list");
}

// ── Notes: List & Search ───────────────────────────────────────────────────────

#[test]
fn notes_list_returns_all_created_notes() {
    let (vault, reg) = open_vault();
    dispatch_note(&reg, &vault, "create", json!({ "title": "Alpha" }));
    dispatch_note(&reg, &vault, "create", json!({ "title": "Beta" }));
    dispatch_note(&reg, &vault, "create", json!({ "title": "Gamma" }));

    let list: Vec<serde_json::Value> = serde_json::from_value(
        dispatch_note(&reg, &vault, "list", json!({}))
    ).unwrap();
    assert_eq!(list.len(), 3);
}

#[test]
fn notes_search_finds_by_title_via_index() {
    // Notes must exist before vault open so on_vault_open indexes them.
    // Creating notes via dispatch AFTER vault open does not update the FTS index
    // (that requires a FileModified event from the file watcher, not part of dispatch).
    let (vault, reg) = open_vault_with_notes(&[
        ("Proptest Guide", "uid-prop", ""),
        ("Vitest Setup",   "uid-vit",  ""),
    ]);

    let results: Vec<serde_json::Value> = serde_json::from_value(
        dispatch_note(&reg, &vault, "search", json!({ "query": "Proptest" }))
    ).unwrap();
    assert!(
        results.iter().any(|n| n["title"].as_str().map(|t| t.contains("Proptest")).unwrap_or(false)),
        "search should find 'Proptest Guide'; got: {:?}", results
    );
}

// ── Notes: Folders ────────────────────────────────────────────────────────────

#[test]
fn notes_create_folder_creates_directory() {
    let (vault, reg) = open_vault();
    dispatch_note(&reg, &vault, "create_folder", json!({ "name": "Projects" }));
    assert!(vault.path().join("notes").join("Projects").is_dir());
}

#[test]
fn notes_create_folder_rejects_empty_name() {
    let (vault, reg) = open_vault();
    let result = reg.dispatch("ruas.notes", "create_folder", json!({ "name": "" }), vault.path());
    assert!(result.is_err(), "empty folder name should be rejected");
}

#[test]
fn notes_create_folder_rejects_duplicate() {
    let (vault, reg) = open_vault();
    dispatch_note(&reg, &vault, "create_folder", json!({ "name": "Archive" }));
    let result = reg.dispatch("ruas.notes", "create_folder", json!({ "name": "Archive" }), vault.path());
    assert!(result.is_err(), "duplicate folder name should be rejected");
}

#[test]
fn notes_delete_folder_removes_directory() {
    let (vault, reg) = open_vault();
    dispatch_note(&reg, &vault, "create_folder", json!({ "name": "Temp" }));
    let folder_path = vault.path().join("notes").join("Temp");
    assert!(folder_path.is_dir());
    dispatch_note(&reg, &vault, "delete_folder", json!({ "path": folder_path.to_str().unwrap() }));
    assert!(!folder_path.exists(), "folder should be deleted");
}

#[test]
fn notes_delete_folder_rejects_path_outside_notes() {
    let (vault, reg) = open_vault();
    // Try to delete the vault root itself — must be rejected as outside notes/
    let result = reg.dispatch("ruas.notes", "delete_folder", json!({ "path": vault.path().to_str().unwrap() }), vault.path());
    assert!(result.is_err(), "deleting outside notes/ must be rejected");
}

// ── Notes: Tree ───────────────────────────────────────────────────────────────

#[test]
fn notes_tree_includes_notes_and_folders() {
    let (vault, reg) = open_vault();
    dispatch_note(&reg, &vault, "create", json!({ "title": "Root Note" }));
    dispatch_note(&reg, &vault, "create_folder", json!({ "name": "Docs" }));

    let tree: Vec<serde_json::Value> = serde_json::from_value(
        dispatch_note(&reg, &vault, "tree", json!({}))
    ).unwrap();

    assert!(tree.iter().any(|n| n["is_dir"] == true && n["name"] == "Docs"), "folder must appear in tree");
    assert!(tree.iter().any(|n| n["is_dir"] == false && n["name"].as_str() == Some("Root Note")), "note must appear in tree");
}

// ── Notes: Backlinks (SQLite index) ──────────────────────────────────────────

#[test]
fn backlinks_indexed_on_vault_open() {
    let (_vault, reg) = open_vault_with_notes(&[
        ("Note A", "uid-a", "This links to [[Note B]] from A."),
        ("Note B", "uid-b", "This is note B, no outgoing links."),
    ]);

    // Collect the path for Note B from the list so we don't hard-code it.
    let list: Vec<serde_json::Value> = serde_json::from_value(
        reg.dispatch("ruas.notes", "list", json!({}), _vault.path()).unwrap()
    ).unwrap();
    let note_b = list.iter().find(|n| n["title"].as_str() == Some("Note B")).expect("Note B not in list");
    let b_path = note_b["path"].as_str().unwrap();

    let backlinks: Vec<serde_json::Value> = serde_json::from_value(
        reg.dispatch("ruas.notes", "backlinks", json!({ "path": b_path }), _vault.path()).unwrap()
    ).unwrap();

    assert!(
        backlinks.iter().any(|bl| bl["source_title"].as_str() == Some("Note A")),
        "Note A should appear as a backlink of Note B; got: {:?}", backlinks
    );
}

// ── Contacts: CRUD ────────────────────────────────────────────────────────────

#[test]
fn contacts_create_writes_file_to_disk() {
    let (vault, reg) = open_vault();
    let result = dispatch_contact(&reg, &vault, "create", json!({ "given_name": "Alice", "family_name": "Smith" }));
    let contact: Contact = serde_json::from_value(result).unwrap();
    assert!(std::path::Path::new(&contact.path).exists(), "contact file should exist on disk");
    assert_eq!(contact.frontmatter.given_name.as_deref(), Some("Alice"));
    assert_eq!(contact.frontmatter.family_name.as_deref(), Some("Smith"));
}

#[test]
fn contacts_read_returns_created_contact() {
    let (vault, reg) = open_vault();
    let created: Contact = serde_json::from_value(
        dispatch_contact(&reg, &vault, "create", json!({ "given_name": "Bob", "family_name": "Jones" }))
    ).unwrap();

    let read: Contact = serde_json::from_value(
        dispatch_contact(&reg, &vault, "read", json!({ "path": created.path }))
    ).unwrap();

    assert_eq!(read.frontmatter.given_name.as_deref(), Some("Bob"));
    assert_eq!(read.frontmatter.uid, created.frontmatter.uid);
}

#[test]
fn contacts_save_updates_fields() {
    let (vault, reg) = open_vault();
    let mut contact: Contact = serde_json::from_value(
        dispatch_contact(&reg, &vault, "create", json!({ "given_name": "Carol", "family_name": "" }))
    ).unwrap();

    contact.frontmatter.email = Some(vec![
        ContactEmail { field_type: "work".to_string(), value: "carol@example.com".to_string() },
    ]);
    dispatch_contact(&reg, &vault, "save", json!({ "contact": contact }));

    let read: Contact = serde_json::from_value(
        dispatch_contact(&reg, &vault, "read", json!({ "path": contact.path }))
    ).unwrap();
    let emails = read.frontmatter.email.unwrap();
    assert_eq!(emails[0].value, "carol@example.com");
}

#[test]
fn contacts_address_neighborhood_survives_round_trip() {
    let (vault, reg) = open_vault();
    let mut contact: Contact = serde_json::from_value(
        dispatch_contact(&reg, &vault, "create", json!({ "given_name": "Dave", "family_name": "" }))
    ).unwrap();

    contact.frontmatter.adr = Some(vec![ContactAddress {
        field_type: "home".to_string(),
        street: Some("Rua das Acácias, 42".to_string()),
        neighborhood: Some("Vila Mariana".to_string()),
        city: Some("São Paulo".to_string()),
        region: Some("SP".to_string()),
        code: Some("04101-000".to_string()),
        country: Some("Brasil".to_string()),
    }]);
    dispatch_contact(&reg, &vault, "save", json!({ "contact": contact }));

    let read: Contact = serde_json::from_value(
        dispatch_contact(&reg, &vault, "read", json!({ "path": contact.path }))
    ).unwrap();
    let adr = &read.frontmatter.adr.unwrap()[0];
    assert_eq!(adr.neighborhood.as_deref(), Some("Vila Mariana"));
    assert_eq!(adr.city.as_deref(), Some("São Paulo"));
}

#[test]
fn contacts_delete_removes_file() {
    let (vault, reg) = open_vault();
    let contact: Contact = serde_json::from_value(
        dispatch_contact(&reg, &vault, "create", json!({ "given_name": "Eve", "family_name": "" }))
    ).unwrap();

    dispatch_contact(&reg, &vault, "delete", json!({ "path": contact.path }));

    assert!(!std::path::Path::new(&contact.path).exists(), "contact file should be deleted");
}

#[test]
fn contacts_list_returns_all_created() {
    let (vault, reg) = open_vault();
    dispatch_contact(&reg, &vault, "create", json!({ "given_name": "Frank", "family_name": "A" }));
    dispatch_contact(&reg, &vault, "create", json!({ "given_name": "Grace", "family_name": "B" }));

    let list: Vec<serde_json::Value> = serde_json::from_value(
        dispatch_contact(&reg, &vault, "list", json!({}))
    ).unwrap();
    assert_eq!(list.len(), 2);
}

#[test]
fn contacts_list_is_sorted_by_display_name() {
    let (vault, reg) = open_vault();
    dispatch_contact(&reg, &vault, "create", json!({ "given_name": "Zara", "family_name": "Z" }));
    dispatch_contact(&reg, &vault, "create", json!({ "given_name": "Aaron", "family_name": "A" }));

    let list: Vec<serde_json::Value> = serde_json::from_value(
        dispatch_contact(&reg, &vault, "list", json!({}))
    ).unwrap();
    let names: Vec<&str> = list.iter().map(|c| c["display_name"].as_str().unwrap()).collect();
    assert!(names[0] < names[1], "list should be sorted alphabetically: {:?}", names);
}
