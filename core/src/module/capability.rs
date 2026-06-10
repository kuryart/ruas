/// Resources a module is allowed to access.
///
/// Declared upfront in `Module::capabilities()`; the runtime verifies them
/// before calling any lifecycle hook or dispatch. Undeclared capabilities
/// are denied — modules can only do what they advertise.
#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum Capability {
    /// Read `.md` files and vault metadata
    VaultRead,
    /// Write `.md` files and vault metadata
    VaultWrite,
    /// Query the SQLite full-text-search index (read-only)
    IndexRead,
    /// Rebuild or modify the SQLite index
    IndexWrite,
    /// Read data published by another module
    CrossModuleRead,
    /// Outbound network access — always requires explicit user approval
    Network,
}

/// Trust level assigned at registration time.
///
/// `Core` modules (built-ins like contacts, notes) have all declared
/// capabilities implicitly granted and can never be disabled.
///
/// `Native` modules are shipped with the app (`plugins/` directory),
/// have all declared capabilities pre-approved, but **can** be disabled
/// by the user.
///
/// `Plugin` modules are user-installed via the marketplace; each
/// capability requires explicit user approval before the plugin can
/// dispatch commands that require it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum TrustLevel {
    /// Built-in, always enabled, all caps pre-approved.
    Core,
    /// Shipped with the app, can be disabled, all caps pre-approved.
    Native,
    /// User-installed plugin — capabilities are individually approved.
    Plugin,
}
