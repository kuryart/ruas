use serde::{Deserialize, Serialize};

// ── Block reference types ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockMeta {
    pub id: String,
    pub preview: String, // first ~80 chars of block text, markdown stripped
}

fn has_block_id(s: &str) -> bool {
    let s = s.trim_end();
    if let Some(idx) = s.rfind(" ^") {
        let after = &s[idx + 2..];
        !after.is_empty() && after.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    } else {
        false
    }
}

fn extract_block_id(line: &str) -> Option<BlockMeta> {
    let s = line.trim_end();
    let idx = s.rfind(" ^")?;
    let after = &s[idx + 2..];
    if after.is_empty() || !after.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return None;
    }
    let raw = s[..idx].trim();
    let text = strip_md_prefix(raw);
    let preview = if text.len() > 80 {
        format!("{}…", text.chars().take(80).collect::<String>())
    } else {
        text.to_string()
    };
    Some(BlockMeta { id: after.to_string(), preview })
}

fn strip_md_prefix(s: &str) -> &str {
    let s = s.trim_start_matches('#').trim_start();
    if let Some(rest) = s.strip_prefix("- ").or_else(|| s.strip_prefix("* ")).or_else(|| s.strip_prefix("+ ")) {
        return rest;
    }
    if let Some(dot) = s.find(". ") {
        if s[..dot].chars().all(|c| c.is_ascii_digit()) {
            return &s[dot + 2..];
        }
    }
    s
}

fn is_separator_line(s: &str) -> bool {
    let mut chars = s.chars().peekable();
    let c = match chars.next() { Some(c) => c, None => return false };
    if c != '-' && c != '*' && c != '_' { return false; }
    let mut count = 1usize;
    for x in chars {
        if x == c { count += 1; } else if x != ' ' { return false; }
    }
    count >= 3
}

fn is_table_sep(s: &str) -> bool {
    s.contains('-') && s.chars().all(|c| c == '|' || c == '-' || c == ':' || c == ' ')
}

fn gen_block_id() -> String {
    uuid::Uuid::new_v4().to_string().replace('-', "")[..6].to_string()
}

/// Returns all blocks in `body` that carry a `^id` marker.
pub fn list_blocks(body: &str) -> Vec<BlockMeta> {
    body.lines().filter_map(extract_block_id).collect()
}

/// Assigns a 6-char random ID to every referenceable line that doesn't have one.
/// Called on `list_blocks` so the popup always has items. Returns (possibly modified) body.
pub fn ensure_block_ids(body: &str) -> String {
    let mut out = String::with_capacity(body.len() + 128);
    let mut in_fence = false;

    for line in body.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            out.push_str(line);
            out.push('\n');
            continue;
        }

        let skip = in_fence
            || trimmed.is_empty()
            || trimmed == "---"
            || is_separator_line(trimmed)
            || is_table_sep(trimmed);

        if skip || has_block_id(trimmed) {
            out.push_str(line);
        } else {
            out.push_str(line.trim_end());
            out.push_str(&format!(" ^{}", gen_block_id()));
        }
        out.push('\n');
    }

    if !body.ends_with('\n') && out.ends_with('\n') { out.pop(); }
    out
}

// ── Note types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NoteFrontmatter {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified: Option<String>,
    /// Arbitrary user-defined properties, preserved verbatim through the
    /// parse/serialize round-trip so custom frontmatter is never dropped.
    #[serde(flatten, default)]
    pub extra: std::collections::BTreeMap<String, serde_yaml::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub path: String,
    pub frontmatter: NoteFrontmatter,
    pub body: String,
}

/// Lightweight version for listing (avoids sending full body over IPC)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteMeta {
    pub path: String,
    pub title: String,
    pub tags: Option<Vec<String>>,
    pub modified: Option<String>,
}

/// A note that links to another note (incoming reference).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacklinkMeta {
    pub source_path: String,
    pub source_title: String,
    pub context: String, // ~100 chars of text around the link
}

/// A node in the notes folder tree (`is_dir` distinguishes folders from notes).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteTreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<NoteTreeNode>,
}

// ── Parse / serialize ──────────────────────────────────────────────────────

pub fn parse_note(path: &str, content: &str) -> Result<Note, String> {
    let (frontmatter, body) = split_frontmatter(content)?;
    Ok(Note { path: path.to_string(), frontmatter, body })
}

pub fn serialize_note(fm: &NoteFrontmatter, body: &str) -> Result<String, String> {
    let yaml = serde_yaml::to_string(fm)
        .map_err(|e| format!("YAML serialize error: {e}"))?;
    Ok(format!("---\n{yaml}---\n\n{body}"))
}

pub fn note_to_meta(n: &Note) -> NoteMeta {
    NoteMeta {
        path: n.path.clone(),
        title: n.frontmatter.title.clone().unwrap_or_else(|| "Untitled".to_string()),
        tags: n.frontmatter.tags.clone(),
        modified: n.frontmatter.modified.clone(),
    }
}

/// Scan a directory of `.md` notes and return metas ranked by relevance to
/// `query`. An empty query returns every note ordered by last-modified.
/// Shared by the Notes module (Tauri) and the web API.
pub fn search_notes_in_dir(dir: &std::path::Path, query: &str) -> Vec<NoteMeta> {
    let q = query.trim().to_lowercase();
    let mut scored: Vec<(i64, NoteMeta)> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for entry in rd.flatten() {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            let Ok(content) = std::fs::read_to_string(&p) else { continue };
            let Ok(n) = parse_note(&p.to_string_lossy(), &content) else { continue };
            let meta = note_to_meta(&n);
            let score = score_note(&q, &meta, &n.body);
            if q.is_empty() || score > 0 {
                scored.push((score, meta));
            }
        }
    }
    // Higher score first; tie-break on most recently modified.
    scored.sort_by(|a, b| {
        b.0.cmp(&a.0).then_with(|| {
            b.1.modified.as_deref().unwrap_or("").cmp(a.1.modified.as_deref().unwrap_or(""))
        })
    });
    scored.into_iter().map(|(_, m)| m).collect()
}

/// Extract every `[[…]]` wiki link in `body` paired with a short surrounding
/// context snippet. The returned link string is the raw inner text (before any
/// `|alias` or `^block`), trimmed.
fn wiki_links_with_context(body: &str) -> Vec<(String, String)> {
    let bytes = body.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'[' && bytes[i + 1] == b'[' {
            if let Some(close) = body[i + 2..].find("]]") {
                let inner = &body[i + 2..i + 2 + close];
                if !inner.contains('\n') {
                    let target = inner.split(['|', '^']).next().unwrap_or("").trim().to_string();
                    // Context window: ~50 chars on each side, collapsed to one line.
                    let ctx_start = body[..i].char_indices().rev().nth(50).map(|(p, _)| p).unwrap_or(0);
                    let end = i + 2 + close + 2;
                    let ctx_end = body[end..].char_indices().nth(50).map(|(p, _)| end + p).unwrap_or(body.len());
                    let context = body[ctx_start..ctx_end].split_whitespace().collect::<Vec<_>>().join(" ");
                    out.push((target, context));
                }
                i = i + 2 + close + 2;
                continue;
            }
        }
        i += 1;
    }
    out
}

/// Scan `dir` for notes that link to the note at `target_path` (by title or
/// uid). Returns one entry per linking note.
pub fn find_backlinks_in_dir(dir: &std::path::Path, target_path: &str) -> Vec<BacklinkMeta> {
    let Ok(target_content) = std::fs::read_to_string(target_path) else { return Vec::new() };
    let Ok(target) = parse_note(target_path, &target_content) else { return Vec::new() };
    let target_title = target.frontmatter.title.unwrap_or_default().to_lowercase();
    let target_uid = target.frontmatter.uid.unwrap_or_default().to_lowercase();
    if target_title.is_empty() && target_uid.is_empty() {
        return Vec::new();
    }

    let mut out: Vec<BacklinkMeta> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for entry in rd.flatten() {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            if p.to_string_lossy() == target_path {
                continue; // skip self-references
            }
            let Ok(content) = std::fs::read_to_string(&p) else { continue };
            let Ok(note) = parse_note(&p.to_string_lossy(), &content) else { continue };
            for (link, context) in wiki_links_with_context(&note.body) {
                let key = link.to_lowercase();
                let hit = (!target_title.is_empty() && key == target_title)
                    || (!target_uid.is_empty() && key == target_uid);
                if hit {
                    out.push(BacklinkMeta {
                        source_path: p.to_string_lossy().to_string(),
                        source_title: note.frontmatter.title.clone().unwrap_or_else(|| "Untitled".to_string()),
                        context,
                    });
                    break; // one entry per source note
                }
            }
        }
    }
    out.sort_by(|a, b| a.source_title.to_lowercase().cmp(&b.source_title.to_lowercase()));
    out
}

/// Lowercased link targets (title + uid) used to look a note up in the backlinks
/// index. Returns None when the note has neither a title nor a uid.
fn backlink_keys(path: &str) -> Option<Vec<String>> {
    let content = std::fs::read_to_string(path).ok()?;
    let note = parse_note(path, &content).ok()?;
    let mut keys = Vec::new();
    if let Some(t) = note.frontmatter.title {
        if !t.is_empty() { keys.push(t.to_lowercase()); }
    }
    if let Some(u) = note.frontmatter.uid {
        if !u.is_empty() { keys.push(u.to_lowercase()); }
    }
    (!keys.is_empty()).then_some(keys)
}

/// Build an FTS5 MATCH expression from a raw query: each alphanumeric token
/// becomes a prefix term (`tok*`) combined with implicit AND. Returns None when
/// the query yields no usable tokens (so callers can fall back to listing).
pub fn fts_query(raw: &str) -> Option<String> {
    let tokens: Vec<String> = raw
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| format!("{}*", t.to_lowercase()))
        .collect();
    (!tokens.is_empty()).then(|| tokens.join(" "))
}

/// Recursively walk `dir` building a tree of folders and `.md` notes. Note
/// nodes carry their frontmatter title (falling back to the file stem).
pub fn build_notes_tree(dir: &std::path::Path) -> Vec<NoteTreeNode> {
    let mut nodes: Vec<NoteTreeNode> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for entry in rd.flatten() {
            let p = entry.path();
            if p.is_dir() {
                nodes.push(NoteTreeNode {
                    name: p.file_name().unwrap_or_default().to_string_lossy().to_string(),
                    path: p.to_string_lossy().to_string(),
                    is_dir: true,
                    children: build_notes_tree(&p),
                });
            } else if p.extension().and_then(|e| e.to_str()) == Some("md") {
                let title = std::fs::read_to_string(&p)
                    .ok()
                    .and_then(|c| parse_note(&p.to_string_lossy(), &c).ok())
                    .and_then(|n| n.frontmatter.title)
                    .unwrap_or_else(|| p.file_stem().unwrap_or_default().to_string_lossy().to_string());
                nodes.push(NoteTreeNode {
                    name: title,
                    path: p.to_string_lossy().to_string(),
                    is_dir: false,
                    children: Vec::new(),
                });
            }
        }
    }
    // Folders first, then notes; alphabetical within each group.
    nodes.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    nodes
}

/// Lightweight relevance score for a note against a lowercased query.
/// Title matches outrank tag matches, which outrank body matches.
fn score_note(q: &str, meta: &NoteMeta, body: &str) -> i64 {
    if q.is_empty() {
        return 0;
    }
    let title = meta.title.to_lowercase();
    let mut score = 0i64;
    if title == q {
        score += 1000;
    } else if title.starts_with(q) {
        score += 500;
    } else if title.contains(q) {
        score += 250;
    } else if is_subsequence(q, &title) {
        score += 100;
    }
    if let Some(tags) = &meta.tags {
        if tags.iter().any(|t| t.to_lowercase().contains(q)) {
            score += 60;
        }
    }
    if body.to_lowercase().contains(q) {
        score += 30;
    }
    score
}

/// True when every char of `needle` appears in `haystack` in order.
fn is_subsequence(needle: &str, haystack: &str) -> bool {
    let mut chars = haystack.chars();
    needle.chars().all(|c| chars.any(|h| h == c))
}

fn split_frontmatter(content: &str) -> Result<(NoteFrontmatter, String), String> {
    let s = content.trim_start();
    if !s.starts_with("---") {
        return Ok((NoteFrontmatter::default(), content.to_string()));
    }
    let rest = &s[3..];
    let end = rest.find("\n---").ok_or("Unclosed frontmatter")?;
    let yaml = &rest[..end];
    let body = rest[end + 4..].trim_start_matches('\n').trim_start_matches('\r').to_string();
    let fm: NoteFrontmatter = serde_yaml::from_str(yaml)
        .map_err(|e| format!("YAML parse error: {e}"))?;
    Ok((fm, body))
}

// ── Module implementation ──────────────────────────────────────────────────

use crate::module::{
    Capability, CommandDescriptor, DispatchResult, Module, ModuleEvent, ModuleInfo,
    ParamDescriptor, ParamKind, SettingField, VaultContext, Version,
};
use chrono::Utc;
use serde_json::Value;
use std::sync::OnceLock;
use uuid::Uuid;

pub struct NotesModule {
    info: ModuleInfo,
}

impl Default for NotesModule {
    fn default() -> Self {
        Self {
            info: ModuleInfo {
                id: "ruas.notes".to_string(),
                name: "Notes".to_string(),
                version: Version::new(0, 1, 0),
                description: "Markdown note-taking backed by plain files".to_string(),
            },
        }
    }
}

impl NotesModule {
    fn notes_dir<'a>(&self, ctx: &VaultContext<'a>) -> std::path::PathBuf {
        ctx.vault_path.join("notes")
    }

    fn cmd_list(&self, ctx: &VaultContext<'_>) -> DispatchResult {
        let dir = self.notes_dir(ctx);
        let mut metas: Vec<NoteMeta> = Vec::new();
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for entry in rd.flatten() {
                let p = entry.path();
                if p.extension().and_then(|e| e.to_str()) != Some("md") {
                    continue;
                }
                if let Ok(content) = std::fs::read_to_string(&p) {
                    if let Ok(n) = parse_note(&p.to_string_lossy(), &content) {
                        metas.push(note_to_meta(&n));
                    }
                }
            }
        }
        // Most recently modified first
        metas.sort_by(|a, b| {
            b.modified.as_deref().unwrap_or("").cmp(a.modified.as_deref().unwrap_or(""))
        });
        serde_json::to_value(metas).map_err(|e| e.to_string())
    }

    fn cmd_search(&self, query: &str, ctx: &VaultContext<'_>) -> DispatchResult {
        // Prefer the FTS5 index; fall back to a filesystem scan if unavailable.
        if let Some(index) = ctx.index() {
            match fts_query(query) {
                Some(fts) => {
                    if let Ok(results) = index.search_entity(&fts, "note", 50) {
                        let metas: Vec<NoteMeta> = results
                            .into_iter()
                            .map(|r| NoteMeta {
                                path: r.path,
                                title: r.title.unwrap_or_else(|| "Untitled".to_string()),
                                tags: None,
                                modified: None,
                            })
                            .collect();
                        return serde_json::to_value(metas).map_err(|e| e.to_string());
                    }
                }
                // Empty/symbol-only query → list everything (most-recent first).
                None => return self.cmd_list(ctx),
            }
        }
        let metas = search_notes_in_dir(&self.notes_dir(ctx), query);
        serde_json::to_value(metas).map_err(|e| e.to_string())
    }

    fn cmd_read(&self, path: &str, _ctx: &VaultContext<'_>) -> DispatchResult {
        let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        let note = parse_note(path, &content)?;
        serde_json::to_value(note).map_err(|e| e.to_string())
    }

    fn cmd_create(&self, title: String, ctx: &VaultContext<'_>) -> DispatchResult {
        let dir = self.notes_dir(ctx);
        let uid = Uuid::new_v4().to_string();
        let path = dir.join(format!("{uid}.md"));
        let now = Utc::now().to_rfc3339();
        let fm = NoteFrontmatter {
            uid: Some(uid.clone()),
            title: Some(if title.is_empty() { "Untitled".to_string() } else { title }),
            created: Some(now.clone()),
            modified: Some(now),
            ..Default::default()
        };
        let note = Note {
            path: path.to_string_lossy().to_string(),
            frontmatter: fm,
            body: String::new(),
        };
        let content = serialize_note(&note.frontmatter, &note.body)?;
        std::fs::write(&note.path, content).map_err(|e| e.to_string())?;
        ctx.events.emit(ModuleEvent::NoteSaved { uid });
        serde_json::to_value(note).map_err(|e| e.to_string())
    }

    fn cmd_save(&self, mut note: Note, ctx: &VaultContext<'_>) -> DispatchResult {
        note.frontmatter.modified = Some(Utc::now().to_rfc3339());
        // Assign block IDs so `[[note^block]]` references always have a target.
        note.body = ensure_block_ids(&note.body);
        let content = serialize_note(&note.frontmatter, &note.body)?;
        std::fs::write(&note.path, content).map_err(|e| e.to_string())?;
        if let Some(uid) = &note.frontmatter.uid {
            ctx.events.emit(ModuleEvent::NoteSaved { uid: uid.clone() });
        }
        Ok(Value::Null)
    }

    fn cmd_list_blocks(&self, path: &str) -> DispatchResult {
        let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        let note = parse_note(path, &content)?;
        // Lazily assign IDs — writes back only if body changed.
        let new_body = ensure_block_ids(&note.body);
        if new_body != note.body {
            let new_content = serialize_note(&note.frontmatter, &new_body)?;
            std::fs::write(path, new_content).map_err(|e| e.to_string())?;
        }
        let blocks = list_blocks(&new_body);
        serde_json::to_value(blocks).map_err(|e| e.to_string())
    }

    fn cmd_backlinks(&self, path: &str, ctx: &VaultContext<'_>) -> DispatchResult {
        // Use the indexed links table when available; otherwise scan files.
        if let Some(index) = ctx.index() {
            if let Some(keys) = backlink_keys(path) {
                if let Ok(rows) = index.backlinks(&keys) {
                    let links: Vec<BacklinkMeta> = rows
                        .into_iter()
                        .filter(|(src, _, _)| src != path) // drop self-references
                        .map(|(source_path, source_title, context)| BacklinkMeta {
                            source_path,
                            source_title: source_title.unwrap_or_else(|| "Untitled".to_string()),
                            context,
                        })
                        .collect();
                    return serde_json::to_value(links).map_err(|e| e.to_string());
                }
            }
        }
        let links = find_backlinks_in_dir(&self.notes_dir(ctx), path);
        serde_json::to_value(links).map_err(|e| e.to_string())
    }

    fn cmd_tree(&self, ctx: &VaultContext<'_>) -> DispatchResult {
        let tree = build_notes_tree(&self.notes_dir(ctx));
        serde_json::to_value(tree).map_err(|e| e.to_string())
    }

    fn cmd_delete(&self, path: &str, ctx: &VaultContext<'_>) -> DispatchResult {
        let uid = std::fs::read_to_string(path)
            .ok()
            .and_then(|c| parse_note(path, &c).ok())
            .and_then(|n| n.frontmatter.uid);
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
        if let Some(uid) = uid {
            ctx.events.emit(ModuleEvent::NoteDeleted { uid });
        }
        Ok(Value::Null)
    }
}

impl Module for NotesModule {
    fn info(&self) -> &ModuleInfo {
        &self.info
    }

    fn capabilities(&self) -> &[Capability] {
        &[Capability::VaultRead, Capability::VaultWrite, Capability::IndexRead]
    }

    fn settings_schema(&self) -> &[SettingField] {
        &[]
    }

    fn commands(&self) -> &[CommandDescriptor] {
        static COMMANDS: OnceLock<Vec<CommandDescriptor>> = OnceLock::new();
        COMMANDS.get_or_init(|| {
            let path_param = || ParamDescriptor {
                name: "path".into(),
                kind: ParamKind::String,
                required: true,
                description_key: "notes-param-path".into(),
            };
            vec![
                CommandDescriptor {
                    name: "list".into(),
                    label_key: "notes-cmd-list".into(),
                    description_key: "notes-cmd-list-desc".into(),
                    params: vec![],
                },
                CommandDescriptor {
                    name: "read".into(),
                    label_key: "notes-cmd-read".into(),
                    description_key: "notes-cmd-read-desc".into(),
                    params: vec![path_param()],
                },
                CommandDescriptor {
                    name: "search".into(),
                    label_key: "notes-cmd-search".into(),
                    description_key: "notes-cmd-search-desc".into(),
                    params: vec![ParamDescriptor {
                        name: "query".into(),
                        kind: ParamKind::String,
                        required: false,
                        description_key: "notes-param-query".into(),
                    }],
                },
                CommandDescriptor {
                    name: "create".into(),
                    label_key: "notes-cmd-create".into(),
                    description_key: "notes-cmd-create-desc".into(),
                    params: vec![ParamDescriptor {
                        name: "title".into(),
                        kind: ParamKind::String,
                        required: false,
                        description_key: "notes-param-title".into(),
                    }],
                },
                CommandDescriptor {
                    name: "save".into(),
                    label_key: "notes-cmd-save".into(),
                    description_key: "notes-cmd-save-desc".into(),
                    params: vec![ParamDescriptor {
                        name: "note".into(),
                        kind: ParamKind::Json,
                        required: true,
                        description_key: "notes-param-note".into(),
                    }],
                },
                CommandDescriptor {
                    name: "delete".into(),
                    label_key: "notes-cmd-delete".into(),
                    description_key: "notes-cmd-delete-desc".into(),
                    params: vec![path_param()],
                },
                CommandDescriptor {
                    name: "list_blocks".into(),
                    label_key: "notes-cmd-list-blocks".into(),
                    description_key: "notes-cmd-list-blocks-desc".into(),
                    params: vec![path_param()],
                },
                CommandDescriptor {
                    name: "backlinks".into(),
                    label_key: "notes-cmd-backlinks".into(),
                    description_key: "notes-cmd-backlinks-desc".into(),
                    params: vec![path_param()],
                },
                CommandDescriptor {
                    name: "tree".into(),
                    label_key: "notes-cmd-tree".into(),
                    description_key: "notes-cmd-tree-desc".into(),
                    params: vec![],
                },
            ]
        })
    }

    fn dispatch(&self, command: &str, args: Value, ctx: &VaultContext<'_>) -> DispatchResult {
        match command {
            "list" => self.cmd_list(ctx),
            "read" => {
                let path = args["path"].as_str().ok_or("missing required param: path")?;
                self.cmd_read(path, ctx)
            }
            "search" => {
                let query = args["query"].as_str().unwrap_or("");
                self.cmd_search(query, ctx)
            }
            "create" => {
                let title = args["title"].as_str().unwrap_or("").to_string();
                self.cmd_create(title, ctx)
            }
            "save" => {
                let note: Note = serde_json::from_value(args["note"].clone())
                    .map_err(|e| format!("invalid note payload: {e}"))?;
                self.cmd_save(note, ctx)
            }
            "delete" => {
                let path = args["path"].as_str().ok_or("missing required param: path")?;
                self.cmd_delete(path, ctx)
            }
            "list_blocks" => {
                let path = args["path"].as_str().ok_or("missing required param: path")?;
                self.cmd_list_blocks(path)
            }
            "backlinks" => {
                let path = args["path"].as_str().ok_or("missing required param: path")?;
                self.cmd_backlinks(path, ctx)
            }
            "tree" => self.cmd_tree(ctx),
            _ => Err(format!("Unknown command: {command}")),
        }
    }

    fn on_vault_open(&self, ctx: &VaultContext<'_>) -> Result<(), String> {
        let dir = ctx.vault_path.join("notes");
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("notes: cannot create notes dir: {e}"))?;

        if let Some(index) = ctx.index() {
            if let Ok(entries) = std::fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.extension().and_then(|e| e.to_str()) == Some("md") {
                        self.index_note_file(index, &p);
                    }
                }
            }
        }

        Ok(())
    }

    fn on_event(&self, event: &ModuleEvent, ctx: &VaultContext<'_>) {
        let Some(index) = ctx.index() else { return };
        let notes_dir = ctx.vault_path.join("notes");
        match event {
            ModuleEvent::FileCreated { path } | ModuleEvent::FileModified { path } => {
                let p = std::path::Path::new(path);
                if p.starts_with(&notes_dir)
                    && p.extension().and_then(|e| e.to_str()) == Some("md")
                {
                    self.index_note_file(index, p);
                }
            }
            ModuleEvent::FileDeleted { path } => {
                let p = std::path::Path::new(path);
                if p.starts_with(&notes_dir) {
                    let _ = index.remove(path);
                }
            }
            _ => {}
        }
    }
}

impl NotesModule {
    fn index_note_file(&self, index: &crate::index::IndexManager, path: &std::path::Path) {
        let Ok(content) = std::fs::read_to_string(path) else { return };
        let Ok(note) = parse_note(&path.to_string_lossy(), &content) else { return };
        let path_str = path.to_string_lossy();
        let _ = index.upsert(
            &path_str,
            note.frontmatter.uid.as_deref(),
            "note",
            note.frontmatter.title.as_deref(),
            &note.body,
        );
        // Record this note's outgoing wiki links for backlink lookups.
        let links: Vec<(String, String)> = wiki_links_with_context(&note.body)
            .into_iter()
            .map(|(target, context)| (target.to_lowercase(), context))
            .collect();
        let _ = index.set_links(&path_str, note.frontmatter.title.as_deref(), &links);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontmatter_preserves_custom_properties() {
        let src = "---\ntitle: Hello\ntags:\n  - a\n  - b\nstatus: draft\npriority: 3\n---\n\nBody text\n";
        let note = parse_note("x.md", src).unwrap();
        assert_eq!(note.frontmatter.title.as_deref(), Some("Hello"));
        assert_eq!(note.frontmatter.extra.get("status").and_then(|v| v.as_str()), Some("draft"));
        assert_eq!(note.frontmatter.extra.get("priority").and_then(|v| v.as_i64()), Some(3));

        // Round-trip: custom props survive serialize → parse.
        let out = serialize_note(&note.frontmatter, &note.body).unwrap();
        let again = parse_note("x.md", &out).unwrap();
        assert_eq!(again.frontmatter.extra.get("status").and_then(|v| v.as_str()), Some("draft"));
        assert_eq!(again.frontmatter.extra.get("priority").and_then(|v| v.as_i64()), Some(3));
    }

    #[test]
    fn backlinks_match_by_title() {
        let body = "see [[Target Note]] and [[Other]] here";
        let links = wiki_links_with_context(body);
        assert!(links.iter().any(|(l, _)| l == "Target Note"));
        assert!(links.iter().any(|(l, _)| l == "Other"));
    }
}
