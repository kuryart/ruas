#[cfg(feature = "wasm")]
pub mod wasm;
//
// Plugins live in `<vault>/.ruas/plugins/<plugin-id>/`.
// Each plugin directory must contain a `manifest.json` describing the plugin.
//
// Discovery: scan the directory on vault open, compare with the registry,
// and load/unload plugins as their enabled state changes.

use crate::module::{Capability, Version};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

// ── PluginManifest ──────────────────────────────────────────────────────────

/// Deserialised from `manifest.json` inside the plugin directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    /// Reverse-domain identifier — must NOT start with `"ruas."`.
    pub id: String,
    pub name: String,
    pub version: Version,
    pub description: String,
    /// Author name (or GitHub handle).
    #[serde(default)]
    pub author: String,
    /// Capabilities the plugin requests. The user approves each individually.
    #[serde(default)]
    pub capabilities: Vec<Capability>,
    /// Relative path to the `.wasm` entry point inside the plugin directory.
    /// Default: `"plugin.wasm"`.
    #[serde(default = "default_entry_point")]
    pub entry_point: String,
    /// Minimum Ruas app version required.
    #[serde(default)]
    pub min_app_version: Option<Version>,
    /// Plugin kind: `"wasm"` (runtime) or `"tool"` (external script/utility).
    /// Default: `"wasm"`.
    #[serde(default = "default_kind")]
    pub kind: String,
}

fn default_entry_point() -> String {
    "plugin.wasm".to_string()
}

fn default_kind() -> String {
    "wasm".to_string()
}

// ── Plugin directory layout ─────────────────────────────────────────────────

/// Root directory for all plugins inside a vault.
pub fn plugins_dir(vault_path: &Path) -> PathBuf {
    vault_path.join(".ruas").join("plugins")
}

/// Directory for a single plugin.
pub fn plugin_dir(vault_path: &Path, plugin_id: &str) -> PathBuf {
    let safe_id = plugin_id.replace(['.', '/', '\\'], "_");
    plugins_dir(vault_path).join(safe_id)
}

/// Path to a plugin's manifest.
pub fn manifest_path(vault_path: &Path, plugin_id: &str) -> PathBuf {
    plugin_dir(vault_path, plugin_id).join("manifest.json")
}

// ── Discovery ───────────────────────────────────────────────────────────────

/// Error when loading a plugin manifest.
#[derive(Debug)]
pub enum ManifestError {
    Io(std::io::Error),
    Json(serde_json::Error),
    InvalidId(String),
}

impl std::fmt::Display for ManifestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(e) => write!(f, "I/O error: {e}"),
            Self::Json(e) => write!(f, "invalid JSON: {e}"),
            Self::InvalidId(msg) => write!(f, "invalid manifest: {msg}"),
        }
    }
}

/// Load a single `manifest.json`.
pub fn load_manifest(path: &Path) -> Result<PluginManifest, ManifestError> {
    let content = std::fs::read_to_string(path).map_err(ManifestError::Io)?;
    let manifest: PluginManifest =
        serde_json::from_str(&content).map_err(ManifestError::Json)?;

    // Built-in namespace is reserved.
    if manifest.id.starts_with("ruas.") {
        return Err(ManifestError::InvalidId(
            "plugin IDs must not use the 'ruas.' namespace".to_string(),
        ));
    }

    Ok(manifest)
}

/// Scan `<vault>/.ruas/plugins/` and return all valid manifests.
/// Invalid or unreadable manifests are logged and skipped.
pub fn discover_plugins(vault_path: &Path) -> Vec<PluginManifest> {
    let dir = plugins_dir(vault_path);
    if !dir.exists() {
        return vec![];
    }

    let mut manifests = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            if !entry_path.is_dir() {
                continue;
            }
            let mf_path = entry_path.join("manifest.json");
            if !mf_path.exists() {
                continue;
            }
            match load_manifest(&mf_path) {
                Ok(mf) => manifests.push(mf),
                Err(e) => log::warn!(
                    "Skipping plugin in '{}': {e}",
                    entry_path.display()
                ),
            }
        }
    }

    manifests
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_rejects_ruas_namespace() {
        let dir = std::env::temp_dir().join("ruas_plugin_test_ns");
        std::fs::create_dir_all(&dir).unwrap();
        let mf = dir.join("manifest.json");
        std::fs::write(&mf, r#"{"id":"ruas.test","name":"Test","version":{"major":0,"minor":1,"patch":0},"description":"x"}"#).unwrap();
        let result = load_manifest(&mf);
        assert!(result.is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn manifest_loads_valid_plugin() {
        let dir = std::env::temp_dir().join("ruas_plugin_test_ok");
        std::fs::create_dir_all(&dir).unwrap();
        let mf = dir.join("manifest.json");
        std::fs::write(&mf, r#"{"id":"com.example.hello","name":"Hello","version":{"major":1,"minor":0,"patch":0},"description":"A test plugin","author":"dev","capabilities":["VaultRead"]}"#).unwrap();
        let result = load_manifest(&mf).unwrap();
        assert_eq!(result.id, "com.example.hello");
        assert_eq!(result.capabilities.len(), 1);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn discover_plugins_finds_valid_manifests() {
        let vault = std::env::temp_dir().join("ruas_plugin_test_vault");
        let _ = std::fs::remove_dir_all(&vault);
        let pdir = plugins_dir(&vault);
        std::fs::create_dir_all(pdir.join("my-plugin")).unwrap();
        std::fs::write(
            pdir.join("my-plugin").join("manifest.json"),
            r#"{"id":"com.example.my","name":"My","version":{"major":0,"minor":1,"patch":0},"description":"desc"}"#,
        ).unwrap();
        // A directory without manifest — should be skipped
        std::fs::create_dir_all(pdir.join("empty-dir")).unwrap();
        // A directory with invalid JSON — should be skipped
        std::fs::create_dir_all(pdir.join("bad-plugin")).unwrap();
        std::fs::write(pdir.join("bad-plugin").join("manifest.json"), b"not json").unwrap();

        let found = discover_plugins(&vault);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, "com.example.my");

        std::fs::remove_dir_all(&vault).ok();
    }
}
