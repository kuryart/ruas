/// Resources a module is allowed to access.
///
/// Declared upfront in `Module::capabilities()`; the runtime verifies them
/// before calling any lifecycle hook or dispatch. Undeclared capabilities
/// are denied — modules can only do what they advertise.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
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
/// `Core` modules (built-ins) have all declared capabilities implicitly
/// granted. `Plugin` modules start with no approvals; each capability
/// that requires user consent is added individually.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TrustLevel {
    /// Built-in module — all declared capabilities are pre-approved.
    Core,
    /// User-installed plugin — capabilities are individually approved.
    Plugin,
}
