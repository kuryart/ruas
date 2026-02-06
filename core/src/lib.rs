use serde::Deserialize; // Importe o trait Deserialize

#[derive(Deserialize)] // Essencial para que o Serde saiba como desserializar para esta struct
pub struct GreetPayload {
    pub name: String,
}

pub fn greet(payload: GreetPayload) -> String {
    println!("{}", payload.name);
    format!("Hello, {}! You've been greeted from Rust!", payload.name)
}
