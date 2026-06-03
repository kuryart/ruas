use serde_json::Value;

/// Outcome of a dispatched command — always JSON to remain backend-agnostic.
/// Tauri commands and HTTP handlers deserialise the value into concrete types.
pub type DispatchResult = Result<Value, String>;

/// Metadata for a single command exposed by a module.
///
/// Used by the UI to build menus, help text, and future plugin manifests.
/// The runtime does not enforce the schema — validation is the module's job.
#[derive(Debug, Clone)]
pub struct CommandDescriptor {
    /// Snake_case machine name, unique within the module.
    /// e.g. "list", "create", "import_carddav"
    pub name: String,
    /// i18n key for a short label shown in UI.
    pub label_key: String,
    /// i18n key for a longer description.
    pub description_key: String,
    /// Declared parameters (informational — not enforced by the runtime).
    pub params: Vec<ParamDescriptor>,
}

/// Describes one parameter of a command.
#[derive(Debug, Clone)]
pub struct ParamDescriptor {
    pub name: String,
    pub kind: ParamKind,
    pub required: bool,
    /// i18n key for description shown in UI / documentation.
    pub description_key: String,
}

/// Primitive type of a command parameter.
#[derive(Debug, Clone)]
pub enum ParamKind {
    String,
    Number,
    Boolean,
    /// Arbitrary JSON object (for complex types like `Contact`)
    Json,
}
