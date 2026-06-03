use actix_web::{HttpResponse, Responder, post, web};
use chrono::Utc;
use ruas_core::{AppearanceConfig, BacklinkMeta, BlockMeta, Note, NoteFrontmatter, NoteMeta, NoteTreeNode, build_notes_tree, ensure_block_ids, find_backlinks_in_dir, list_blocks, note_to_meta, parse_note, serialize_note};
use serde::Deserialize;
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

pub fn notes_dir() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".to_string()))
        .join("ruas")
        .join("notes")
}

pub fn ensure_notes_dir() -> Result<PathBuf, String> {
    let dir = notes_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create notes dir: {e}"))?;
    Ok(dir)
}

// ── Request types ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct PathArg {
    pub path: String,
}

#[derive(Deserialize)]
pub struct SaveNoteArgs {
    pub note: Note,
}

#[derive(Deserialize)]
pub struct CreateNoteArgs {
    #[serde(default)]
    pub title: String,
}

// ── Handlers ───────────────────────────────────────────────────────────────

#[post("/list_notes")]
pub async fn list_notes() -> impl Responder {
    let dir = match ensure_notes_dir() {
        Ok(d) => d,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let mut metas = Vec::new();
    if let Ok(rd) = fs::read_dir(&dir) {
        for entry in rd.flatten() {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            if let Ok(content) = fs::read_to_string(&p) {
                if let Ok(n) = parse_note(&p.to_string_lossy(), &content) {
                    metas.push(note_to_meta(&n));
                }
            }
        }
    }
    metas.sort_by(|a, b| {
        b.modified.as_deref().unwrap_or("").cmp(a.modified.as_deref().unwrap_or(""))
    });
    HttpResponse::Ok().json(metas)
}

#[derive(Deserialize)]
pub struct SearchArgs {
    #[serde(default)]
    pub query: String,
}

#[post("/search_notes")]
pub async fn search_notes(body: web::Json<SearchArgs>) -> impl Responder {
    let dir = match ensure_notes_dir() {
        Ok(d) => d,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let metas: Vec<NoteMeta> = ruas_core::search_notes_in_dir(&dir, &body.query);
    HttpResponse::Ok().json(metas)
}

#[post("/read_note")]
pub async fn read_note(body: web::Json<PathArg>) -> impl Responder {
    match fs::read_to_string(&body.path) {
        Ok(content) => match parse_note(&body.path, &content) {
            Ok(n) => HttpResponse::Ok().json(n),
            Err(e) => HttpResponse::InternalServerError().body(e),
        },
        Err(e) => HttpResponse::InternalServerError().body(e.to_string()),
    }
}

#[post("/save_note")]
pub async fn save_note(body: web::Json<SaveNoteArgs>) -> impl Responder {
    let mut note = body.into_inner().note;
    note.frontmatter.modified = Some(Utc::now().to_rfc3339());
    note.body = ensure_block_ids(&note.body);
    match serialize_note(&note.frontmatter, &note.body) {
        Ok(content) => match fs::write(&note.path, content) {
            Ok(_) => HttpResponse::Ok().finish(),
            Err(e) => HttpResponse::InternalServerError().body(e.to_string()),
        },
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

#[post("/create_note")]
pub async fn create_note(body: web::Json<CreateNoteArgs>) -> impl Responder {
    let dir = match ensure_notes_dir() {
        Ok(d) => d,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let uid = Uuid::new_v4().to_string();
    let path = dir.join(format!("{uid}.md"));
    let now = Utc::now().to_rfc3339();
    let title = if body.title.is_empty() { "Untitled".to_string() } else { body.title.clone() };
    let fm = NoteFrontmatter {
        uid: Some(uid),
        title: Some(title),
        created: Some(now.clone()),
        modified: Some(now),
        ..Default::default()
    };
    let note = Note {
        path: path.to_string_lossy().to_string(),
        frontmatter: fm,
        body: String::new(),
    };
    match serialize_note(&note.frontmatter, &note.body) {
        Ok(content) => match fs::write(&note.path, content) {
            Ok(_) => HttpResponse::Ok().json(note),
            Err(e) => HttpResponse::InternalServerError().body(e.to_string()),
        },
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

#[post("/delete_note")]
pub async fn delete_note(body: web::Json<PathArg>) -> impl Responder {
    match fs::remove_file(&body.path) {
        Ok(_) => HttpResponse::Ok().finish(),
        Err(e) => HttpResponse::InternalServerError().body(e.to_string()),
    }
}

#[post("/list_blocks")]
pub async fn list_blocks_handler(body: web::Json<PathArg>) -> impl Responder {
    let path = &body.path;
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e.to_string()),
    };
    let note = match parse_note(path, &content) {
        Ok(n) => n,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let new_body = ensure_block_ids(&note.body);
    if new_body != note.body {
        if let Ok(new_content) = serialize_note(&note.frontmatter, &new_body) {
            let _ = fs::write(path, new_content);
        }
    }
    let blocks: Vec<BlockMeta> = list_blocks(&new_body);
    HttpResponse::Ok().json(blocks)
}

#[post("/get_backlinks")]
pub async fn get_backlinks(body: web::Json<PathArg>) -> impl Responder {
    let dir = match ensure_notes_dir() {
        Ok(d) => d,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let links: Vec<BacklinkMeta> = find_backlinks_in_dir(&dir, &body.path);
    HttpResponse::Ok().json(links)
}

#[post("/list_notes_tree")]
pub async fn list_notes_tree() -> impl Responder {
    let dir = match ensure_notes_dir() {
        Ok(d) => d,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let tree: Vec<NoteTreeNode> = build_notes_tree(&dir);
    HttpResponse::Ok().json(tree)
}

// ── Appearance (user themes & snippets) ──────────────────────────────────────

fn vault_root() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".to_string())).join("ruas")
}

#[post("/list_appearance")]
pub async fn list_appearance() -> impl Responder {
    HttpResponse::Ok().json(ruas_core::list_appearance(&vault_root()))
}

#[post("/read_appearance_css")]
pub async fn read_appearance_css(body: web::Json<PathArg>) -> impl Responder {
    match ruas_core::read_appearance_css(&vault_root(), &body.path) {
        Ok(css) => HttpResponse::Ok().content_type("text/css").body(css),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

#[post("/get_appearance_config")]
pub async fn get_appearance_config() -> impl Responder {
    HttpResponse::Ok().json(ruas_core::read_appearance_config(&vault_root()))
}

#[derive(Deserialize)]
pub struct AppearanceConfigArg {
    pub config: AppearanceConfig,
}

#[post("/set_appearance_config")]
pub async fn set_appearance_config(body: web::Json<AppearanceConfigArg>) -> impl Responder {
    match ruas_core::write_appearance_config(&vault_root(), &body.config) {
        Ok(_) => HttpResponse::Ok().finish(),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}
