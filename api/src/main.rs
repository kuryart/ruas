mod contacts;
mod notes;

use actix_cors::Cors;
use actix_web::{App, HttpServer, http};

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
            .service(contacts::list_contacts)
            .service(contacts::read_contact)
            .service(contacts::save_contact)
            .service(contacts::create_contact)
            .service(contacts::delete_contact)
            .service(notes::list_notes)
            .service(notes::read_note)
            .service(notes::search_notes)
            .service(notes::save_note)
            .service(notes::create_note)
            .service(notes::delete_note)
            .service(notes::list_blocks_handler)
            .service(notes::get_backlinks)
            .service(notes::list_notes_tree)
            .service(notes::list_appearance)
            .service(notes::read_appearance_css)
            .service(notes::get_appearance_config)
            .service(notes::set_appearance_config)
    })
    .bind(("0.0.0.0", 8080))?
    .run()
    .await
}
