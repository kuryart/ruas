use serde::{Deserialize, Serialize};

// ── Contact field types ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactEmail {
    #[serde(rename = "type", default = "default_field_type")]
    pub field_type: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactPhone {
    #[serde(rename = "type", default = "default_field_type")]
    pub field_type: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ContactAddress {
    #[serde(rename = "type", default = "default_field_type")]
    pub field_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub street: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub neighborhood: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub city: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
}

fn default_field_type() -> String {
    "other".to_string()
}

// ── Frontmatter (vCard-style) ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ContactFrontmatter {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uid: Option<String>,
    /// vCard FN (formatted/full name)
    #[serde(rename = "fn", skip_serializing_if = "Option::is_none")]
    pub full_name: Option<String>,
    #[serde(rename = "given-name", skip_serializing_if = "Option::is_none")]
    pub given_name: Option<String>,
    #[serde(rename = "family-name", skip_serializing_if = "Option::is_none")]
    pub family_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<Vec<ContactEmail>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tel: Option<Vec<ContactPhone>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub org: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adr: Option<Vec<ContactAddress>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bday: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub photo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified: Option<String>,
}

impl ContactFrontmatter {
    pub fn display_name(&self) -> String {
        if let Some(n) = &self.full_name {
            return n.clone();
        }
        let g = self.given_name.as_deref().unwrap_or("");
        let f = self.family_name.as_deref().unwrap_or("");
        let combined = format!("{g} {f}").trim().to_string();
        if !combined.is_empty() {
            combined
        } else {
            "Unnamed".to_string()
        }
    }

    pub fn initials(&self) -> String {
        let name = self.display_name();
        name.split_whitespace()
            .filter_map(|w| w.chars().next())
            .take(2)
            .collect::<String>()
            .to_uppercase()
    }
}

// ── Contact ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contact {
    pub path: String,
    pub frontmatter: ContactFrontmatter,
    pub body: String,
}

/// Lightweight version for listing (avoids sending full body over IPC)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactMeta {
    pub path: String,
    pub display_name: String,
    pub initials: String,
    pub org: Option<String>,
    pub primary_email: Option<String>,
    pub tags: Option<Vec<String>>,
}

// ── Parse / serialize ──────────────────────────────────────────────────────

pub fn parse_contact(path: &str, content: &str) -> Result<Contact, String> {
    let (frontmatter, body) = split_frontmatter(content)?;
    Ok(Contact { path: path.to_string(), frontmatter, body })
}

pub fn serialize_contact(fm: &ContactFrontmatter, body: &str) -> Result<String, String> {
    let yaml = serde_yaml::to_string(fm)
        .map_err(|e| format!("YAML serialize error: {e}"))?;
    Ok(format!("---\n{yaml}---\n\n{body}"))
}

pub fn contact_to_meta(c: &Contact) -> ContactMeta {
    let primary_email = c.frontmatter.email.as_ref()
        .and_then(|v| v.first())
        .map(|e| e.value.clone());
    ContactMeta {
        path: c.path.clone(),
        display_name: c.frontmatter.display_name(),
        initials: c.frontmatter.initials(),
        org: c.frontmatter.org.clone(),
        primary_email,
        tags: c.frontmatter.tags.clone(),
    }
}

// ── Tree node ──────────────────────────────────────────────────────────────

/// A node in the contacts folder tree. `is_dir` distinguishes folders from contacts.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactTreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<ContactTreeNode>,
}

/// Recursively walk `dir` building a tree of folders and `.md` contacts.
/// Contact nodes carry their display name (falling back to the file stem).
pub fn build_contacts_tree(dir: &std::path::Path) -> Vec<ContactTreeNode> {
    let mut nodes: Vec<ContactTreeNode> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for entry in rd.flatten() {
            let p = entry.path();
            if p.is_dir() {
                nodes.push(ContactTreeNode {
                    name: p.file_name().unwrap_or_default().to_string_lossy().to_string(),
                    path: p.to_string_lossy().to_string(),
                    is_dir: true,
                    children: build_contacts_tree(&p),
                });
            } else if p.extension().and_then(|e| e.to_str()) == Some("md") {
                let name = std::fs::read_to_string(&p)
                    .ok()
                    .and_then(|c| parse_contact(&p.to_string_lossy(), &c).ok())
                    .map(|c| c.frontmatter.display_name())
                    .unwrap_or_else(|| p.file_stem().unwrap_or_default().to_string_lossy().to_string());
                nodes.push(ContactTreeNode {
                    name,
                    path: p.to_string_lossy().to_string(),
                    is_dir: false,
                    children: Vec::new(),
                });
            }
        }
    }
    // Folders first, then contacts; alphabetical within each group.
    nodes.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    nodes
}

// ── Module implementation ──────────────────────────────────────────────────

use crate::filename::{sanitize_filename, unique_filename};
use crate::module::{
    Capability, CommandDescriptor, DispatchResult, Module, ModuleEvent, ModuleInfo,
    ParamDescriptor, ParamKind, SettingField, VaultContext, Version,
};
use chrono::Utc;
use serde_json::Value;
use std::sync::OnceLock;
use uuid::Uuid;

/// Built-in Contacts module.
///
/// Implements the full `Module` interface: lifecycle, settings schema,
/// command descriptors, and dispatch with file I/O.
/// This is the canonical pattern every future module follows.
pub struct ContactsModule {
    info: ModuleInfo,
}

impl Default for ContactsModule {
    fn default() -> Self {
        Self {
            info: ModuleInfo {
                id: "ruas.contacts".to_string(),
                name: "Contacts".to_string(),
                version: Version::new(0, 1, 0),
                description: "vCard-based contact management backed by Markdown files".to_string(),
            },
        }
    }
}

impl ContactsModule {
    fn contacts_dir<'a>(&self, ctx: &VaultContext<'a>) -> std::path::PathBuf {
        ctx.vault_path.join("contacts")
    }

    // ── Command implementations ────────────────────────────────────────

    fn cmd_list(&self, ctx: &VaultContext<'_>) -> DispatchResult {
        let dir = self.contacts_dir(ctx);
        let mut metas: Vec<ContactMeta> = Vec::new();
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for entry in rd.flatten() {
                let p = entry.path();
                if p.extension().and_then(|e| e.to_str()) != Some("md") {
                    continue;
                }
                if let Ok(content) = std::fs::read_to_string(&p) {
                    if let Ok(c) = parse_contact(&p.to_string_lossy(), &content) {
                        metas.push(contact_to_meta(&c));
                    }
                }
            }
        }
        metas.sort_by(|a, b| a.display_name.cmp(&b.display_name));
        serde_json::to_value(metas).map_err(|e| e.to_string())
    }

    fn cmd_read(&self, path: &str, _ctx: &VaultContext<'_>) -> DispatchResult {
        let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        let contact = parse_contact(path, &content)?;
        serde_json::to_value(contact).map_err(|e| e.to_string())
    }

    fn cmd_create(
        &self,
        given_name: String,
        family_name: String,
        folder: Option<String>,
        ctx: &VaultContext<'_>,
    ) -> DispatchResult {
        let dir = match folder {
            Some(ref f) => {
                let p = std::path::Path::new(f);
                if !p.is_dir() { return Err(format!("'{}' is not a directory", f)); }
                p.to_path_buf()
            }
            None => self.contacts_dir(ctx),
        };
        let uid = Uuid::new_v4().to_string();
        let full = format!("{given_name} {family_name}").trim().to_string();
        let now = Utc::now().to_rfc3339();
        let mut fm = ContactFrontmatter {
            uid: Some(uid.clone()),
            full_name: if full.is_empty() { None } else { Some(full.clone()) },
            given_name: Some(given_name),
            family_name: Some(family_name),
            created: Some(now.clone()),
            modified: Some(now),
            ..Default::default()
        };
        let display = fm.display_name();
        let stem = sanitize_filename(if display == "Unnamed" { "Untitled" } else { &display });
        let filename = unique_filename(&dir, &stem);
        let path = dir.join(&filename);
        // If the filename was deduplicated (e.g. "Untitled 1.md"), reflect it
        // in full_name so the UI shows the correct display name.
        let actual_stem = filename
            .strip_suffix(".md")
            .unwrap_or(&filename);
        if actual_stem != stem {
            fm.full_name = Some(actual_stem.to_string());
        }
        let contact = Contact {
            path: path.to_string_lossy().to_string(),
            frontmatter: fm,
            body: String::new(),
        };
        let content = serialize_contact(&contact.frontmatter, &contact.body)?;
        std::fs::write(&contact.path, content).map_err(|e| e.to_string())?;
        ctx.events.emit(ModuleEvent::ContactSaved { uid });
        serde_json::to_value(contact).map_err(|e| e.to_string())
    }

    fn cmd_save(&self, mut contact: Contact, ctx: &VaultContext<'_>) -> DispatchResult {
        // Rename the file if the display name changed and the filename no longer matches.
        let dir = self.contacts_dir(ctx);
        let old_path = std::path::Path::new(&contact.path);
        let current_stem = old_path
            .file_stem()
            .map(|s| s.to_string_lossy())
            .unwrap_or_default();
        let display = contact.frontmatter.display_name();
        let desired_stem = sanitize_filename(if display == "Unnamed" { "Untitled" } else { &display });

        if current_stem.as_ref() != desired_stem {
            let candidate_path = dir.join(format!("{desired_stem}.md"));
            if candidate_path != old_path {
                // Check for name conflict: if a file with the desired name
                // already exists and belongs to a *different* entity, reject
                // the rename entirely (filename AND display name unchanged).
                let conflict = if candidate_path.exists() {
                    std::fs::read_to_string(&candidate_path)
                        .ok()
                        .and_then(|c| parse_contact(&candidate_path.to_string_lossy(), &c).ok())
                        .and_then(|c| c.frontmatter.uid)
                        .map_or(true, |existing_uid| {
                            existing_uid != contact.frontmatter.uid.as_deref().unwrap_or("")
                        })
                } else {
                    false
                };

                if conflict {
                    // Revert the display name to match the current filename
                    // stem so the UI reflects that the rename was rejected.
                    contact.frontmatter.full_name = Some(current_stem.to_string());
                } else {
                    let old_path_str = contact.path.clone();
                    if old_path.exists() {
                        ctx.guard_rename(&old_path_str);
                        std::fs::rename(&old_path_str, &candidate_path)
                            .map_err(|e| format!("rename failed: {e}"))?;
                        if let Some(index) = ctx.index() {
                            index.rename(&old_path_str, &candidate_path.to_string_lossy())?;
                        }
                    }
                    contact.path = candidate_path.to_string_lossy().to_string();
                }
            }
        }

        contact.frontmatter.modified = Some(Utc::now().to_rfc3339());
        let content = serialize_contact(&contact.frontmatter, &contact.body)?;
        std::fs::write(&contact.path, content).map_err(|e| e.to_string())?;
        if let Some(uid) = &contact.frontmatter.uid {
            ctx.events.emit(ModuleEvent::ContactSaved { uid: uid.clone() });
        }
        serde_json::to_value(contact).map_err(|e| e.to_string())
    }

    fn cmd_delete(&self, path: &str, ctx: &VaultContext<'_>) -> DispatchResult {
        let uid = std::fs::read_to_string(path)
            .ok()
            .and_then(|c| parse_contact(path, &c).ok())
            .and_then(|c| c.frontmatter.uid);
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
        if let Some(uid) = uid {
            ctx.events.emit(ModuleEvent::ContactDeleted { uid });
        }
        Ok(Value::Null)
    }

    fn cmd_create_folder(&self, name: String, ctx: &VaultContext<'_>) -> DispatchResult {
        let safe_name = name.trim().replace(['/', '\\', '\0'], "_");
        if safe_name.is_empty() {
            return Err("folder name cannot be empty".into());
        }
        let target = self.contacts_dir(ctx).join(&safe_name);
        if target.exists() {
            return Err(format!("folder '{safe_name}' already exists"));
        }
        std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        serde_json::to_value(target.to_string_lossy().to_string()).map_err(|e| e.to_string())
    }

    fn cmd_tree(&self, ctx: &VaultContext<'_>) -> DispatchResult {
        let tree = build_contacts_tree(&self.contacts_dir(ctx));
        serde_json::to_value(tree).map_err(|e| e.to_string())
    }

    fn cmd_delete_folder(&self, path: &str, ctx: &VaultContext<'_>) -> DispatchResult {
        let contacts_dir = self.contacts_dir(ctx);
        let target = std::path::Path::new(path).canonicalize().map_err(|e| e.to_string())?;
        let base = contacts_dir.canonicalize().map_err(|e| e.to_string())?;
        if !target.starts_with(&base) || target == base {
            return Err("path is outside the contacts directory".into());
        }
        std::fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
        Ok(Value::Null)
    }

    fn cmd_rename_folder(&self, path: &str, new_name: &str, ctx: &VaultContext<'_>) -> DispatchResult {
        let safe_name = new_name.trim().replace(['/', '\\', '\0'], "_");
        if safe_name.is_empty() { return Err("folder name cannot be empty".into()); }
        let src = std::path::Path::new(path);
        let new_path = src.parent().ok_or("cannot rename root folder")?.join(&safe_name);
        if new_path == src { return Ok(Value::Null); }
        if new_path.exists() { return Err(format!("'{}' already exists in this location", safe_name)); }
        if !src.exists() { return Err("folder no longer exists".into()); }
        let old_path_str = path.to_string();
        ctx.guard_rename(&old_path_str);
        std::fs::rename(src, &new_path).map_err(|e| format!("rename folder failed: {e}"))?;
        if let Some(index) = ctx.index() { index.rename(&old_path_str, &new_path.to_string_lossy())?; }
        serde_json::to_value(new_path.to_string_lossy().to_string()).map_err(|e| e.to_string())
    }

    fn cmd_move(&self, path: &str, folder: &str, ctx: &VaultContext<'_>) -> DispatchResult {
        let contacts_dir = self.contacts_dir(ctx);
        let src = std::path::Path::new(path);
        let src_is_dir = src.is_dir();
        let dest_dir = std::path::Path::new(folder);

        let base = contacts_dir.canonicalize().map_err(|e| e.to_string())?;
        let dest_canon = dest_dir.canonicalize()
            .map_err(|_| format!("destination folder not found: '{}'", folder))?;
        if !dest_canon.starts_with(&base) {
            return Err("destination is outside the contacts directory".into());
        }
        if !dest_canon.is_dir() {
            return Err(format!("'{}' is not a directory", folder));
        }

        // No-op: source is already in the destination folder.
        let src_parent = src.parent().and_then(|p| p.canonicalize().ok());
        if src_parent.as_ref() == Some(&dest_canon) {
            return Ok(Value::Null);
        }

        let fname = src.file_name().ok_or("source has no filename")?;
        let new_path = dest_canon.join(fname);
        if new_path == src {
            return Ok(Value::Null);
        }
        if new_path.exists() {
            return Err(format!("'{}' already exists in the destination folder", fname.to_string_lossy()));
        }
        if !src.exists() {
            return Err(format!("'{}' no longer exists; it may have been moved or deleted", path));
        }

        let old_path_str = path.to_string();
        ctx.guard_rename(&old_path_str);
        std::fs::rename(src, &new_path).map_err(|e| format!("move failed: {e}"))?;
        if let Some(index) = ctx.index() {
            index.rename(&old_path_str, &new_path.to_string_lossy())?;
        }

        if src_is_dir {
            return serde_json::to_value(new_path.to_string_lossy().to_string()).map_err(|e| e.to_string());
        }
        let content = std::fs::read_to_string(&new_path).map_err(|e| e.to_string())?;
        let contact = parse_contact(&new_path.to_string_lossy(), &content)?;
        serde_json::to_value(contact).map_err(|e| e.to_string())
    }
}

impl Module for ContactsModule {
    fn info(&self) -> &ModuleInfo {
        &self.info
    }

    fn capabilities(&self) -> &[Capability] {
        &[Capability::VaultRead, Capability::VaultWrite]
    }

    // ── Settings schema (Point 2) ──────────────────────────────────────

    fn settings_schema(&self) -> &[SettingField] {
        &[] // No user-configurable settings yet; expand as features are added
    }

    // ── Command descriptors (Point 1) ──────────────────────────────────

    fn commands(&self) -> &[CommandDescriptor] {
        static COMMANDS: OnceLock<Vec<CommandDescriptor>> = OnceLock::new();
        COMMANDS.get_or_init(|| {
            let path_param = || ParamDescriptor {
                name: "path".into(),
                kind: ParamKind::String,
                required: true,
                description_key: "contacts-param-path".into(),
            };
            vec![
                CommandDescriptor {
                    name: "list".into(),
                    label_key: "contacts-cmd-list".into(),
                    description_key: "contacts-cmd-list-desc".into(),
                    params: vec![],
                },
                CommandDescriptor {
                    name: "read".into(),
                    label_key: "contacts-cmd-read".into(),
                    description_key: "contacts-cmd-read-desc".into(),
                    params: vec![path_param()],
                },
                CommandDescriptor {
                    name: "create".into(),
                    label_key: "contacts-cmd-create".into(),
                    description_key: "contacts-cmd-create-desc".into(),
                    params: vec![
                        ParamDescriptor {
                            name: "given_name".into(),
                            kind: ParamKind::String,
                            required: true,
                            description_key: "contacts-param-given-name".into(),
                        },
                        ParamDescriptor {
                            name: "family_name".into(),
                            kind: ParamKind::String,
                            required: false,
                            description_key: "contacts-param-family-name".into(),
                        },
                    ],
                },
                CommandDescriptor {
                    name: "save".into(),
                    label_key: "contacts-cmd-save".into(),
                    description_key: "contacts-cmd-save-desc".into(),
                    params: vec![ParamDescriptor {
                        name: "contact".into(),
                        kind: ParamKind::Json,
                        required: true,
                        description_key: "contacts-param-contact".into(),
                    }],
                },
                CommandDescriptor {
                    name: "delete".into(),
                    label_key: "contacts-cmd-delete".into(),
                    description_key: "contacts-cmd-delete-desc".into(),
                    params: vec![path_param()],
                },
                CommandDescriptor {
                    name: "create_folder".into(),
                    label_key: "contacts-cmd-create-folder".into(),
                    description_key: "contacts-cmd-create-folder-desc".into(),
                    params: vec![ParamDescriptor {
                        name: "name".into(),
                        kind: ParamKind::String,
                        required: true,
                        description_key: "contacts-param-folder-name".into(),
                    }],
                },
                CommandDescriptor {
                    name: "delete_folder".into(),
                    label_key: "contacts-cmd-delete-folder".into(),
                    description_key: "contacts-cmd-delete-folder-desc".into(),
                    params: vec![path_param()],
                },
                CommandDescriptor {
                    name: "tree".into(),
                    label_key: "contacts-cmd-tree".into(),
                    description_key: "contacts-cmd-tree-desc".into(),
                    params: vec![],
                },
            ]
        })
    }

    // ── Dispatch (Point 1) ─────────────────────────────────────────────

    fn dispatch(&self, command: &str, args: Value, ctx: &VaultContext<'_>) -> DispatchResult {
        match command {
            "list" => self.cmd_list(ctx),
            "read" => {
                let path = args["path"].as_str().ok_or("missing required param: path")?;
                self.cmd_read(path, ctx)
            }
            "create" => {
                let given = args["given_name"].as_str().unwrap_or("").to_string();
                let family = args["family_name"].as_str().unwrap_or("").to_string();
                let folder = args["folder"].as_str().map(|s| s.to_string());
                self.cmd_create(given, family, folder, ctx)
            }
            "save" => {
                let contact: Contact = serde_json::from_value(args["contact"].clone())
                    .map_err(|e| format!("invalid contact payload: {e}"))?;
                self.cmd_save(contact, ctx)
            }
            "delete" => {
                let path = args["path"].as_str().ok_or("missing required param: path")?;
                self.cmd_delete(path, ctx)
            }
            "create_folder" => {
                let name = args["name"].as_str().unwrap_or("New folder").to_string();
                self.cmd_create_folder(name, ctx)
            }
            "delete_folder" => {
                let path = args["path"].as_str().ok_or("missing required param: path")?;
                self.cmd_delete_folder(path, ctx)
            }
            "tree" => self.cmd_tree(ctx),
            "move" => {
                let path = args["path"].as_str().ok_or("missing required param: path")?;
                let folder = args["folder"].as_str().ok_or("missing required param: folder")?;
                self.cmd_move(path, folder, ctx)
            }
            "rename_folder" => {
                let path = args["path"].as_str().ok_or("missing required param: path")?;
                let name = args["name"].as_str().ok_or("missing required param: name")?;
                self.cmd_rename_folder(path, name, ctx)
            }
            _ => Err(format!("Unknown command: {command}")),
        }
    }

    // ── Lifecycle ──────────────────────────────────────────────────────

    fn on_vault_open(&self, ctx: &VaultContext<'_>) -> Result<(), String> {
        let dir = ctx.vault_path.join("contacts");
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("contacts: cannot create contacts dir: {e}"))?;

        // Build the initial contact index — fast scan of the contacts directory
        if let Some(index) = ctx.index() {
            if let Ok(entries) = std::fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.extension().and_then(|e| e.to_str()) == Some("md") {
                        self.index_contact_file(index, &p);
                    }
                }
            }
        }

        Ok(())
    }

    fn on_event(&self, event: &ModuleEvent, ctx: &VaultContext<'_>) {
        let Some(index) = ctx.index() else { return };
        let contacts_dir = ctx.vault_path.join("contacts");
        match event {
            ModuleEvent::FileCreated { path } | ModuleEvent::FileModified { path } => {
                let p = std::path::Path::new(path);
                if p.starts_with(&contacts_dir) && p.extension().and_then(|e| e.to_str()) == Some("md") {
                    self.index_contact_file(index, p);
                }
            }
            ModuleEvent::FileDeleted { path } => {
                let p = std::path::Path::new(path);
                if p.starts_with(&contacts_dir) {
                    let _ = index.remove(path);
                }
            }
            _ => {}
        }
    }
}

impl ContactsModule {
    fn index_contact_file(&self, index: &crate::index::IndexManager, path: &std::path::Path) {
        let Ok(content) = std::fs::read_to_string(path) else { return };
        let Ok(contact) = parse_contact(&path.to_string_lossy(), &content) else { return };
        let _ = index.upsert(
            &path.to_string_lossy(),
            contact.frontmatter.uid.as_deref(),
            "contact",
            Some(&contact.frontmatter.display_name()),
            &contact.body,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── parse_contact / serialize_contact ──────────────────────────────────────

    #[test]
    fn parse_serialize_round_trip_basic() {
        let fm = ContactFrontmatter {
            uid: Some("uid-1".to_string()),
            full_name: Some("Alice Bob".to_string()),
            ..Default::default()
        };
        let body = "Some notes.";
        let content = serialize_contact(&fm, body).unwrap();
        let contact = parse_contact("c.md", &content).unwrap();
        assert_eq!(contact.frontmatter.uid.as_deref(), Some("uid-1"));
        assert_eq!(contact.frontmatter.full_name.as_deref(), Some("Alice Bob"));
        assert_eq!(contact.body, body);
    }

    #[test]
    fn parse_serialize_round_trip_with_emails() {
        let fm = ContactFrontmatter {
            full_name: Some("Bob".to_string()),
            email: Some(vec![
                ContactEmail { field_type: "work".to_string(), value: "bob@work.com".to_string() },
                ContactEmail { field_type: "home".to_string(), value: "bob@home.com".to_string() },
            ]),
            ..Default::default()
        };
        let content = serialize_contact(&fm, "").unwrap();
        let contact = parse_contact("c.md", &content).unwrap();
        let emails = contact.frontmatter.email.unwrap();
        assert_eq!(emails.len(), 2);
        assert_eq!(emails[0].value, "bob@work.com");
        assert_eq!(emails[1].field_type, "home");
    }

    #[test]
    fn parse_serialize_round_trip_with_address_and_neighborhood() {
        let fm = ContactFrontmatter {
            full_name: Some("Carol".to_string()),
            adr: Some(vec![ContactAddress {
                field_type: "home".to_string(),
                street: Some("Rua das Flores, 10".to_string()),
                neighborhood: Some("Centro".to_string()),
                city: Some("São Paulo".to_string()),
                region: Some("SP".to_string()),
                code: Some("01000-000".to_string()),
                country: Some("Brasil".to_string()),
            }]),
            ..Default::default()
        };
        let content = serialize_contact(&fm, "").unwrap();
        let contact = parse_contact("c.md", &content).unwrap();
        let adr = &contact.frontmatter.adr.unwrap()[0];
        assert_eq!(adr.neighborhood.as_deref(), Some("Centro"));
        assert_eq!(adr.city.as_deref(), Some("São Paulo"));
    }

    #[test]
    fn parse_contact_without_frontmatter() {
        let contact = parse_contact("c.md", "Plain body only.").unwrap();
        assert_eq!(contact.body, "Plain body only.");
        assert!(contact.frontmatter.full_name.is_none());
    }

    // ── display_name ──────────────────────────────────────────────────────────

    #[test]
    fn display_name_prefers_full_name() {
        let fm = ContactFrontmatter {
            full_name: Some("Alice Smith".to_string()),
            given_name: Some("Alice".to_string()),
            family_name: Some("Smith".to_string()),
            ..Default::default()
        };
        assert_eq!(fm.display_name(), "Alice Smith");
    }

    #[test]
    fn display_name_combines_given_and_family() {
        let fm = ContactFrontmatter {
            given_name: Some("Alice".to_string()),
            family_name: Some("Smith".to_string()),
            ..Default::default()
        };
        assert_eq!(fm.display_name(), "Alice Smith");
    }

    #[test]
    fn display_name_given_only() {
        let fm = ContactFrontmatter {
            given_name: Some("Alice".to_string()),
            ..Default::default()
        };
        assert_eq!(fm.display_name(), "Alice");
    }

    #[test]
    fn display_name_family_only() {
        let fm = ContactFrontmatter {
            family_name: Some("Smith".to_string()),
            ..Default::default()
        };
        assert_eq!(fm.display_name(), "Smith");
    }

    #[test]
    fn display_name_returns_unnamed_when_all_empty() {
        assert_eq!(ContactFrontmatter::default().display_name(), "Unnamed");
    }

    // ── initials ──────────────────────────────────────────────────────────────

    #[test]
    fn initials_two_words() {
        let fm = ContactFrontmatter { full_name: Some("Alice Bob".to_string()), ..Default::default() };
        assert_eq!(fm.initials(), "AB");
    }

    #[test]
    fn initials_single_word() {
        let fm = ContactFrontmatter { full_name: Some("Madonna".to_string()), ..Default::default() };
        assert_eq!(fm.initials(), "M");
    }

    #[test]
    fn initials_more_than_two_words_takes_only_two() {
        let fm = ContactFrontmatter { full_name: Some("Alice Beth Carol".to_string()), ..Default::default() };
        assert_eq!(fm.initials(), "AB");
    }

    #[test]
    fn initials_are_uppercased() {
        let fm = ContactFrontmatter { full_name: Some("alice bob".to_string()), ..Default::default() };
        assert_eq!(fm.initials(), "AB");
    }

    // ── contact_to_meta ───────────────────────────────────────────────────────

    #[test]
    fn contact_to_meta_primary_email_is_first() {
        let fm = ContactFrontmatter {
            full_name: Some("X".to_string()),
            email: Some(vec![
                ContactEmail { field_type: "work".to_string(), value: "first@x.com".to_string() },
                ContactEmail { field_type: "home".to_string(), value: "second@x.com".to_string() },
            ]),
            ..Default::default()
        };
        let contact = Contact { path: "c.md".to_string(), frontmatter: fm, body: String::new() };
        assert_eq!(contact_to_meta(&contact).primary_email.as_deref(), Some("first@x.com"));
    }

    #[test]
    fn contact_to_meta_no_email_is_none() {
        let fm = ContactFrontmatter { full_name: Some("X".to_string()), ..Default::default() };
        let contact = Contact { path: "c.md".to_string(), frontmatter: fm, body: String::new() };
        assert!(contact_to_meta(&contact).primary_email.is_none());
    }

    // ── proptest round-trips ──────────────────────────────────────────────────

    use proptest::prelude::*;

    proptest! {
        #[test]
        fn contact_serialize_parse_name_and_body_round_trip(
            // Restrict to printable chars — serde_yaml normalises ASCII controls in
            // field values, which is not realistic user input.
            full_name in "[^\x00-\x1F]{0,80}",
            body      in "[^\x00]{0,200}",
        ) {
            let fm = ContactFrontmatter {
                full_name: Some(full_name.clone()),
                ..Default::default()
            };
            let content = serialize_contact(&fm, &body).unwrap();
            let contact = parse_contact("c.md", &content).unwrap();
            prop_assert_eq!(contact.frontmatter.full_name.as_deref(), Some(full_name.as_str()));
            // The parser normalises leading \n then \r chars (CRLF stripping) — intentional.
            let expected = body.trim_start_matches('\n').trim_start_matches('\r');
            prop_assert_eq!(contact.body, expected);
        }
    }
}

fn split_frontmatter(content: &str) -> Result<(ContactFrontmatter, String), String> {
    let s = content.trim_start();
    if !s.starts_with("---") {
        return Ok((ContactFrontmatter::default(), content.to_string()));
    }
    let rest = &s[3..];
    // allow both "\n---" and "\r\n---"
    let end = rest.find("\n---").ok_or("Unclosed frontmatter")?;
    let yaml = &rest[..end];
    let body = rest[end + 4..].trim_start_matches('\n').trim_start_matches('\r').to_string();
    let fm: ContactFrontmatter = serde_yaml::from_str(yaml)
        .map_err(|e| format!("YAML parse error: {e}"))?;
    Ok((fm, body))
}
