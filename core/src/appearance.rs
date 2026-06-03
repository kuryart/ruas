//! User appearance: CSS themes and snippets loaded from the vault.
//!
//! The vault owns `.ruas/themes/*.css` (full themes) and `.ruas/snippets/*.css`
//! (toggleable snippets). User CSS is sanitized to strip remote network requests
//! (`@import`, remote `url()`) as defense-in-depth — the webview CSP is the
//! primary guarantee. Selection state lives in `.ruas/appearance.json`.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppearanceFile {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppearanceList {
    pub themes: Vec<AppearanceFile>,
    pub snippets: Vec<AppearanceFile>,
}

/// Which user theme / snippets are active. Persisted to `.ruas/appearance.json`
/// so the choice travels with the vault.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AppearanceConfig {
    #[serde(default, rename = "userTheme", skip_serializing_if = "Option::is_none")]
    pub user_theme: Option<String>,
    #[serde(default, rename = "enabledSnippets")]
    pub enabled_snippets: Vec<String>,
}

fn themes_dir(vault: &Path) -> PathBuf { vault.join(".ruas").join("themes") }
fn snippets_dir(vault: &Path) -> PathBuf { vault.join(".ruas").join("snippets") }
fn config_path(vault: &Path) -> PathBuf { vault.join(".ruas").join("appearance.json") }

/// Create the themes/snippets folders if missing (called lazily on listing).
pub fn ensure_dirs(vault: &Path) {
    let _ = std::fs::create_dir_all(themes_dir(vault));
    let _ = std::fs::create_dir_all(snippets_dir(vault));
}

fn scan_css(dir: &Path) -> Vec<AppearanceFile> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) == Some("css") {
                out.push(AppearanceFile {
                    name: p.file_stem().unwrap_or_default().to_string_lossy().to_string(),
                    path: p.to_string_lossy().to_string(),
                });
            }
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

/// All user themes and snippets in the vault.
pub fn list_appearance(vault: &Path) -> AppearanceList {
    ensure_dirs(vault);
    AppearanceList {
        themes: scan_css(&themes_dir(vault)),
        snippets: scan_css(&snippets_dir(vault)),
    }
}

/// Read a CSS file (sanitized), restricted to the vault's appearance folders.
pub fn read_appearance_css(vault: &Path, path: &str) -> Result<String, String> {
    let canon = std::fs::canonicalize(Path::new(path)).map_err(|e| e.to_string())?;
    let allowed = [
        std::fs::canonicalize(themes_dir(vault)).ok(),
        std::fs::canonicalize(snippets_dir(vault)).ok(),
    ];
    if !allowed.iter().flatten().any(|d| canon.starts_with(d)) {
        return Err("appearance: path outside themes/snippets folders".into());
    }
    let css = std::fs::read_to_string(&canon).map_err(|e| e.to_string())?;
    Ok(sanitize_user_css(&css))
}

/// Strip network-reaching constructs from user CSS: `@import` rules and remote
/// `url(...)` (http(s):// or protocol-relative //). Local/`data:` URLs are kept.
pub fn sanitize_user_css(css: &str) -> String {
    static IMPORT: OnceLock<Regex> = OnceLock::new();
    static REMOTE_URL: OnceLock<Regex> = OnceLock::new();
    let import = IMPORT.get_or_init(|| Regex::new(r"(?i)@import[^;]*;").unwrap());
    let remote = REMOTE_URL.get_or_init(|| Regex::new(r#"(?i)url\(\s*['"]?\s*(?:https?:)?//[^)]*\)"#).unwrap());
    let s = import.replace_all(css, "");
    remote.replace_all(&s, "url()").into_owned()
}

/// Read the persisted selection (defaults to empty when absent/corrupt).
pub fn read_config(vault: &Path) -> AppearanceConfig {
    std::fs::read_to_string(config_path(vault))
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default()
}

/// Persist the selection to `.ruas/appearance.json`.
pub fn write_config(vault: &Path, config: &AppearanceConfig) -> Result<(), String> {
    ensure_dirs(vault);
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(config_path(vault), json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_strips_remote_requests() {
        let css = "@import url(https://evil.com/x.css);\n\
                   .a { background: url('http://t.io/p.png'); }\n\
                   .b { background: url(//cdn.io/a.png); }\n\
                   .c { background: url(local.png); }\n\
                   .d { background: url(data:image/png;base64,AAA); }";
        let out = sanitize_user_css(css);
        assert!(!out.contains("@import"), "should drop @import");
        assert!(!out.to_lowercase().contains("http"), "should drop http(s) urls");
        assert!(!out.contains("//cdn"), "should drop protocol-relative urls");
        assert!(out.contains("url(local.png)"), "should keep local urls");
        assert!(out.contains("data:image/png"), "should keep data: urls");
    }
}
