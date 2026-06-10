// ── WASM plugin runtime (Extism host) ──────────────────────────────────────
//
// This module provides the host-side implementation for loading and running
// WASM plugins via the Extism runtime. It is gated behind the `wasm` feature
// so that `ruas_core` compiles without the Extism dependency by default.
//
// # PDK contract (what a WASM plugin must export)
//
// Every plugin `.wasm` must export these functions (all use JSON I/O):
//
//   info()          → '{"id":"...","name":"...","version":"...","description":"..."}'
//   capabilities()  → '["VaultRead","VaultWrite",...]'
//   dispatch(cmd, args, vault_path) → '{"ok":...}' or '{"err":"..."}'
//   on_vault_open(vault_path)       → '' or '{"err":"..."}'
//   on_vault_close(vault_path)      → no return
//   on_event(event_json)            → no return
//
// The host provides these imports (via Extism host functions, PDK 1.x):
//
//   host_log(level, msg)          — log a message through the Ruas logger
//   host_get_config(key)          — read a module setting from the vault
//   host_read_dir(path)           — list directory entries (newline-separated)
//   host_read_file(path)          — read raw file contents
//   host_write_file(json)         — write a file ({path, content} as JSON)
//   host_create_dir(path)         — ensure a directory exists
//   host_generate_uuid()          — generate a UUIDv4 string

#[cfg(feature = "wasm")]
use crate::module::{Capability, DispatchResult, Module, ModuleEvent, ModuleInfo, VaultContext};
#[cfg(feature = "wasm")]
use crate::plugin::PluginManifest;
#[cfg(feature = "wasm")]
use extism::{CurrentPlugin, Function, Manifest, Plugin, UserData, Val, ValType};
#[cfg(feature = "wasm")]
use serde_json::Value;
#[cfg(feature = "wasm")]
use std::path::{Path, PathBuf};

// ── Host functions (exposed to WASM guests) ────────────────────────────────
//
// PDK 1.x convention: each import sends/receives a single offset per
// parameter/return. We use CurrentPlugin::memory_get_val / memory_set_val
// which handle the offset↔Rust type conversion transparently.

#[cfg(feature = "wasm")]
fn host_log(
    plugin: &mut CurrentPlugin,
    inputs: &[Val],
    outputs: &mut [Val],
    _user_data: UserData<()>,
) -> Result<(), extism::Error> {
    let level: String = plugin.memory_get_val(&inputs[0])?;
    let msg: String = plugin.memory_get_val(&inputs[1])?;
    match level.as_str() {
        "error" => log::error!("[wasm] {msg}"),
        "warn" => log::warn!("[wasm] {msg}"),
        "info" => log::info!("[wasm] {msg}"),
        _ => log::debug!("[wasm] {msg}"),
    }
    plugin.memory_set_val(&mut outputs[0], &0i32)?;
    Ok(())
}

#[cfg(feature = "wasm")]
fn host_get_config(
    plugin: &mut CurrentPlugin,
    inputs: &[Val],
    outputs: &mut [Val],
    user_data: UserData<String>,
) -> Result<(), extism::Error> {
    let key: String = plugin.memory_get_val(&inputs[0])?;
    // In PDK 1.x, vault_path is not passed as second argument — use empty path
    let vault_path_str = if inputs.len() > 1 {
        let extra: String = plugin.memory_get_val(&inputs[1])?;
        extra
    } else {
        String::new()
    };

    let module_id = user_data.get()?.lock().unwrap().clone();
    let vault_path = PathBuf::from(vault_path_str);
    let settings = crate::module::ModuleSettings::for_module(&vault_path, &module_id);
    let value = settings.get(&key).unwrap_or(Value::Null);
    let json = serde_json::to_string(&value).unwrap_or_else(|_| "null".into());

    plugin.memory_set_val(&mut outputs[0], &json)?;
    Ok(())
}

#[cfg(feature = "wasm")]
fn host_read_dir(
    plugin: &mut CurrentPlugin,
    inputs: &[Val],
    outputs: &mut [Val],
    _user_data: UserData<()>,
) -> Result<(), extism::Error> {
    let path: String = plugin.memory_get_val(&inputs[0])?;
    let mut listing = String::new();
    if let Ok(entries) = std::fs::read_dir(&path) {
        for entry in entries.flatten() {
            if !listing.is_empty() {
                listing.push('\n');
            }
            listing.push_str(&entry.path().to_string_lossy());
        }
    }
    plugin.memory_set_val(&mut outputs[0], &listing)?;
    Ok(())
}

#[cfg(feature = "wasm")]
fn host_read_file(
    plugin: &mut CurrentPlugin,
    inputs: &[Val],
    outputs: &mut [Val],
    _user_data: UserData<()>,
) -> Result<(), extism::Error> {
    let path: String = plugin.memory_get_val(&inputs[0])?;
    let data = std::fs::read(&path).unwrap_or_default();
    plugin.memory_set_val(&mut outputs[0], &data)?;
    Ok(())
}

#[cfg(feature = "wasm")]
fn host_write_file(
    plugin: &mut CurrentPlugin,
    inputs: &[Val],
    outputs: &mut [Val],
    _user_data: UserData<()>,
) -> Result<(), extism::Error> {
    let json_str: String = plugin.memory_get_val(&inputs[0])?;
    if let Ok(args) = serde_json::from_str::<Value>(&json_str) {
        let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
        let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
        if let Some(parent) = std::path::Path::new(path).parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(path, content);
    }
    plugin.memory_set_val(&mut outputs[0], &0i32)?;
    Ok(())
}

#[cfg(feature = "wasm")]
fn host_create_dir(
    plugin: &mut CurrentPlugin,
    inputs: &[Val],
    outputs: &mut [Val],
    _user_data: UserData<()>,
) -> Result<(), extism::Error> {
    let path: String = plugin.memory_get_val(&inputs[0])?;
    let _ = std::fs::create_dir_all(&path);
    plugin.memory_set_val(&mut outputs[0], &0i32)?;
    Ok(())
}

#[cfg(feature = "wasm")]
fn host_system_time(
    _plugin: &mut CurrentPlugin,
    _inputs: &[Val],
    outputs: &mut [Val],
    _user_data: UserData<()>,
) -> Result<(), extism::Error> {
    let ts = chrono::Utc::now().to_rfc3339();
    _plugin.memory_set_val(&mut outputs[0], &ts)?;
    Ok(())
}

#[cfg(feature = "wasm")]
fn host_generate_uuid(
    plugin: &mut CurrentPlugin,
    _inputs: &[Val],
    outputs: &mut [Val],
    _user_data: UserData<()>,
) -> Result<(), extism::Error> {
    let id = uuid::Uuid::new_v4().to_string();
    plugin.memory_set_val(&mut outputs[0], &id)?;
    Ok(())
}

// ── Extism plugin call wrappers ───────────────────────────────────────────
//
// PDK 1.x + Extism runtime 1.x: `plugin.call::<I, O>(name, input)` handles
// serialization/deserialization transparently — no manual memory management.

#[cfg(feature = "wasm")]
fn call_plugin_str(plugin: &mut Plugin, func: &str, input: &str) -> Result<String, String> {
    let output: &str = plugin
        .call(func, input)
        .map_err(|e| format!("call to '{func}' failed: {e}"))?;
    Ok(output.to_owned())
}

#[cfg(feature = "wasm")]
fn call_plugin_void(plugin: &mut Plugin, func: &str, input: &str) -> Result<(), String> {
    let _: () = plugin
        .call(func, input)
        .map_err(|e| format!("call to '{func}' failed: {e}"))?;
    Ok(())
}

// ── WasmPlugin ─────────────────────────────────────────────────────────────

/// A WASM plugin loaded via Extism, implementing the `Module` trait.
#[cfg(feature = "wasm")]
pub struct WasmPlugin {
    info: ModuleInfo,
    capabilities: Vec<Capability>,
    wasm_path: PathBuf,
    module_id: String,
}

#[cfg(feature = "wasm")]
impl WasmPlugin {
    /// Load a WASM plugin from disk, validating its exports match the PDK contract.
    pub fn load(path: &Path, manifest: &PluginManifest) -> Result<Self, String> {
        let wasm_path = path.join(&manifest.entry_point);
        if !wasm_path.exists() {
            return Err(format!(
                "entry point '{}' not found in plugin directory",
                manifest.entry_point
            ));
        }

        // Create a throw-away instance just to read `info` and `capabilities`.
        let wasm_bytes = std::fs::read(&wasm_path).map_err(|e| e.to_string())?;

        let host_functions = vec![
            Function::new(
                "host_log",
                [ValType::I64, ValType::I64],
                [ValType::I64],
                UserData::<()>::default(),
                host_log,
            ),
            Function::new(
                "host_get_config",
                [ValType::I64, ValType::I64],
                [ValType::I64],
                UserData::new(manifest.id.clone()),
                host_get_config,
            ),
            Function::new(
                "host_read_dir",
                [ValType::I64],
                [ValType::I64],
                UserData::<()>::default(),
                host_read_dir,
            )
            .with_namespace("extism:host/user"),
            Function::new(
                "host_read_file",
                [ValType::I64],
                [ValType::I64],
                UserData::<()>::default(),
                host_read_file,
            )
            .with_namespace("extism:host/user"),
            Function::new(
                "host_write_file",
                [ValType::I64],
                [ValType::I64],
                UserData::<()>::default(),
                host_write_file,
            )
            .with_namespace("extism:host/user"),
            Function::new(
                "host_create_dir",
                [ValType::I64],
                [ValType::I64],
                UserData::<()>::default(),
                host_create_dir,
            )
            .with_namespace("extism:host/user"),
            Function::new(
                "host_generate_uuid",
                [],
                [ValType::I64],
                UserData::<()>::default(),
                host_generate_uuid,
            )
            .with_namespace("extism:host/user"),
            Function::new(
                "host_system_time",
                [],
                [ValType::I64],
                UserData::<()>::default(),
                host_system_time,
            )
            .with_namespace("extism:host/user"),
        ];
        let extism_manifest = Manifest::new([wasm_bytes]);
        let mut plugin = Plugin::new(&extism_manifest, host_functions, true)
            .map_err(|e| format!("failed to instantiate plugin: {e}"))?;

        // Read module info
        let info_json = call_plugin_str(&mut plugin, "info", "")?;
        let parsed: ModuleInfo = serde_json::from_str(&info_json)
            .map_err(|e| format!("invalid 'info' response: {e}"))?;
        if parsed.id != manifest.id {
            return Err(format!(
                "plugin id mismatch: manifest says '{}', wasm says '{}'",
                manifest.id, parsed.id
            ));
        }

        // Read capabilities
        let caps_json = call_plugin_str(&mut plugin, "capabilities", "")?;
        let capabilities: Vec<Capability> = serde_json::from_str(&caps_json)
            .map_err(|e| format!("invalid 'capabilities' response: {e}"))?;

        Ok(Self {
            info: parsed,
            capabilities,
            wasm_path,
            module_id: manifest.id.clone(),
        })
    }

    /// Instantiate the extism plugin for a call.
    fn instantiate(&self) -> Result<Plugin, String> {
        let wasm_bytes = std::fs::read(&self.wasm_path).map_err(|e| e.to_string())?;
        let host_functions = vec![
            Function::new(
                "host_log",
                [ValType::I64, ValType::I64],
                [ValType::I64],
                UserData::<()>::default(),
                host_log,
            ),
            Function::new(
                "host_get_config",
                [ValType::I64, ValType::I64],
                [ValType::I64],
                UserData::new(self.module_id.clone()),
                host_get_config,
            ),
            Function::new(
                "host_read_dir",
                [ValType::I64],
                [ValType::I64],
                UserData::<()>::default(),
                host_read_dir,
            )
            .with_namespace("extism:host/user"),
            Function::new(
                "host_read_file",
                [ValType::I64],
                [ValType::I64],
                UserData::<()>::default(),
                host_read_file,
            )
            .with_namespace("extism:host/user"),
            Function::new(
                "host_write_file",
                [ValType::I64],
                [ValType::I64],
                UserData::<()>::default(),
                host_write_file,
            )
            .with_namespace("extism:host/user"),
            Function::new(
                "host_create_dir",
                [ValType::I64],
                [ValType::I64],
                UserData::<()>::default(),
                host_create_dir,
            )
            .with_namespace("extism:host/user"),
            Function::new(
                "host_generate_uuid",
                [],
                [ValType::I64],
                UserData::<()>::default(),
                host_generate_uuid,
            )
            .with_namespace("extism:host/user"),
            Function::new(
                "host_system_time",
                [],
                [ValType::I64],
                UserData::<()>::default(),
                host_system_time,
            )
            .with_namespace("extism:host/user"),
        ];
        let extism_manifest = Manifest::new([wasm_bytes]);
        Plugin::new(&extism_manifest, host_functions, true)
            .map_err(|e| format!("failed to instantiate plugin: {e}"))
    }
}

#[cfg(feature = "wasm")]
impl Module for WasmPlugin {
    fn info(&self) -> &ModuleInfo {
        &self.info
    }

    fn capabilities(&self) -> &[Capability] {
        &self.capabilities
    }

    fn dispatch(&self, command: &str, args: Value, ctx: &VaultContext<'_>) -> DispatchResult {
        let mut plugin = self.instantiate()?;
        let input = serde_json::json!({
            "command": command,
            "args": args,
            "vault_path": ctx.vault_path.to_string_lossy(),
        });
        let input_str = serde_json::to_string(&input).map_err(|e| e.to_string())?;
        let output = call_plugin_str(&mut plugin, "dispatch", &input_str)?;
        let result: Value = serde_json::from_str(&output).map_err(|e| e.to_string())?;

        if let Some(err) = result.get("err").and_then(|v| v.as_str()) {
            Err(err.to_string())
        } else if let Some(ok) = result.get("ok") {
            Ok(ok.clone())
        } else {
            Err("dispatch returned unexpected format".into())
        }
    }

    fn on_vault_open(&self, ctx: &VaultContext<'_>) -> Result<(), String> {
        let mut plugin = self.instantiate()?;
        let result = call_plugin_str(
            &mut plugin,
            "on_vault_open",
            &ctx.vault_path.to_string_lossy(),
        )?;
        if result.is_empty() {
            Ok(())
        } else {
            let err: Value = serde_json::from_str(&result).map_err(|e| e.to_string())?;
            Err(err
                .get("err")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .into())
        }
    }

    fn on_vault_close(&self, ctx: &VaultContext<'_>) {
        if let Ok(mut plugin) = self.instantiate() {
            let _ = call_plugin_void(
                &mut plugin,
                "on_vault_close",
                &ctx.vault_path.to_string_lossy(),
            );
        }
    }

    fn on_event(&self, event: &ModuleEvent, ctx: &VaultContext<'_>) {
        if let Ok(mut plugin) = self.instantiate() {
            let event_json = serde_json::to_string(event).unwrap_or_default();
            let input = serde_json::json!({
                "event": event_json,
                "vault_path": ctx.vault_path.to_string_lossy(),
            });
            let _ = call_plugin_void(&mut plugin, "on_event", &input.to_string());
        }
    }
}

// ── Feature-gated loaders ────────────────────────────────────────────────

/// Attempt to load a plugin from within a vault (vault/.ruas/plugins/<safe_id>/).
#[cfg(feature = "wasm")]
pub fn try_load_plugin(vault_path: &Path, manifest: &PluginManifest) -> Result<WasmPlugin, String> {
    let dir = crate::plugin::plugin_dir(vault_path, &manifest.id);
    WasmPlugin::load(&dir, manifest)
}

/// Attempt to load a plugin from an arbitrary directory containing plugin.wasm.
/// Used by the native plugin loader (resources/plugins/<name>/).
#[cfg(feature = "wasm")]
pub fn try_load_plugin_from_dir(
    dir: &Path,
    manifest: &PluginManifest,
) -> Result<WasmPlugin, String> {
    WasmPlugin::load(dir, manifest)
}

/// Stub — always returns an error when the `wasm` feature is disabled.
#[cfg(not(feature = "wasm"))]
pub fn try_load_plugin(_vault_path: &Path, _manifest: &PluginManifest) -> Result<(), String> {
    Err(
        "WASM plugin support is not compiled in — rebuild with `cargo build --features wasm`"
            .into(),
    )
}

/// Stub for the non-wasm path.
#[cfg(not(feature = "wasm"))]
pub fn try_load_plugin_from_dir(_dir: &Path, _manifest: &PluginManifest) -> Result<(), String> {
    Err(
        "WASM plugin support is not compiled in — rebuild with `cargo build --features wasm`"
            .into(),
    )
}
