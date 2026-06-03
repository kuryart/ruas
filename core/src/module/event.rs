/// Events broadcast across the module system.
///
/// Marked `#[non_exhaustive]` so adding variants never breaks dependent code —
/// existing `match` arms just need a `_ => {}` wildcard.
#[non_exhaustive]
#[derive(Debug, Clone)]
pub enum ModuleEvent {
    // ── Lifecycle ──────────────────────────────────────────────────────
    /// All modules have received `on_vault_open` successfully.
    VaultOpened,
    /// The vault is about to be released.
    VaultClosed,

    // ── File system ────────────────────────────────────────────────────
    FileCreated { path: String },
    FileModified { path: String },
    FileDeleted { path: String },

    // ── Contacts ───────────────────────────────────────────────────────
    /// A contact was created or updated (identified by its UID).
    ContactSaved { uid: String },
    /// A contact was permanently deleted.
    ContactDeleted { uid: String },

    // ── Notes ──────────────────────────────────────────────────────────────────
    /// A note was created or updated (identified by its UID).
    NoteSaved { uid: String },
    /// A note was permanently deleted.
    NoteDeleted { uid: String },
}

// ── EventSink ─────────────────────────────────────────────────────────────

/// Allows a module to emit events from inside a lifecycle hook or dispatch.
///
/// The registry collects emitted events and routes them to all modules
/// **after** the originating hook completes, preventing re-entrancy.
pub trait EventSink: Send + Sync {
    fn emit(&self, event: ModuleEvent);
}

// ── Implementations ────────────────────────────────────────────────────────

/// No-op sink — for tests and contexts where events are intentionally ignored.
pub struct NoopSink;

impl EventSink for NoopSink {
    fn emit(&self, _: ModuleEvent) {}
}

/// Buffered sink — used by `ModuleRegistry` to collect events for deferred dispatch.
pub(crate) struct BufferedSink {
    pending: std::sync::Mutex<Vec<ModuleEvent>>,
}

impl BufferedSink {
    pub fn new() -> Self {
        Self { pending: std::sync::Mutex::new(Vec::new()) }
    }

    /// Drain all collected events, leaving the buffer empty.
    pub fn drain(&self) -> Vec<ModuleEvent> {
        std::mem::take(&mut self.pending.lock().unwrap())
    }
}

impl EventSink for BufferedSink {
    fn emit(&self, event: ModuleEvent) {
        self.pending.lock().unwrap().push(event);
    }
}
