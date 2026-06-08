use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

// ── Schema ─────────────────────────────────────────────────────────────────

/// Declares a single configurable field a module exposes in the Settings UI.
#[derive(Debug, Clone)]
pub struct SettingField {
    /// Machine key — used as the JSON property name in the persisted config.
    pub key: &'static str,
    /// i18n key for the label shown in the Settings panel.
    pub label_key: &'static str,
    /// Optional i18n key for helper text below the field.
    pub description_key: Option<&'static str>,
    pub kind: SettingKind,
    /// Value used when no config has been saved yet.
    pub default: Value,
    pub required: bool,
}

#[derive(Debug, Clone)]
pub enum SettingKind {
    Text,
    Password,
    Toggle,
    Url,
    Number { min: Option<f64>, max: Option<f64> },
    Select { options: Vec<SelectOption> },
}

#[derive(Debug, Clone)]
pub struct SelectOption {
    /// Raw value stored in config.
    pub value: &'static str,
    /// i18n key for the label shown in the dropdown.
    pub label_key: &'static str,
}

// ── ModuleSettings ─────────────────────────────────────────────────────────

/// Read/write access to a module's persisted configuration.
///
/// Config is stored at `<vault>/.ruas/modules/<sanitized-id>/config.json`.
/// All methods are infallible on read (return defaults on missing file) and
/// return `Err` only when a write fails.
pub struct ModuleSettings {
    config_path: PathBuf,
}

impl ModuleSettings {
    /// Construct for a given module inside a vault.
    pub fn for_module(vault_path: &Path, module_id: &str) -> Self {
        // Sanitize the module ID so it is safe to use as a directory name
        let safe_id = module_id.replace(['.', '/', '\\'], "_");
        Self {
            config_path: vault_path
                .join(".ruas")
                .join("modules")
                .join(safe_id)
                .join("config.json"),
        }
    }

    /// Read all settings as a JSON object. Returns an empty object if no
    /// config file exists yet.
    pub fn get_all(&self) -> Value {
        self.load().unwrap_or_else(|_| Value::Object(Default::default()))
    }

    /// Read a single setting by key. Returns `None` if the key or config
    /// file does not exist.
    pub fn get(&self, key: &str) -> Option<Value> {
        let all = self.load().ok()?;
        all.get(key).cloned()
    }

    /// Write a single setting, merging it into the existing config.
    pub fn set(&self, key: &str, value: Value) -> Result<(), String> {
        let mut all = self.get_all();
        all.as_object_mut()
            .ok_or("config is not a JSON object")?
            .insert(key.to_string(), value);
        self.save(&all)
    }

    /// Replace the entire config with a new JSON object.
    pub fn set_all(&self, values: Value) -> Result<(), String> {
        if !values.is_object() {
            return Err("settings must be a JSON object".to_string());
        }
        self.save(&values)
    }

    // ── Internal ───────────────────────────────────────────────────────

    fn load(&self) -> Result<Value, String> {
        let content = fs::read_to_string(&self.config_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    }

    fn save(&self, values: &Value) -> Result<(), String> {
        if let Some(parent) = self.config_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(values).map_err(|e| e.to_string())?;
        fs::write(&self.config_path, json).map_err(|e| e.to_string())
    }
}
