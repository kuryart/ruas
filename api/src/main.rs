use actix_cors::Cors;
use actix_web::{App, HttpResponse, HttpServer, Responder, get, post, web};

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    HttpServer::new(|| {
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header()
            .max_age(3600); // 1 hora

        App::new().wrap(cors)
    })
    .bind(("127.0.0.1", 8080))?
    .run()
    .await
}
