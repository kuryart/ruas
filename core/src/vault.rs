use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultConfig {
    pub name: String,
    pub created: String,
}

pub fn create_vault(base_path: &Path, name: &str) -> Result<VaultConfig, String> {
    fs::create_dir_all(base_path)
        .map_err(|e| format!("Não foi possível criar o diretório do cofre: {e}"))?;
    let ruas_dir = base_path.join(".ruas");
    fs::create_dir_all(&ruas_dir)
        .map_err(|e| format!("Não foi possível criar o diretório .ruas: {e}"))?;
    let config = VaultConfig {
        name: name.to_string(),
        created: Utc::now().to_rfc3339(),
    };
    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Erro ao serializar configuração: {e}"))?;
    fs::write(ruas_dir.join("config.json"), json)
        .map_err(|e| format!("Erro ao salvar configuração: {e}"))?;
    Ok(config)
}

pub fn validate_vault(base_path: &Path) -> Result<VaultConfig, String> {
    if !base_path.exists() {
        return Err("Pasta não encontrada".to_string());
    }
    let config_path = base_path.join(".ruas").join("config.json");
    if !config_path.exists() {
        return Err(
            "Pasta inválida: não é um cofre Ruas (.ruas/config.json não encontrado)".to_string(),
        );
    }
    let json = fs::read_to_string(&config_path)
        .map_err(|e| format!("Erro ao ler configuração do cofre: {e}"))?;
    serde_json::from_str(&json).map_err(|_| "Configuração do cofre corrompida".to_string())
}
