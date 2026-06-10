pub mod appearance;
pub mod contacts;
pub mod filename;
pub mod index;
pub mod module;
pub mod notes;
pub mod plugin;
pub mod vault;

pub use appearance::{
    AppearanceConfig, AppearanceFile, AppearanceList,
    list_appearance, read_appearance_css, read_config as read_appearance_config,
    sanitize_user_css, write_config as write_appearance_config,
};

pub use contacts::{
    Contact, ContactAddress, ContactEmail, ContactFrontmatter, ContactMeta, ContactPhone,
    ContactTreeNode, ContactsModule, build_contacts_tree, contact_to_meta, parse_contact, serialize_contact,
};
pub use notes::{
    BacklinkMeta, BlockMeta, Note, NoteFrontmatter, NoteMeta, NoteTreeNode, NotesModule,
    build_notes_tree, ensure_block_ids, find_backlinks_in_dir, list_blocks, note_to_meta,
    parse_note, search_notes_in_dir, serialize_note,
};
pub use module::{
    // Core trait and registry
    Module, ModuleInfo, ModuleRegistry, RegistryEntry, VaultContext, Version,
    // Capability enforcement (Point 4)
    Capability, TrustLevel,
    // Command registration (Point 1)
    CommandDescriptor, DispatchResult, ParamDescriptor, ParamKind,
    // Event system (Point 3)
    EventSink, ModuleEvent, NoopSink,
    // Settings API (Point 2)
    ModuleSettings, SelectOption, SettingField, SettingKind,
};
pub use filename::{sanitize_filename, unique_filename};
pub use index::{IndexManager, SearchResult};
pub use vault::{VaultConfig, create_vault, validate_vault};
