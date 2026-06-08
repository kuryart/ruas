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
        let stem = ruas_core::sanitize_filename(title);
        let filename = ruas_core::unique_filename(&notes_dir, &stem);
        std::fs::write(notes_dir.join(&filename), content).unwrap();
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
    // File is named after the title, not the UID.
    assert!(note.path.ends_with("My Note.md"), "path should use sanitized title, got: {}", note.path);
    assert!(note.frontmatter.uid.is_some(), "UID should still be set in frontmatter");
}

#[test]
fn notes_create_empty_title_defaults_to_untitled() {
    let (vault, reg) = open_vault();
    let result = dispatch_note(&reg, &vault, "create", json!({ "title": "" }));
    let note: Note = serde_json::from_value(result).unwrap();
    assert_eq!(note.frontmatter.title.as_deref(), Some("Untitled"));
    assert!(note.path.ends_with("Untitled.md"), "empty title should produce Untitled.md, got: {}", note.path);
}

#[test]
fn notes_create_sanitizes_forbidden_chars_in_filename() {
    let (vault, reg) = open_vault();
    let result = dispatch_note(&reg, &vault, "create", json!({ "title": "A/B:C*D?E\"F<G>H|I" }));
    let note: Note = serde_json::from_value(result).unwrap();
    // Title is preserved verbatim in frontmatter; filename is sanitized.
    assert_eq!(note.frontmatter.title.as_deref(), Some("A/B:C*D?E\"F<G>H|I"));
    assert!(note.path.ends_with("A_B_C_D_E_F_G_H_I.md"), "path should sanitize forbidden chars, got: {}", note.path);
}

#[test]
fn notes_create_duplicate_title_appends_counter() {
    let (vault, reg) = open_vault();
    let n1: Note = serde_json::from_value(
        dispatch_note(&reg, &vault, "create", json!({ "title": "Dup" }))
    ).unwrap();
    let n2: Note = serde_json::from_value(
        dispatch_note(&reg, &vault, "create", json!({ "title": "Dup" }))
    ).unwrap();
    assert!(n1.path.ends_with("Dup.md"), "first should be Dup.md, got: {}", n1.path);
    assert_eq!(n1.frontmatter.title.as_deref(), Some("Dup"), "first title unchanged");
    assert!(n2.path.ends_with("Dup 1.md"), "second should get suffix, got: {}", n2.path);
    assert_eq!(n2.frontmatter.title.as_deref(), Some("Dup 1"), "second title reflects dedup suffix");
    assert_ne!(n1.path, n2.path);
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
fn notes_save_renames_file_when_title_changes() {
    let (vault, reg) = open_vault();
    let mut note: Note = serde_json::from_value(
        dispatch_note(&reg, &vault, "create", json!({ "title": "Old Title" }))
    ).unwrap();
    let old_path = note.path.clone();
    assert!(old_path.ends_with("Old Title.md"), "initial path should use title");

    // Change the title and save — file should be renamed.
    note.frontmatter.title = Some("New Title".to_string());
    let saved: Note = serde_json::from_value(
        dispatch_note(&reg, &vault, "save", json!({ "note": note }))
    ).unwrap();

    assert!(saved.path.ends_with("New Title.md"), "path should reflect new title, got: {}", saved.path);
    assert!(!std::path::Path::new(&old_path).exists(), "old file should be gone");
    assert!(std::path::Path::new(&saved.path).exists(), "new file should exist");
}

#[test]
fn notes_save_keeps_filename_when_title_unchanged() {
    let (vault, reg) = open_vault();
    let mut note: Note = serde_json::from_value(
        dispatch_note(&reg, &vault, "create", json!({ "title": "Stable" }))
    ).unwrap();
    let old_path = note.path.clone();

    note.body = "updated".to_string();
    let saved: Note = serde_json::from_value(
        dispatch_note(&reg, &vault, "save", json!({ "note": note }))
    ).unwrap();

    assert_eq!(saved.path, old_path, "path should not change when title is unchanged");
    assert!(std::path::Path::new(&old_path).exists());
}

#[test]
fn notes_save_rejects_rename_when_target_exists() {
    let (vault, reg) = open_vault();
    // Create two notes with distinct titles.
    let a: Note = serde_json::from_value(
        dispatch_note(&reg, &vault, "create", json!({ "title": "Conflict A" }))
    ).unwrap();
    let mut b: Note = serde_json::from_value(
        dispatch_note(&reg, &vault, "create", json!({ "title": "Conflict B" }))
    ).unwrap();
    let b_old_path = b.path.clone();
    assert!(b_old_path.ends_with("Conflict B.md"), "B should start with its own name");

    // Try to rename B to A's name — should be rejected (different UID).
    b.frontmatter.title = Some("Conflict A".to_string());
    let saved: Note = serde_json::from_value(
        dispatch_note(&reg, &vault, "save", json!({ "note": b }))
    ).unwrap();

    // Path should NOT have changed — the rename was rejected.
    assert_eq!(saved.path, b_old_path, "rename should be rejected when target belongs to a different note");
    // Title should be reverted to match the current filename stem.
    assert_eq!(saved.frontmatter.title.as_deref(), Some("Conflict B"), "title should be reverted on conflict");
    // Both files still exist.
    assert!(std::path::Path::new(&a.path).exists());
    assert!(std::path::Path::new(&b_old_path).exists());
}

#[test]
fn notes_save_allows_rename_when_no_conflict() {
    let (vault, reg) = open_vault();
    let mut note: Note = serde_json::from_value(
        dispatch_note(&reg, &vault, "create", json!({ "title": "Old Name" }))
    ).unwrap();
    let old_path = note.path.clone();

    note.frontmatter.title = Some("New Name".to_string());
    let saved: Note = serde_json::from_value(
        dispatch_note(&reg, &vault, "save", json!({ "note": note }))
    ).unwrap();

    assert!(saved.path.ends_with("New Name.md"), "path should reflect new unique title, got: {}", saved.path);
    assert!(!std::path::Path::new(&old_path).exists(), "old file should be gone");
    assert!(std::path::Path::new(&saved.path).exists(), "new file should exist");
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
    // File is named after the display name, not the UID.
    assert!(contact.path.ends_with("Alice Smith.md"), "path should use display name, got: {}", contact.path);
    assert!(contact.frontmatter.uid.is_some(), "UID should still be set in frontmatter");
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
    let saved: Contact = serde_json::from_value(
        dispatch_contact(&reg, &vault, "save", json!({ "contact": contact }))
    ).unwrap();

    let read: Contact = serde_json::from_value(
        dispatch_contact(&reg, &vault, "read", json!({ "path": saved.path }))
    ).unwrap();
    let emails = read.frontmatter.email.unwrap();
    assert_eq!(emails[0].value, "carol@example.com");
}

#[test]
fn contacts_save_renames_file_when_name_changes() {
    let (vault, reg) = open_vault();
    let mut contact: Contact = serde_json::from_value(
        dispatch_contact(&reg, &vault, "create", json!({ "given_name": "Eve", "family_name": "Old" }))
    ).unwrap();
    let old_path = contact.path.clone();
    assert!(old_path.ends_with("Eve Old.md"), "initial path should use display name");

    // Change the full name and save — file should be renamed.
    contact.frontmatter.full_name = Some("Eve Newname".to_string());
    // Also update given/family to keep them consistent.
    contact.frontmatter.given_name = Some("Eve".to_string());
    contact.frontmatter.family_name = Some("Newname".to_string());
    let saved: Contact = serde_json::from_value(
        dispatch_contact(&reg, &vault, "save", json!({ "contact": contact }))
    ).unwrap();

    assert!(saved.path.ends_with("Eve Newname.md"), "path should reflect new name, got: {}", saved.path);
    assert!(!std::path::Path::new(&old_path).exists(), "old file should be gone");
    assert!(std::path::Path::new(&saved.path).exists(), "new file should exist");
}

#[test]
fn contacts_save_rejects_rename_when_target_exists() {
    let (vault, reg) = open_vault();
    // Create two contacts with distinct names.
    let a: Contact = serde_json::from_value(
        dispatch_contact(&reg, &vault, "create", json!({ "given_name": "Xavier", "family_name": "Alpha" }))
    ).unwrap();
    assert!(a.path.ends_with("Xavier Alpha.md"));
    let mut b: Contact = serde_json::from_value(
        dispatch_contact(&reg, &vault, "create", json!({ "given_name": "Xavier", "family_name": "Beta" }))
    ).unwrap();
    let b_old_path = b.path.clone();
    assert!(b_old_path.ends_with("Xavier Beta.md"));

    // Try to rename B to A's display name — should be rejected (different UID).
    b.frontmatter.full_name = Some("Xavier Alpha".to_string());
    b.frontmatter.given_name = Some("Xavier".to_string());
    b.frontmatter.family_name = Some("Alpha".to_string());
    let saved: Contact = serde_json::from_value(
        dispatch_contact(&reg, &vault, "save", json!({ "contact": b }))
    ).unwrap();

    // Path should NOT have changed — the rename was rejected.
    assert_eq!(saved.path, b_old_path, "rename should be rejected when target belongs to a different contact");
    // Display name should be reverted to match the current filename stem.
    assert_eq!(saved.frontmatter.full_name.as_deref(), Some("Xavier Beta"), "full_name should be reverted on conflict");
    // Both files still exist.
    assert!(std::path::Path::new(&a.path).exists());
    assert!(std::path::Path::new(&b_old_path).exists());
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
