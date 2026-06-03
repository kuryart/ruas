use actix_web::{HttpResponse, Responder, post, web};
use chrono::Utc;
use ruas_core::{Contact, ContactFrontmatter, contact_to_meta, parse_contact, serialize_contact};
use serde::Deserialize;
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

pub fn contacts_dir() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".to_string()))
        .join("ruas")
        .join("contacts")
}

pub fn ensure_contacts_dir() -> Result<PathBuf, String> {
    let dir = contacts_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create contacts dir: {e}"))?;
    Ok(dir)
}

// ── Request types ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct PathArg {
    pub path: String,
}

#[derive(Deserialize)]
pub struct SaveContactArgs {
    pub contact: Contact,
}

#[derive(Deserialize)]
pub struct CreateContactArgs {
    #[serde(rename = "givenName")]
    pub given_name: String,
    #[serde(rename = "familyName", default)]
    pub family_name: String,
}

// ── Handlers ───────────────────────────────────────────────────────────────

#[post("/list_contacts")]
pub async fn list_contacts() -> impl Responder {
    let dir = match ensure_contacts_dir() {
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
                if let Ok(c) = parse_contact(&p.to_string_lossy(), &content) {
                    metas.push(contact_to_meta(&c));
                }
            }
        }
    }
    metas.sort_by(|a, b| a.display_name.cmp(&b.display_name));
    HttpResponse::Ok().json(metas)
}

#[post("/read_contact")]
pub async fn read_contact(body: web::Json<PathArg>) -> impl Responder {
    match fs::read_to_string(&body.path) {
        Ok(content) => match parse_contact(&body.path, &content) {
            Ok(c) => HttpResponse::Ok().json(c),
            Err(e) => HttpResponse::InternalServerError().body(e),
        },
        Err(e) => HttpResponse::InternalServerError().body(e.to_string()),
    }
}

#[post("/save_contact")]
pub async fn save_contact(body: web::Json<SaveContactArgs>) -> impl Responder {
    match serialize_contact(&body.contact.frontmatter, &body.contact.body) {
        Ok(content) => match fs::write(&body.contact.path, content) {
            Ok(_) => HttpResponse::Ok().finish(),
            Err(e) => HttpResponse::InternalServerError().body(e.to_string()),
        },
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

#[post("/create_contact")]
pub async fn create_contact(body: web::Json<CreateContactArgs>) -> impl Responder {
    let dir = match ensure_contacts_dir() {
        Ok(d) => d,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let uid = Uuid::new_v4().to_string();
    let path = dir.join(format!("{uid}.md"));
    let now = Utc::now().to_rfc3339();
    let full = format!("{} {}", body.given_name, body.family_name)
        .trim()
        .to_string();
    let fm = ContactFrontmatter {
        uid: Some(uid),
        full_name: Some(full),
        given_name: Some(body.given_name.clone()),
        family_name: Some(body.family_name.clone()),
        created: Some(now.clone()),
        modified: Some(now),
        ..Default::default()
    };
    let contact = Contact {
        path: path.to_string_lossy().to_string(),
        frontmatter: fm,
        body: String::new(),
    };
    match serialize_contact(&contact.frontmatter, &contact.body) {
        Ok(content) => match fs::write(&contact.path, content) {
            Ok(_) => HttpResponse::Ok().json(contact),
            Err(e) => HttpResponse::InternalServerError().body(e.to_string()),
        },
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

#[post("/delete_contact")]
pub async fn delete_contact(body: web::Json<PathArg>) -> impl Responder {
    match fs::remove_file(&body.path) {
        Ok(_) => HttpResponse::Ok().finish(),
        Err(e) => HttpResponse::InternalServerError().body(e.to_string()),
    }
}
