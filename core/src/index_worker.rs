// ── Async index worker ─────────────────────────────────────────────────────
///
/// The worker sits between libSQL (write-side, ACID) and Tantivy (read-side,
/// FTS). It receives wake-up signals via an mpsc channel, drains the outbox
/// table in batches, performs Pop & Mutate ingestion (§4.2), and updates
/// Tantivy. Crash recovery: on spawn, it drains the entire outbox before
/// entering the reactive loop.
///
/// ## Lifecycle
/// 1. **Spawn** (`IndexWorker::spawn`) — drain pending outbox (crash recovery).
/// 2. **Loop** — block on `rx.recv()` → drain outbox → process → ack.
/// 3. **Shutdown** — drop the sender; the receiver returns `None` and the
///    worker exits gracefully after flushing its last batch.
///
/// ## Pop & Mutate (§4.2)
/// Before indexing into Tantivy, the worker reads the file from disk, parses
/// the YAML frontmatter:
///   - Extract `tags` and `aliases` into their dedicated Tantivy fields.
///   - Remove those keys from the frontmatter object.
///   - Serialize the rest as JSON for the `fm` field.
/// This prevents double-dipping: the same data never scores twice in BM25.
use crate::index::IndexManager;
use crate::tantivy_index::TantivyManager;
use std::path::Path;
use std::sync::Arc;
use tantivy::{IndexWriter, TantivyDocument, Term};
use tokio::sync::mpsc;

/// Wake-up signal sent after every libSQL commit that touches the outbox.
pub type WakeSignal = mpsc::UnboundedSender<()>;
pub type WakeReceiver = mpsc::UnboundedReceiver<()>;

pub struct IndexWorker {
    rx: WakeReceiver,
    index: Arc<IndexManager>,
    tantivy: Arc<TantivyManager>,
}

impl IndexWorker {
    /// Create the channel pair and spawn the worker on a tokio task.
    /// Returns the `WakeSignal` sender — store it where `IndexManager` can
    /// reach it (e.g. `ModuleRegistry`).
    pub fn spawn(
        index: Arc<IndexManager>,
        tantivy: Arc<TantivyManager>,
    ) -> WakeSignal {
        let (tx, rx) = mpsc::unbounded_channel();
        let worker = Self { rx, index, tantivy };

        // Spawn a dedicated OS thread with its own Tokio runtime.
        // Tauri's main thread does not have a Tokio runtime active,
        // so `tokio::task::spawn` would panic. A std thread gives us
        // an isolated, long-lived runtime for the worker loop.
        std::thread::Builder::new()
            .name("ruas-index-worker".into())
            .spawn(move || {
                // Multi-thread runtime is required because IndexManager's
                // block_on() uses tokio::task::block_in_place, which only
                // works on the multi-threaded scheduler.
                let rt = tokio::runtime::Runtime::new()
                    .expect("[index-worker] Failed to build Tokio runtime");
                rt.block_on(async move {
                    worker.run().await;
                });
            })
            .expect("[index-worker] Failed to spawn worker thread");

        tx
    }

    // ── Main loop ──────────────────────────────────────────────────────

    async fn run(mut self) {
        log::info!("[index-worker] Starting — draining outbox for crash recovery...");

        // ── Crash recovery: drain everything ───────────────────────────
        if let Err(e) = self.drain_and_process(usize::MAX).await {
            log::error!("[index-worker] Crash recovery failed: {e}");
        }

        log::info!("[index-worker] Crash recovery complete. Entering reactive loop.");

        // ── Reactive loop ──────────────────────────────────────────────
        loop {
            match self.rx.recv().await {
                Some(()) => {
                    // Wake-up: a libSQL commit happened. Drain outbox.
                    if let Err(e) = self.drain_and_process(256).await {
                        log::error!("[index-worker] Batch processing error: {e}");
                    }
                }
                None => {
                    // All senders dropped — shutdown.
                    log::info!("[index-worker] Channel closed. Draining final batch...");
                    let _ = self.drain_and_process(usize::MAX).await;
                    log::info!("[index-worker] Shutdown complete.");
                    return;
                }
            }
        }
    }

    /// Drain up to `limit` entries from the outbox and process them in a
    /// single Tantivy commit — avoids one-segment-per-document blow-up.
    async fn drain_and_process(&self, limit: usize) -> Result<(), String> {
        let entries = self.index.drain_outbox(limit)?;
        if entries.is_empty() {
            return Ok(());
        }

        log::info!("[index-worker] Processing {} outbox entries", entries.len());

        // Open a single writer for the entire batch. Each entry adds to
        // the writer without committing, then we commit once at the end.
        // This produces one merged segment instead of N tiny ones.
        let mut writer = self.tantivy.writer(200)?;

        let mut acked: Vec<i64> = Vec::with_capacity(entries.len());

        for entry in &entries {
            match entry.action.as_str() {
                "upsert" => {
                    if let Err(e) = self.write_upsert(&mut writer, &entry.path, &entry.entity) {
                        log::warn!("[index-worker] Failed to index {}: {e}", entry.path);
                        continue; // don't ack → retry next cycle
                    }
                }
                "delete" => {
                    writer.delete_term(tantivy::Term::from_field_text(
                        self.tantivy.fields().path,
                        &entry.path,
                    ));
                }
                other => {
                    log::warn!("[index-worker] Unknown outbox action: {other}");
                    continue;
                }
            }
            acked.push(entry.id);
        }

        // Single commit for the entire batch.
        writer
            .commit()
            .map(|_| ())
            .map_err(|e| format!("tantivy batch commit: {e}"))?;

        // Ack all successfully processed entries.
        for id in &acked {
            self.index.delete_outbox(*id)?;
        }

        Ok(())
    }

    /// Prepare the document and add it to the writer (no commit).
    fn write_upsert(
        &self,
        writer: &mut tantivy::IndexWriter,
        path: &str,
        entity: &str,
    ) -> Result<(), String> {
        let disk_path = Path::new(path);
        let content = std::fs::read_to_string(disk_path)
            .map_err(|e| format!("read file: {e}"))?;

        let (title, aliases, tags, fm_json, body) = pop_and_mutate(&content)?;

        let fields = self.tantivy.fields();

        // Delete old version first (idempotent upsert).
        writer.delete_term(tantivy::Term::from_field_text(fields.path, path));

        let mut doc = tantivy::TantivyDocument::new();
        if let Some(v) = extract_uid(&content) {
            doc.add_text(fields.uid, &v);
        }
        doc.add_text(fields.path, path);
        doc.add_text(fields.entity, entity);
        if let Some(ref v) = title { if !v.is_empty() { doc.add_text(fields.title, v); } }
        if let Some(ref v) = aliases { if !v.is_empty() { doc.add_text(fields.aliases, v); } }
        if let Some(ref v) = tags { if !v.is_empty() { doc.add_text(fields.tags, v); } }
        if let Some(ref v) = fm_json { if !v.is_empty() { doc.add_text(fields.fm, v); } }
        doc.add_text(fields.body, &body);

        writer
            .add_document(doc)
            .map_err(|e| format!("tantivy: add_document: {e}"))?;

        Ok(())
    }
}

// ── Pop & Mutate (§4.2) ────────────────────────────────────────────────────

/// Parse YAML frontmatter, extract `tags` and `aliases`, serialize the rest
/// as JSON. Returns `(title, aliases_str, tags_str, fm_json, body)`.
fn pop_and_mutate(
    content: &str,
) -> Result<(Option<String>, Option<String>, Option<String>, Option<String>, String), String> {
    let (mut map, body) = split_yaml_frontmatter(content)?;

    let title = map
        .remove("title")
        .and_then(|v| v.as_str().map(String::from));

    let aliases = map.remove("aliases").map(|v| match v {
        serde_yaml::Value::String(s) => s,
        serde_yaml::Value::Sequence(seq) => seq
            .iter()
            .filter_map(|item| item.as_str())
            .collect::<Vec<&str>>()
            .join(", "),
        other => serde_yaml::to_string(&other).unwrap_or_default(),
    });

    let tags = map.remove("tags").map(|v| match v {
        serde_yaml::Value::String(s) => s,
        serde_yaml::Value::Sequence(seq) => seq
            .iter()
            .filter_map(|item| item.as_str())
            .collect::<Vec<&str>>()
            .join(", "),
        other => serde_yaml::to_string(&other).unwrap_or_default(),
    });

    // Serialize the remaining frontmatter as JSON (the "rest").
    let fm_json = if map.is_empty() {
        None
    } else {
        Some(
            serde_json::to_string(&map)
                .map_err(|e| format!("fm json: {e}"))?,
        )
    };

    Ok((title, aliases, tags, fm_json, body))
}

/// Split `---\nYAML\n---\n\nbody` into a `serde_yaml::Mapping` and body text.
fn split_yaml_frontmatter(
    content: &str,
) -> Result<(serde_yaml::Mapping, String), String> {
    let s = content.trim_start();
    if !s.starts_with("---") {
        return Ok((serde_yaml::Mapping::new(), content.to_string()));
    }
    let rest = &s[3..];
    let end = rest
        .find("\n---")
        .ok_or("Unclosed frontmatter".to_string())?;
    let yaml_str = &rest[..end];
    let body = rest[end + 4..]
        .trim_start_matches('\n')
        .trim_start_matches('\r')
        .to_string();

    let value: serde_yaml::Value = serde_yaml::from_str(yaml_str)
        .map_err(|e| format!("YAML parse error: {e}"))?;

    let map = match value {
        serde_yaml::Value::Mapping(m) => m,
        _ => serde_yaml::Mapping::new(),
    };

    Ok((map, body))
}

/// Extract the `uid` from YAML frontmatter (without full parse if possible).
fn extract_uid(content: &str) -> Option<String> {
    let (map, _) = split_yaml_frontmatter(content).ok()?;
    map.get("uid")
        .and_then(|v| v.as_str())
        .map(String::from)
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pop_and_mutate_extracts_tags_and_aliases() {
        let content = "---\ntitle: Test Note\ntags:\n  - rust\n  - tantivy\naliases:\n  - testing\nstatus: draft\n---\n\nBody text.";
        let (title, aliases, tags, fm_json, body) = pop_and_mutate(content).unwrap();

        assert_eq!(title.as_deref(), Some("Test Note"));
        assert_eq!(tags.as_deref(), Some("rust, tantivy"));
        assert_eq!(aliases.as_deref(), Some("testing"));
        assert_eq!(body, "Body text.");

        // fm_json must NOT contain "tags" or "aliases"
        let fm: serde_json::Value = serde_json::from_str(fm_json.as_deref().unwrap()).unwrap();
        assert!(fm.get("tags").is_none(), "tags must be popped from fm");
        assert!(fm.get("aliases").is_none(), "aliases must be popped from fm");
        assert_eq!(fm.get("status").and_then(|v| v.as_str()), Some("draft"));
    }

    #[test]
    fn pop_and_mutate_no_frontmatter() {
        let content = "Just plain body.";
        let (title, aliases, tags, fm_json, body) = pop_and_mutate(content).unwrap();
        assert!(title.is_none());
        assert!(aliases.is_none());
        assert!(tags.is_none());
        assert!(fm_json.is_none());
        assert_eq!(body, "Just plain body.");
    }

    #[test]
    fn pop_and_mutate_string_tags() {
        let content = "---\ntags: rust, tauri\n---\n\nContent.";
        let (_, _, tags, _, _) = pop_and_mutate(content).unwrap();
        assert_eq!(tags.as_deref(), Some("rust, tauri"));
    }
}
