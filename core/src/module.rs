mod capability;
mod command;
mod event;
mod settings;

// ── Public re-exports ──────────────────────────────────────────────────────

pub use capability::{Capability, TrustLevel};
pub use command::{CommandDescriptor, DispatchResult, ParamDescriptor, ParamKind};
pub use event::{EventSink, ModuleEvent, NoopSink};
pub use settings::{ModuleSettings, SelectOption, SettingField, SettingKind};

pub(crate) use event::BufferedSink;

use crate::index::IndexManager;
use serde_json::Value;
use std::path::Path;
use std::sync::Arc;

// ── Version ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize)]
pub struct Version {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

impl Version {
    pub const fn new(major: u32, minor: u32, patch: u32) -> Self {
        Self { major, minor, patch }
    }
}

impl std::fmt::Display for Version {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

// ── ModuleInfo ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ModuleInfo {
    /// Reverse-domain identifier — globally unique.
    /// Built-ins: `"ruas.*"`. Third-party plugins must not use this namespace.
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
}

// ── VaultContext ───────────────────────────────────────────────────────────

/// Resources available to a module while a vault is open.
///
/// Always created by the registry — never by transport (Tauri/HTTP) code.
/// Use `VaultContext::new()` in tests.
pub struct VaultContext<'a> {
    pub vault_path: &'a Path,
    /// Sink for events emitted during this invocation.
    /// The registry collects and re-dispatches them after the hook returns.
    pub events: &'a dyn EventSink,
    /// Shared SQLite index — `None` when the index is unavailable (e.g. tests).
    index: Option<Arc<IndexManager>>,
    /// Set of paths the app is currently renaming on disk.
    /// The file watcher checks this before processing `FileDeleted` events so
    /// that programmatic renames don't corrupt the index.
    rename_guard: Option<Arc<std::sync::Mutex<std::collections::HashSet<String>>>>,
}

impl<'a> VaultContext<'a> {
    /// Standard constructor. Index is not available — use `with_index` to add it.
    pub fn new(vault_path: &'a Path, events: &'a dyn EventSink) -> Self {
        Self { vault_path, events, index: None, rename_guard: None }
    }

    /// Attach the shared index to this context (called by the registry).
    pub(crate) fn with_index(mut self, index: Arc<IndexManager>) -> Self {
        self.index = Some(index);
        self
    }

    /// Attach the rename guard (called by the registry when one is configured).
    pub(crate) fn with_rename_guard(
        mut self,
        guard: Arc<std::sync::Mutex<std::collections::HashSet<String>>>,
    ) -> Self {
        self.rename_guard = Some(guard);
        self
    }

    /// Access the SQLite index. Returns `None` when unavailable (no vault, test context).
    pub fn index(&self) -> Option<&IndexManager> {
        self.index.as_deref()
    }

    /// Register `old_path` as an in-progress programmatic rename.
    ///
    /// Call this before `std::fs::rename`; the file watcher will skip the
    /// corresponding `FileDeleted` event so the index stays intact.
    /// The entry is removed when the watcher handles the `FileDeleted`.
    pub fn guard_rename(&self, old_path: &str) {
        if let Some(guard) = &self.rename_guard {
            guard.lock().unwrap().insert(old_path.to_string());
        }
    }

    /// Convenience accessor for this module's persisted configuration.
    pub fn settings(&self, module_id: &str) -> ModuleSettings {
        ModuleSettings::for_module(self.vault_path, module_id)
    }
}

// ── Module trait ───────────────────────────────────────────────────────────

/// Core interface every module — built-in or external plugin — must implement.
///
/// All methods have default no-op implementations; override only what the
/// module actually uses. The trait is intentionally kept minimal so WASM
/// plugins (Phase 2) can implement it without heavy dependencies.
///
/// # Contract
/// - `info()` and `capabilities()` must be pure and cheap to call.
/// - Lifecycle hooks must **not** panic — return `Err` instead.
/// - `dispatch()` is the module's command handler; it receives JSON args
///   and returns JSON, keeping the interface backend-agnostic.
pub trait Module: Send + Sync {
    // ── Identity & capabilities ────────────────────────────────────────

    fn info(&self) -> &ModuleInfo;

    /// Resources this module requires; checked before activation.
    fn capabilities(&self) -> &[Capability] {
        &[]
    }

    // ── Settings schema ────────────────────────────────────────────────

    /// Declare fields the user can configure in the Settings UI.
    /// The runtime uses this to build the settings panel automatically.
    fn settings_schema(&self) -> &[SettingField] {
        &[]
    }

    // ── Command registry ───────────────────────────────────────────────

    /// Declare the commands this module exposes.
    /// Used by the UI for menus, help text, and future plugin manifests.
    fn commands(&self) -> &[CommandDescriptor] {
        &[]
    }

    /// Handle a command invocation. Called by `ModuleRegistry::dispatch`.
    ///
    /// `args` is a JSON object whose shape is described by `commands()`.
    /// Return `Err` for unknown commands or invalid arguments.
    fn dispatch(
        &self,
        command: &str,
        _args: Value,
        _ctx: &VaultContext<'_>,
    ) -> DispatchResult {
        Err(format!("Unknown command: {command}"))
    }

    // ── Lifecycle ──────────────────────────────────────────────────────

    /// Called after the vault is validated and opened.
    /// Use to create directories, warm caches, or run migrations.
    fn on_vault_open(&self, _ctx: &VaultContext<'_>) -> Result<(), String> {
        Ok(())
    }

    /// Called before the vault is released (app exit or vault switch).
    /// Use to flush state or close connections.
    fn on_vault_close(&self, _ctx: &VaultContext<'_>) {}

    /// React to an event broadcast by the registry or another module.
    fn on_event(&self, _event: &ModuleEvent, _ctx: &VaultContext<'_>) {}
}

// ── RegistryEntry ──────────────────────────────────────────────────────────

pub struct RegistryEntry {
    pub module: Box<dyn Module>,
    pub trust: TrustLevel,
    /// Capabilities that have been explicitly approved for this entry.
    /// For `Core` modules this mirrors `module.capabilities()`.
    /// For `Plugin` modules it grows as the user grants permissions.
    pub(crate) approved: Vec<Capability>,
}

impl RegistryEntry {
    /// Public read-only access to approved capabilities.
    pub fn approved_capabilities(&self) -> &[Capability] {
        &self.approved
    }
}

// ── ModuleRegistry ─────────────────────────────────────────────────────────

/// Holds all registered modules and coordinates lifecycle events.
///
/// Created once at app startup, populated with built-ins (and eventually
/// WASM plugins), then stored in Tauri app state as `RegistryState`.
pub struct ModuleRegistry {
    entries: Vec<RegistryEntry>,
    /// Shared SQLite index — set on vault open, cleared on vault close.
    index: Option<Arc<IndexManager>>,
    /// Shared rename guard — set by the Tauri layer so that programmatic
    /// file renames don't trigger spurious `FileDeleted` index removals.
    rename_guard: Option<Arc<std::sync::Mutex<std::collections::HashSet<String>>>>,
}

impl ModuleRegistry {
    pub fn new() -> Self {
        Self { entries: Vec::new(), index: None, rename_guard: None }
    }

    /// Access the active index (if a vault is open).
    pub fn index(&self) -> Option<&IndexManager> {
        self.index.as_deref()
    }

    /// Cloneable handle to the index — passed to file watcher threads.
    pub fn index_arc(&self) -> Option<Arc<IndexManager>> {
        self.index.clone()
    }

    /// Attach the rename guard. Called once by the Tauri layer after building
    /// the registry. The same `Arc` must be shared with the file watcher.
    pub fn set_rename_guard(
        &mut self,
        guard: Arc<std::sync::Mutex<std::collections::HashSet<String>>>,
    ) {
        self.rename_guard = Some(guard);
    }

    /// Cloneable handle to the rename guard — passed to the file watcher.
    pub fn rename_guard_arc(
        &self,
    ) -> Option<Arc<std::sync::Mutex<std::collections::HashSet<String>>>> {
        self.rename_guard.clone()
    }

    // ── Registration ───────────────────────────────────────────────────

    /// Register a built-in module (all capabilities pre-approved, cannot be disabled).
    pub fn register(&mut self, module: impl Module + 'static) {
        let approved = module.capabilities().to_vec();
        self.entries.push(RegistryEntry {
            module: Box::new(module),
            trust: TrustLevel::Core,
            approved,
        });
    }

    /// Register a native plugin (all capabilities pre-approved, can be disabled).
    /// Native plugins are shipped with the app in the `plugins/` directory.
    pub fn register_native(&mut self, module: impl Module + 'static) {
        let approved = module.capabilities().to_vec();
        self.entries.push(RegistryEntry {
            module: Box::new(module),
            trust: TrustLevel::Native,
            approved,
        });
    }

    /// Register a plugin with explicitly approved capabilities.
    ///
    /// Plugins start with no capabilities; each capability must be individually
    /// approved by the user before the plugin can dispatch commands that require it.
    /// The `approved` list is typically loaded from the plugin's persisted config.
    pub fn register_plugin(
        &mut self,
        module: impl Module + 'static,
        approved: Vec<Capability>,
    ) {
        self.entries.push(RegistryEntry {
            module: Box::new(module),
            trust: TrustLevel::Plugin,
            approved,
        });
    }

    /// Unregister a module by its ID. Returns `true` if the entry was found and removed.
    pub fn unregister(&mut self, id: &str) -> bool {
        let len_before = self.entries.len();
        self.entries.retain(|e| e.module.info().id != id);
        self.entries.len() < len_before
    }

    /// Update the approved capabilities for a registered plugin entry.
    /// Silently no-ops if the entry is not found or is `TrustLevel::Core` or `TrustLevel::Native`.
    pub fn set_plugin_approved(&mut self, id: &str, approved: Vec<Capability>) {
        if let Some(entry) = self.entries.iter_mut().find(|e| e.module.info().id == id) {
            if entry.trust == TrustLevel::Plugin {
                entry.approved = approved;
            }
        }
    }

    // ── Introspection ──────────────────────────────────────────────────

    /// Look up a module by its reverse-domain ID.
    pub fn get(&self, id: &str) -> Option<&dyn Module> {
        self.entries.iter().find(|e| e.module.info().id == id).map(|e| e.module.as_ref())
    }

    /// All registry entries (includes trust level and approved capabilities).
    pub fn entries(&self) -> &[RegistryEntry] {
        &self.entries
    }

    // ── Capability enforcement (Point 4) ───────────────────────────────

    /// Returns error strings for any capability the entry declares but
    /// does not have approved. Empty list = all capabilities granted.
    fn check_capabilities(&self, entry: &RegistryEntry) -> Vec<String> {
        match entry.trust {
            TrustLevel::Core | TrustLevel::Native => vec![], // built-ins & native are always trusted
            TrustLevel::Plugin => entry
                .module
                .capabilities()
                .iter()
                .filter(|cap| !entry.approved.contains(cap))
                .map(|cap| format!("Capability {:?} not approved", cap))
                .collect(),
        }
    }

    // ── Context factory ────────────────────────────────────────────────

    fn make_ctx<'a>(&self, vault_path: &'a Path, events: &'a dyn EventSink) -> VaultContext<'a> {
        let ctx = VaultContext::new(vault_path, events);
        let ctx = match &self.index {
            Some(idx) => ctx.with_index(Arc::clone(idx)),
            None => ctx,
        };
        match &self.rename_guard {
            Some(guard) => ctx.with_rename_guard(Arc::clone(guard)),
            None => ctx,
        }
    }

    // ── Command dispatch (Point 1) ─────────────────────────────────────

    /// Route a command to the named module, enforce capabilities, collect
    /// and re-dispatch any events the module emits during handling.
    pub fn dispatch(
        &self,
        module_id: &str,
        command: &str,
        args: Value,
        vault_path: &Path,
    ) -> DispatchResult {
        let entry = self
            .entries
            .iter()
            .find(|e| e.module.info().id == module_id)
            .ok_or_else(|| format!("Module '{module_id}' not found"))?;

        let violations = self.check_capabilities(entry);
        if !violations.is_empty() {
            return Err(format!("Capability violation: {}", violations.join("; ")));
        }

        let sink = BufferedSink::new();
        let ctx = self.make_ctx(vault_path, &sink);
        let result = entry.module.dispatch(command, args, &ctx)?;

        self.flush_events(sink.drain(), vault_path);
        Ok(result)
    }

    // ── Lifecycle broadcasting ─────────────────────────────────────────

    /// Open the vault: create the SQLite index, run `on_vault_open` on all
    /// modules (capability-failing modules are skipped), then broadcast
    /// `VaultOpened`. Returns `(module_id, error)` pairs for any failures.
    pub fn on_vault_open(&mut self, vault_path: &Path) -> Vec<(String, String)> {
        // 1. Open the index first so modules can use it in on_vault_open
        match IndexManager::open(vault_path) {
            Ok(idx) => self.index = Some(Arc::new(idx)),
            Err(e) => log::error!("Failed to open index: {e}"),
        }

        let sink = BufferedSink::new();
        let mut errors = Vec::new();

        for entry in &self.entries {
            let violations = self.check_capabilities(entry);
            if !violations.is_empty() {
                for v in violations {
                    errors.push((entry.module.info().id.clone(), v));
                }
                continue;
            }
            let ctx = self.make_ctx(vault_path, &sink);
            if let Err(e) = entry.module.on_vault_open(&ctx) {
                errors.push((entry.module.info().id.clone(), e));
            }
        }

        self.flush_events(sink.drain(), vault_path);
        self.broadcast(&ModuleEvent::VaultOpened, vault_path);

        errors
    }

    /// Close the vault: broadcast `VaultClosed`, run `on_vault_close` on all
    /// modules, then release the SQLite index.
    pub fn on_vault_close(&mut self, vault_path: &Path) {
        self.broadcast(&ModuleEvent::VaultClosed, vault_path);
        let noop = NoopSink;
        for entry in &self.entries {
            let ctx = self.make_ctx(vault_path, &noop);
            entry.module.on_vault_close(&ctx);
        }
        self.index = None; // drops the Arc; connection closes when last clone is gone
    }

    /// Broadcast an arbitrary event to all modules (called by file watcher).
    pub fn emit(&self, event: &ModuleEvent, vault_path: &Path) {
        self.broadcast(event, vault_path);
    }

    // ── Internal ───────────────────────────────────────────────────────

    fn flush_events(&self, events: Vec<ModuleEvent>, vault_path: &Path) {
        if events.is_empty() { return; }
        let noop = NoopSink;
        for event in &events {
            for entry in &self.entries {
                let ctx = self.make_ctx(vault_path, &noop);
                entry.module.on_event(event, &ctx);
            }
        }
    }

    fn broadcast(&self, event: &ModuleEvent, vault_path: &Path) {
        let noop = NoopSink;
        for entry in &self.entries {
            let ctx = self.make_ctx(vault_path, &noop);
            entry.module.on_event(event, &ctx);
        }
    }
}

impl Default for ModuleRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::Arc;

    // ── Stubs ──────────────────────────────────────────────────────────

    struct StubModule {
        info: ModuleInfo,
        opened: Arc<AtomicBool>,
        closed: Arc<AtomicBool>,
        events_received: Arc<AtomicUsize>,
    }

    impl StubModule {
        fn new(id: &str, opened: Arc<AtomicBool>, closed: Arc<AtomicBool>, events_received: Arc<AtomicUsize>) -> Self {
            Self {
                info: ModuleInfo {
                    id: id.to_string(),
                    name: "Stub".into(),
                    version: "0.1.0".to_string(),
                    description: "Test stub".into(),
                },
                opened,
                closed,
                events_received,
            }
        }
    }

    impl Module for StubModule {
        fn info(&self) -> &ModuleInfo { &self.info }
        fn capabilities(&self) -> &[Capability] { &[Capability::VaultRead] }

        fn on_vault_open(&self, _: &VaultContext<'_>) -> Result<(), String> {
            self.opened.store(true, Ordering::SeqCst);
            Ok(())
        }
        fn on_vault_close(&self, _: &VaultContext<'_>) {
            self.closed.store(true, Ordering::SeqCst);
        }
        fn on_event(&self, _event: &ModuleEvent, _ctx: &VaultContext<'_>) {
            self.events_received.fetch_add(1, Ordering::SeqCst);
        }
        fn commands(&self) -> &[CommandDescriptor] {
            static CMDS: std::sync::OnceLock<Vec<CommandDescriptor>> = std::sync::OnceLock::new();
            CMDS.get_or_init(|| vec![
                CommandDescriptor {
                    name: "ping".into(),
                    label_key: "stub-ping".into(),
                    description_key: "stub-ping-desc".into(),
                    params: vec![],
                }
            ])
        }
        fn dispatch(&self, command: &str, _args: Value, _ctx: &VaultContext<'_>) -> DispatchResult {
            match command {
                "ping" => Ok(serde_json::json!("pong")),
                _ => Err(format!("Unknown command: {command}")),
            }
        }
    }

    struct EmittingModule { info: ModuleInfo }

    impl Module for EmittingModule {
        fn info(&self) -> &ModuleInfo { &self.info }
        fn on_vault_open(&self, ctx: &VaultContext<'_>) -> Result<(), String> {
            ctx.events.emit(ModuleEvent::FileCreated { path: "test.md".into() });
            Ok(())
        }
    }

    struct FailingModule { info: ModuleInfo }

    impl Module for FailingModule {
        fn info(&self) -> &ModuleInfo { &self.info }
        fn on_vault_open(&self, _: &VaultContext<'_>) -> Result<(), String> {
            Err("intentional failure".into())
        }
    }

    struct NetworkModule { info: ModuleInfo }

    impl Module for NetworkModule {
        fn info(&self) -> &ModuleInfo { &self.info }
        fn capabilities(&self) -> &[Capability] { &[Capability::Network] }
    }

    fn make_stub(id: &str) -> (StubModule, Arc<AtomicBool>, Arc<AtomicBool>, Arc<AtomicUsize>) {
        let opened = Arc::new(AtomicBool::new(false));
        let closed = Arc::new(AtomicBool::new(false));
        let events = Arc::new(AtomicUsize::new(0));
        (StubModule::new(id, opened.clone(), closed.clone(), events.clone()), opened, closed, events)
    }

    fn stub_info(id: &str) -> ModuleInfo {
        ModuleInfo { id: id.into(), name: "X".into(), version: "0.1.0".into(), description: "".into() }
    }

    fn temp_dir() -> std::path::PathBuf {
        std::env::temp_dir().join("ruas_module_test")
    }

    // ── Lifecycle tests ────────────────────────────────────────────────

    #[test]
    fn registry_dispatches_vault_open() {
        let (stub, opened, _, events) = make_stub("test.a");
        let mut registry = ModuleRegistry::new();
        registry.register(stub);

        let errors = registry.on_vault_open(&temp_dir());

        assert!(errors.is_empty());
        assert!(opened.load(Ordering::SeqCst));
        // VaultOpened event is broadcast after on_vault_open
        assert!(events.load(Ordering::SeqCst) >= 1, "VaultOpened must be received");
    }

    #[test]
    fn registry_dispatches_vault_close() {
        let (stub, _, closed, events) = make_stub("test.b");
        let mut registry = ModuleRegistry::new();
        registry.register(stub);

        registry.on_vault_close(&temp_dir());

        assert!(closed.load(Ordering::SeqCst));
        assert!(events.load(Ordering::SeqCst) >= 1, "VaultClosed must be received");
    }

    #[test]
    fn failing_module_does_not_abort_others() {
        let mut registry = ModuleRegistry::new();
        registry.register(FailingModule { info: stub_info("test.fail") });
        let (stub, opened, _, _) = make_stub("test.after");
        registry.register(stub);

        let errors = registry.on_vault_open(&temp_dir());
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].0, "test.fail");
        assert!(opened.load(Ordering::SeqCst), "module after failing one must still run");
    }

    // ── Event emission tests (Point 3) ─────────────────────────────────

    #[test]
    fn emitted_events_are_routed_after_hook() {
        let mut registry = ModuleRegistry::new();
        registry.register(EmittingModule { info: stub_info("test.emitter") });
        let (stub, _, _, events) = make_stub("test.receiver");
        registry.register(stub);

        let errors = registry.on_vault_open(&temp_dir());
        assert!(errors.is_empty());
        // receiver gets FileCreated + VaultOpened = at least 2 events
        assert!(events.load(Ordering::SeqCst) >= 2);
    }

    // ── Capability enforcement tests (Point 4) ─────────────────────────

    #[test]
    fn core_module_passes_capability_check() {
        let (stub, opened, _, _) = make_stub("test.core");
        let mut registry = ModuleRegistry::new();
        registry.register(stub); // registered as Core → all capabilities approved

        let errors = registry.on_vault_open(&temp_dir());
        assert!(errors.is_empty());
        assert!(opened.load(Ordering::SeqCst));
    }

    #[test]
    fn plugin_with_unapproved_capability_is_blocked() {
        let mut registry = ModuleRegistry::new();
        // Register as Plugin with no approved capabilities
        let net = NetworkModule { info: stub_info("test.network-plugin") };
        let approved = vec![]; // nothing approved
        registry.entries.push(RegistryEntry {
            module: Box::new(net),
            trust: TrustLevel::Plugin,
            approved,
        });

        let errors = registry.on_vault_open(&temp_dir());
        assert!(!errors.is_empty(), "unapproved capability must produce an error");
        assert!(errors[0].1.contains("not approved"));
    }

    #[test]
    fn plugin_with_approved_capability_passes() {
        let (stub, opened, _, _) = make_stub("test.approved-plugin");
        let approved = stub.capabilities().to_vec();
        let mut registry = ModuleRegistry::new();
        registry.entries.push(RegistryEntry {
            module: Box::new(stub),
            trust: TrustLevel::Plugin,
            approved,
        });

        let errors = registry.on_vault_open(&temp_dir());
        assert!(errors.is_empty());
        assert!(opened.load(Ordering::SeqCst));
    }

    // ── Command dispatch tests (Point 1) ───────────────────────────────

    #[test]
    fn dispatch_routes_to_correct_module() {
        let (stub, _, _, _) = make_stub("test.dispatch");
        let mut registry = ModuleRegistry::new();
        registry.register(stub);

        let result = registry.dispatch("test.dispatch", "ping", serde_json::json!({}), &temp_dir());
        assert_eq!(result.unwrap(), serde_json::json!("pong"));
    }

    #[test]
    fn dispatch_returns_error_for_unknown_module() {
        let registry = ModuleRegistry::new();
        let result = registry.dispatch("no.such.module", "cmd", serde_json::json!({}), &temp_dir());
        assert!(result.is_err());
    }

    #[test]
    fn dispatch_returns_error_for_unknown_command() {
        let (stub, _, _, _) = make_stub("test.cmds");
        let mut registry = ModuleRegistry::new();
        registry.register(stub);

        let result = registry.dispatch("test.cmds", "nonexistent", serde_json::json!({}), &temp_dir());
        assert!(result.is_err());
    }

    // ── Settings tests (Point 2) ───────────────────────────────────────

    #[test]
    fn module_settings_round_trip() {
        let dir = temp_dir().join("settings_test");
        std::fs::create_dir_all(&dir).unwrap();
        let settings = ModuleSettings::for_module(&dir, "test.settings");

        // Empty before first write
        assert_eq!(settings.get("key"), None);

        settings.set("key", serde_json::json!("value")).unwrap();
        assert_eq!(settings.get("key").unwrap(), serde_json::json!("value"));

        let all = settings.get_all();
        assert_eq!(all["key"], "value");

        // Cleanup
        std::fs::remove_dir_all(&dir).ok();
    }

    // ── Misc ───────────────────────────────────────────────────────────

    #[test]
    fn registry_lookup_by_id() {
        let (stub, _, _, _) = make_stub("ruas.contacts");
        let mut registry = ModuleRegistry::new();
        registry.register(stub);

        assert!(registry.get("ruas.contacts").is_some());
        assert!(registry.get("nonexistent").is_none());
        assert_eq!(registry.entries().len(), 1);
    }

    #[test]
    fn version_ordering_and_display() {
        assert!(Version::new(1, 0, 0) > Version::new(0, 9, 9));
        assert!(Version::new(0, 2, 0) > Version::new(0, 1, 9));
        assert_eq!(Version::new(1, 2, 3), Version::new(1, 2, 3));
        assert_eq!(Version::new(1, 2, 3).to_string(), "1.2.3");
    }

    #[test]
    fn contacts_module_schema() {
        use crate::contacts::ContactsModule;
        let m = ContactsModule::default();
        assert_eq!(m.info().id, "ruas.contacts");
        assert!(m.capabilities().contains(&Capability::VaultRead));
        assert!(m.capabilities().contains(&Capability::VaultWrite));
        assert!(!m.commands().is_empty(), "contacts must declare commands");
        assert!(m.commands().iter().any(|c| c.name == "list"));
        assert!(m.commands().iter().any(|c| c.name == "create"));
    }
}
