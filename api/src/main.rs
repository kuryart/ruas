use actix_cors::Cors;
use actix_web::{App, HttpResponse, HttpServer, Responder, http, post, web};
use chrono::Utc;
use ruas_core::{
    Contact, ContactFrontmatter, ContactMeta, contact_to_meta, parse_contact, serialize_contact,
};
use serde::Deserialize;
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

fn contacts_dir() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".to_string()))
        .join("ruas")
        .join("contacts")
}

fn ensure_contacts_dir() -> Result<PathBuf, String> {
    let dir = contacts_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create contacts dir: {e}"))?;
    Ok(dir)
}

// ── Handlers ───────────────────────────────────────────────────────────────

#[post("/list_contacts")]
async fn list_contacts() -> impl Responder {
    let dir = match ensure_contacts_dir() {
        Ok(d) => d,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let mut metas: Vec<ContactMeta> = Vec::new();
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

#[derive(Deserialize)]
struct PathArg {
    path: String,
}

#[post("/read_contact")]
async fn read_contact(body: web::Json<PathArg>) -> impl Responder {
    match fs::read_to_string(&body.path) {
        Ok(content) => match parse_contact(&body.path, &content) {
            Ok(c) => HttpResponse::Ok().json(c),
            Err(e) => HttpResponse::InternalServerError().body(e),
        },
        Err(e) => HttpResponse::InternalServerError().body(e.to_string()),
    }
}

#[derive(Deserialize)]
struct SaveContactArgs {
    contact: Contact,
}

#[post("/save_contact")]
async fn save_contact(body: web::Json<SaveContactArgs>) -> impl Responder {
    match serialize_contact(&body.contact.frontmatter, &body.contact.body) {
        Ok(content) => match fs::write(&body.contact.path, content) {
            Ok(_) => HttpResponse::Ok().finish(),
            Err(e) => HttpResponse::InternalServerError().body(e.to_string()),
        },
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

#[derive(Deserialize)]
struct CreateContactArgs {
    #[serde(rename = "givenName")]
    given_name: String,
    #[serde(rename = "familyName", default)]
    family_name: String,
}

#[post("/create_contact")]
async fn create_contact(body: web::Json<CreateContactArgs>) -> impl Responder {
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
async fn delete_contact(body: web::Json<PathArg>) -> impl Responder {
    match fs::remove_file(&body.path) {
        Ok(_) => HttpResponse::Ok().finish(),
        Err(e) => HttpResponse::InternalServerError().body(e.to_string()),
    }
}

// ── Entry point ────────────────────────────────────────────────────────────

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    HttpServer::new(|| {
        let frontend_url = std::env::var("RUAS_FRONTEND_URL")
            .unwrap_or_else(|_| "http://localhost:4321".to_string());
        let cors = Cors::default()
            .allowed_origin(&frontend_url)
            .allowed_methods(vec!["POST", "GET", "OPTIONS"])
            .allowed_headers(vec![
                http::header::AUTHORIZATION,
                http::header::ACCEPT,
                http::header::CONTENT_TYPE,
            ])
            .max_age(3600);

        App::new()
            .wrap(cors)
            .service(list_contacts)
            .service(read_contact)
            .service(save_contact)
            .service(create_contact)
            .service(delete_contact)
    })
    .bind(("0.0.0.0", 8080))?
    .run()
    .await
}
