/// libSQL-backed index for the vault.
///
/// The file system (`.md` files) is the **source of truth**. The index is a
/// read/search cache derived from those files — it can always be rebuilt.
///
/// Responsibilities:
/// - FTS5 full-text search across all module content
/// - UUID → disk path resolution (for `ruas://` links)
/// - Per-entity metadata for listing without scanning files
///
/// Internally wraps `libsql::Database`; each method acquires a fresh
/// `Connection` via `db.connect()` and bridges async → sync with
/// `tokio::runtime::Handle::current().block_on()`.
use libsql::params;
use serde::{Deserialize, Serialize};
use std::path::Path;

use std::sync::Arc;
use chrono::Utc;

// ── Public types ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub path: String,
    pub uid: Option<String>,
    /// Module entity type: "contact", "note", "agenda", etc.
    pub entity: String,
    pub title: Option<String>,
    /// Short excerpt with matching terms highlighted by `<b>` tags.
    pub snippet: String,
    pub rank: f64,
    /// Raw BM25 score from Tantivy (higher = more text-relevant).
    /// Used as input to the smart scorer.
    pub bm25_score: f64,
    /// Final combined score (BM25 × Frecency × Time × Context).
    pub final_score: f64,
}

/// Entries consumed by the index worker from the outbox table.
#[derive(Debug, Clone)]
pub struct OutboxEntry {
    pub id: i64,
    pub path: String,
    pub entity: String,
    pub action: String,
}

// ── IndexManager ───────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct IndexManager {
    db: Arc<libsql::Database>,
}

impl IndexManager {
    /// Open (or create) the index at `<vault>/.ruas/index.db`.
    /// Uses a temporary runtime if none is active (tests).
    pub fn open(vault_path: &Path) -> Result<Self, String> {
        let ruas_dir = vault_path.join(".ruas");
        std::fs::create_dir_all(&ruas_dir)
            .map_err(|e| format!("index: cannot create .ruas dir: {e}"))?;

        let db_path = ruas_dir.join("index.db");
        let db = block_on(async {
            libsql::Builder::new_local(&db_path)
                .build()
                .await
                .map_err(|e| format!("index: cannot open database: {e}"))
        })?;

        let idx = Self { db: Arc::new(db) };
        idx.migrate()?;
        Ok(idx)
    }

    // ── Schema ─────────────────────────────────────────────────────────

    fn migrate(&self) -> Result<(), String> {
        block_on(async {
            let conn = self.connect_async().await?;
            // PRAGMA journal_mode returns a result row — must use query, not execute
            conn.query("PRAGMA journal_mode = WAL", ())
                .await.map_err(|e| format!("index: journal_mode: {e}"))?;

            conn.execute_batch("
                PRAGMA foreign_keys = ON;
                PRAGMA synchronous  = NORMAL;

                CREATE TABLE IF NOT EXISTS files (
                    path       TEXT PRIMARY KEY,
                    uid        TEXT,
                    entity     TEXT NOT NULL,
                    title      TEXT,
                    indexed_at TEXT NOT NULL
                               DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                );

                CREATE UNIQUE INDEX IF NOT EXISTS idx_files_uid
                    ON files(uid) WHERE uid IS NOT NULL;

                -- unicode61 tokeniser with diacritic folding (á→a, ç→c, etc.)
                CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(
                    path    UNINDEXED,
                    entity  UNINDEXED,
                    title,
                    body,
                    tokenize = 'unicode61 remove_diacritics 1'
                );

                -- Outgoing wiki links, one row per (source note, link target).
                CREATE TABLE IF NOT EXISTS links (
                    source_path  TEXT NOT NULL,
                    source_title TEXT,
                    target_key   TEXT NOT NULL,
                    context      TEXT,
                    PRIMARY KEY (source_path, target_key)
                );
                CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_key);

                -- Outbox for async Tantivy indexing (CQRS write-ahead).
                CREATE TABLE IF NOT EXISTS outbox (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    path       TEXT NOT NULL,
                    entity     TEXT NOT NULL,
                    action     TEXT NOT NULL,
                    created_at TEXT NOT NULL
                               DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                );
            ").await
                .map_err(|e| format!("index: DDL migration failed: {e}"))?;

            // ── Best-effort column additions (existing vaults) ──────────
            // Ignore errors — if the column already exists we just move on.
            let _ = conn.execute(
                "ALTER TABLE files ADD COLUMN times_opened INTEGER NOT NULL DEFAULT 0",
                (),
            ).await;
            let _ = conn.execute(
                "ALTER TABLE files ADD COLUMN last_access TEXT",
                (),
            ).await;

            Ok::<_, String>(())
        })
    }

    // ── Write API ──────────────────────────────────────────────────────

    /// Index or re-index a single file.
    pub fn upsert(
        &self,
        path: &str,
        uid: Option<&str>,
        entity: &str,
        title: Option<&str>,
        body: &str,
    ) -> Result<(), String> {
        block_on(async {
            let conn = self.connect_async().await?;
            conn.execute(
                "INSERT INTO files (path, uid, entity, title)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(path) DO UPDATE SET
                   uid        = excluded.uid,
                   entity     = excluded.entity,
                   title      = excluded.title,
                   indexed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
                params![path, uid, entity, title],
            ).await.map_err(|e| format!("index: upsert files failed: {e}"))?;

            conn.execute("DELETE FROM fts WHERE path = ?1", params![path])
                .await.map_err(|e| format!("index: fts delete failed: {e}"))?;
            conn.execute(
                "INSERT INTO fts(path, entity, title, body) VALUES (?1, ?2, ?3, ?4)",
                params![path, entity, title.unwrap_or(""), body],
            ).await.map_err(|e| format!("index: fts insert failed: {e}"))?;

            // Enqueue for async Tantivy indexing.
            conn.execute(
                "INSERT INTO outbox (path, entity, action) VALUES (?1, ?2, 'upsert')",
                params![path, entity],
            ).await.map_err(|e| format!("index: outbox upsert: {e}"))?;

            Ok::<_, String>(())
        })
    }

    /// Remove a file from the index.
    pub fn remove(&self, path: &str) -> Result<(), String> {
        block_on(async {
            let conn = self.connect_async().await?;
            // Grab entity before deleting (for outbox entry).
            let entity: String = {
                let mut rows = conn.query(
                    "SELECT entity FROM files WHERE path = ?1",
                    params![path],
                ).await.map_err(|e| format!("index: entity lookup: {e}"))?;
                if let Ok(Some(row)) = rows.next().await {
                    row.get::<String>(0).unwrap_or_default()
                } else {
                    // Not indexed — nothing to delete.
                    return Ok(());
                }
            };

            conn.execute("DELETE FROM files WHERE path = ?1", params![path])
                .await.map_err(|e| format!("index: remove files: {e}"))?;
            conn.execute("DELETE FROM fts WHERE path = ?1", params![path])
                .await.map_err(|e| format!("index: remove fts: {e}"))?;
            conn.execute("DELETE FROM links WHERE source_path = ?1", params![path])
                .await.map_err(|e| format!("index: remove links: {e}"))?;

            // Enqueue for async Tantivy deletion.
            conn.execute(
                "INSERT INTO outbox (path, entity, action) VALUES (?1, ?2, 'delete')",
                params![path, entity.as_str()],
            ).await.map_err(|e| format!("index: outbox delete: {e}"))?;

            Ok::<_, String>(())
        })
    }

    /// Replace the set of outgoing links for a source note.
    pub fn set_links(
        &self,
        source_path: &str,
        source_title: Option<&str>,
        links: &[(String, String)],
    ) -> Result<(), String> {
        block_on(async {
            let conn = self.connect_async().await?;
            let tx = conn.transaction().await
                .map_err(|e| format!("index: links tx: {e}"))?;
            tx.execute("DELETE FROM links WHERE source_path = ?1", params![source_path])
                .await.map_err(|e| format!("index: links clear: {e}"))?;
            for (key, context) in links {
                tx.execute(
                    "INSERT OR REPLACE INTO links (source_path, source_title, target_key, context)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![source_path, source_title, key.as_str(), context.as_str()],
                ).await.map_err(|e| format!("index: links insert: {e}"))?;
            }
            tx.commit().await.map_err(|e| format!("index: links commit: {e}"))
        })
    }

    /// Atomically update the path key for a renamed file across all index tables.
    pub fn rename(&self, old_path: &str, new_path: &str) -> Result<(), String> {
        block_on(async {
            let conn = self.connect_async().await?;
            let tx = conn.transaction().await
                .map_err(|e| format!("index: rename tx: {e}"))?;
            tx.execute("UPDATE files SET path = ?2 WHERE path = ?1", params![old_path, new_path])
                .await.map_err(|e| format!("index: rename files: {e}"))?;
            tx.execute("UPDATE fts SET path = ?2 WHERE path = ?1", params![old_path, new_path])
                .await.map_err(|e| format!("index: rename fts: {e}"))?;
            tx.execute("UPDATE links SET source_path = ?2 WHERE source_path = ?1", params![old_path, new_path])
                .await.map_err(|e| format!("index: rename links: {e}"))?;
            tx.execute("UPDATE outbox SET path = ?2 WHERE path = ?1", params![old_path, new_path])
                .await.map_err(|e| format!("index: rename outbox: {e}"))?;
            tx.commit().await.map_err(|e| format!("index: rename commit: {e}"))
        })
    }

    /// Drop and rebuild the FTS index from the `files` table.
    pub fn rebuild_fts(&self) -> Result<(), String> {
        let conn = self.connect()?;
        block_on(async {
            conn.execute_batch("INSERT INTO fts(fts) VALUES('rebuild');").await
                .map_err(|e| format!("index: fts rebuild failed: {e}"))?;
            Ok::<_, String>(())
        })
    }

    /// Purge all index entries for a given entity type within a directory.
    pub fn purge_entity_dir(&self, dir: &str, entity: &str) -> Result<(), String> {
        let conn = self.connect()?;
        let pattern = format!("{}/%", dir.trim_end_matches('/'));
        block_on(async {
            conn.execute(
                "DELETE FROM fts WHERE path LIKE ?1 AND entity = ?2",
                params![pattern.as_str(), entity],
            ).await.map_err(|e| format!("index: purge entity fts: {e}"))?;
            conn.execute(
                "DELETE FROM files WHERE path LIKE ?1 AND entity = ?2",
                params![pattern.as_str(), entity],
            ).await.map_err(|e| format!("index: purge entity files: {e}"))?;
            Ok::<_, String>(())
        })
    }

    // ── Frecency tracking ──────────────────────────────────────────────

    /// Increment `times_opened` and set `last_access` for a file.
    /// Called as fire-and-forget when the user opens an entity.
    pub fn record_access(&self, path: &str) -> Result<(), String> {
        block_on(async {
            let conn = self.connect_async().await?;
            let now = Utc::now().to_rfc3339();
            conn.execute(
                "UPDATE files SET times_opened = times_opened + 1, last_access = ?1
                 WHERE path = ?2",
                params![now, path],
            ).await.map_err(|e| format!("index: record_access: {e}"))?;
            Ok::<_, String>(())
        })
    }

    /// Return `(times_opened, last_access, path)` for a batch of paths.
    /// Used by the smart scorer to compute Frecency.
    pub fn get_batch_stats(
        &self,
        paths: &[String],
    ) -> Result<Vec<(String, i64, Option<String>)>, String> {
        if paths.is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.connect()?;
        let placeholders: Vec<String> = paths.iter().map(|_| "?".to_string()).collect();
        let sql = format!(
            "SELECT path, times_opened, last_access FROM files WHERE path IN ({})",
            placeholders.join(",")
        );
        let params: Vec<libsql::Value> = paths.iter().map(|p| libsql::Value::from(p.as_str())).collect();

        block_on(async {
            let mut rows = conn.query(&sql, params)
                .await.map_err(|e| format!("index: get_batch_stats: {e}"))?;
            let mut stats = Vec::new();
            while let Ok(Some(row)) = rows.next().await {
                stats.push((
                    row.get::<String>(0).unwrap_or_default(),
                    row.get::<i64>(1).unwrap_or(0),
                    row.get::<Option<String>>(2).unwrap_or(None),
                ));
            }
            Ok(stats)
        })
    }

    /// Return the sum of all `times_opened` across the index.
    pub fn get_total_frecency(&self) -> Result<i64, String> {
        let conn = self.connect()?;
        block_on(async {
            let mut rows = conn.query(
                "SELECT COALESCE(SUM(times_opened), 0) FROM files",
                (),
            ).await.map_err(|e| format!("index: get_total_frecency: {e}"))?;
            if let Ok(Some(row)) = rows.next().await {
                Ok(row.get::<i64>(0).unwrap_or(0))
            } else {
                Ok(0)
            }
        })
    }

    /// Halve every `times_opened` value; zero out those that fall below 1.
    /// Part of the Zoxide-inspired aging mechanism (§5.3.1).
    pub fn halve_all_frecency(&self) -> Result<(), String> {
        block_on(async {
            let conn = self.connect_async().await?;
            conn.execute(
                "UPDATE files SET times_opened = times_opened / 2",
                (),
            ).await.map_err(|e| format!("index: halve_all_frecency: {e}"))?;
            conn.execute(
                "UPDATE files SET times_opened = 0 WHERE times_opened < 1",
                (),
            ).await.map_err(|e| format!("index: zero_low_frecency: {e}"))?;
            Ok::<_, String>(())
        })
    }

    // ── Outbox (async Tantivy indexing queue) ──────────────────────────

    /// Push a task into the outbox. Called internally by `upsert` / `remove`.
    pub fn enqueue(&self, path: &str, entity: &str, action: &str) -> Result<(), String> {
        block_on(async {
            let conn = self.connect_async().await?;
            conn.execute(
                "INSERT INTO outbox (path, entity, action) VALUES (?1, ?2, ?3)",
                params![path, entity, action],
            ).await.map_err(|e| format!("index: enqueue: {e}"))?;
            Ok::<_, String>(())
        })
    }

    /// Drain up to `limit` entries from the outbox (oldest first).
    pub fn drain_outbox(&self, limit: usize) -> Result<Vec<OutboxEntry>, String> {
        block_on(async {
            let conn = self.connect_async().await?;
            let mut rows = conn.query(
                "SELECT id, path, entity, action FROM outbox ORDER BY id ASC LIMIT ?1",
                params![limit as i64],
            ).await.map_err(|e| format!("index: drain_outbox: {e}"))?;

            let mut entries = Vec::new();
            while let Ok(Some(row)) = rows.next().await {
                entries.push(OutboxEntry {
                    id:     row.get::<i64>(0).unwrap_or(0),
                    path:   row.get::<String>(1).unwrap_or_default(),
                    entity: row.get::<String>(2).unwrap_or_default(),
                    action: row.get::<String>(3).unwrap_or_default(),
                });
            }
            Ok(entries)
        })
    }

    /// Acknowledge a processed outbox entry (delete it).
    pub fn delete_outbox(&self, id: i64) -> Result<(), String> {
        block_on(async {
            let conn = self.connect_async().await?;
            conn.execute("DELETE FROM outbox WHERE id = ?1", params![id])
                .await.map_err(|e| format!("index: delete_outbox: {e}"))?;
            Ok::<_, String>(())
        })
    }

    // ── Read API ───────────────────────────────────────────────────────

    /// Full-text search across all indexed entities.
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchResult>, String> {
        let conn = self.connect()?;
        block_on(async {
            let mut rows = conn.query(
                "SELECT f.path, f.uid, f.entity, f.title,
                        snippet(fts, -1, '<b>', '</b>', '…', 24) AS snip,
                        fts.rank
                 FROM fts
                 JOIN files f USING(path)
                 WHERE fts MATCH ?1
                 ORDER BY fts.rank
                 LIMIT ?2",
                params![query, limit as i64],
            ).await.map_err(|e| format!("index: search query: {e}"))?;

            let mut results = Vec::new();
            while let Ok(Some(row)) = rows.next().await {
                results.push(SearchResult {
                    path:    row.get::<String>(0).unwrap_or_default(),
                    uid:     row.get::<Option<String>>(1).unwrap_or(None),
                    entity:  row.get::<String>(2).unwrap_or_default(),
                    title:   row.get::<Option<String>>(3).unwrap_or(None),
                    snippet: row.get::<String>(4).unwrap_or_default(),
                    rank:    row.get::<f64>(5).unwrap_or(0.0),
                    bm25_score: 0.0,
                    final_score: 0.0,
                });
            }
            Ok(results)
        })
    }

    /// Full-text search restricted to a single entity type.
    pub fn search_entity(&self, query: &str, entity: &str, limit: usize) -> Result<Vec<SearchResult>, String> {
        let conn = self.connect()?;
        block_on(async {
            let mut rows = conn.query(
                "SELECT f.path, f.uid, f.entity, f.title,
                        snippet(fts, -1, '<b>', '</b>', '…', 24) AS snip,
                        fts.rank
                 FROM fts
                 JOIN files f USING(path)
                 WHERE fts MATCH ?1 AND f.entity = ?2
                 ORDER BY fts.rank
                 LIMIT ?3",
                params![query, entity, limit as i64],
            ).await.map_err(|e| format!("index: search_entity query: {e}"))?;

            let mut results = Vec::new();
            while let Ok(Some(row)) = rows.next().await {
                results.push(SearchResult {
                    path:    row.get::<String>(0).unwrap_or_default(),
                    uid:     row.get::<Option<String>>(1).unwrap_or(None),
                    entity:  row.get::<String>(2).unwrap_or_default(),
                    title:   row.get::<Option<String>>(3).unwrap_or(None),
                    snippet: row.get::<String>(4).unwrap_or_default(),
                    rank:    row.get::<f64>(5).unwrap_or(0.0),
                    bm25_score: 0.0,
                    final_score: 0.0,
                });
            }
            Ok(results)
        })
    }

    /// Notes that link to any of `target_keys`.
    pub fn backlinks(&self, target_keys: &[String]) -> Result<Vec<(String, Option<String>, String)>, String> {
        if target_keys.is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.connect()?;
        let placeholders: Vec<String> = target_keys.iter().map(|_| "?".to_string()).collect();
        let sql = format!(
            "SELECT DISTINCT source_path, source_title, context
             FROM links WHERE target_key IN ({})
             ORDER BY source_title COLLATE NOCASE",
            placeholders.join(",")
        );

        // Build params as Vec<libsql::Value>
        let params: Vec<libsql::Value> = target_keys.iter().map(|k| libsql::Value::from(k.as_str())).collect();

        block_on(async {
            let mut rows = conn.query(&sql, params)
                .await.map_err(|e| format!("index: backlinks query: {e}"))?;

            let mut results = Vec::new();
            while let Ok(Some(row)) = rows.next().await {
                results.push((
                    row.get::<String>(0).unwrap_or_default(),
                    row.get::<Option<String>>(1).unwrap_or(None),
                    row.get::<Option<String>>(2).unwrap_or(None).unwrap_or_default(),
                ));
            }
            Ok(results)
        })
    }

    /// Resolve a `ruas://` UID to its current file path.
    pub fn path_for_uid(&self, uid: &str) -> Result<Option<String>, String> {
        let conn = self.connect()?;
        block_on(async {
            let mut rows = conn.query(
                "SELECT path FROM files WHERE uid = ?1",
                params![uid],
            ).await.map_err(|e| format!("index: uid lookup failed: {e}"))?;

            if let Ok(Some(row)) = rows.next().await {
                Ok(Some(row.get::<String>(0).unwrap_or_default()))
            } else {
                Ok(None)
            }
        })
    }

    /// Number of indexed documents.
    pub fn count(&self) -> Result<usize, String> {
        let conn = self.connect()?;
        block_on(async {
            let mut rows = conn.query("SELECT COUNT(*) FROM files", ())
                .await.map_err(|e| format!("index: count failed: {e}"))?;
            if let Ok(Some(row)) = rows.next().await {
                Ok(row.get::<i64>(0).unwrap_or(0) as usize)
            } else {
                Ok(0)
            }
        })
    }

    // ── Internal ───────────────────────────────────────────────────────

    fn connect(&self) -> Result<libsql::Connection, String> {
        // Using `core` feature: local file-based connection is cheap and cloneable
        Ok(self.db.connect().map_err(|e| format!("index: connect: {e}"))?)
    }

    /// Open a connection and set `busy_timeout` so that concurrent writers
    /// (main thread + index worker) don't collide with SQLITE_BUSY.
    async fn connect_async(&self) -> Result<libsql::Connection, String> {
        let conn = self.db.connect().map_err(|e| format!("index: connect: {e}"))?;
        // PRAGMA busy_timeout returns a result row — must use query, not execute.
        conn.query("PRAGMA busy_timeout = 5000", ())
            .await
            .map_err(|e| format!("index: busy_timeout: {e}"))?;
        Ok(conn)
    }
}

// ── Sync ↔ async bridge ──────────────────────────────────────────────────

fn block_on<F: std::future::Future>(f: F) -> F::Output {
    match tokio::runtime::Handle::try_current() {
        Ok(h) => {
            // When inside an existing Tokio runtime (e.g. the index worker
            // thread), the current task must be moved off the worker before
            // blocking — otherwise handle.block_on() panics.
            tokio::task::block_in_place(|| h.block_on(f))
        }
        Err(_) => {
            let rt = tokio::runtime::Runtime::new()
                .expect("index: failed to create temporary tokio runtime");
            rt.block_on(f)
        }
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_index() -> IndexManager {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let _guard = rt.enter();
        let db = rt.block_on(async {
            libsql::Builder::new_local(":memory:").build().await.unwrap()
        });
        let idx = IndexManager { db: Arc::new(db) };
        idx.migrate().unwrap();
        idx
    }

    #[test]
    fn upsert_and_search() {
        let idx = temp_index();
        idx.upsert("/vault/contacts/a.md", Some("uid-1"), "contact", Some("Ana Silva"), "notas da ana").unwrap();
        idx.upsert("/vault/contacts/b.md", Some("uid-2"), "contact", Some("Bruno Costa"), "notas do bruno").unwrap();

        let results = idx.search("ana", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title.as_deref(), Some("Ana Silva"));
    }

    #[test]
    fn upsert_overwrites_existing() {
        let idx = temp_index();
        idx.upsert("/vault/contacts/a.md", Some("uid-1"), "contact", Some("Ana"), "v1").unwrap();
        idx.upsert("/vault/contacts/a.md", Some("uid-1"), "contact", Some("Ana Silva"), "v2").unwrap();

        let results = idx.search("Silva", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(idx.count().unwrap(), 1);
    }

    #[test]
    fn remove_clears_entry() {
        let idx = temp_index();
        idx.upsert("/vault/contacts/a.md", Some("uid-1"), "contact", Some("Ana"), "texto").unwrap();
        idx.remove("/vault/contacts/a.md").unwrap();

        assert_eq!(idx.count().unwrap(), 0);
        assert!(idx.search("Ana", 10).unwrap().is_empty());
    }

    #[test]
    fn uid_lookup() {
        let idx = temp_index();
        idx.upsert("/vault/contacts/a.md", Some("uid-abc"), "contact", None, "").unwrap();

        assert_eq!(idx.path_for_uid("uid-abc").unwrap().as_deref(), Some("/vault/contacts/a.md"));
        assert!(idx.path_for_uid("nonexistent").unwrap().is_none());
    }

    #[test]
    fn search_entity_filters_by_type() {
        let idx = temp_index();
        idx.upsert("/v/notes/a.md", Some("n1"), "note", Some("Rust notes"), "about rust").unwrap();
        idx.upsert("/v/contacts/b.md", Some("c1"), "contact", Some("Rust Fan"), "likes rust").unwrap();

        let notes = idx.search_entity("rust*", "note", 10).unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].title.as_deref(), Some("Rust notes"));
    }

    #[test]
    fn links_and_backlinks() {
        let idx = temp_index();
        idx.upsert("/v/notes/a.md", Some("n1"), "note", Some("Source"), "links [[Target]]").unwrap();
        idx.set_links("/v/notes/a.md", Some("Source"), &[("target".into(), "links [[Target]]".into())]).unwrap();

        let back = idx.backlinks(&["target".into()]).unwrap();
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].0, "/v/notes/a.md");
        assert_eq!(back[0].1.as_deref(), Some("Source"));

        idx.set_links("/v/notes/a.md", Some("Source"), &[("other".into(), "ctx".into())]).unwrap();
        assert!(idx.backlinks(&["target".into()]).unwrap().is_empty());
        assert_eq!(idx.backlinks(&["other".into()]).unwrap().len(), 1);

        idx.remove("/v/notes/a.md").unwrap();
        assert!(idx.backlinks(&["other".into()]).unwrap().is_empty());
    }

    #[test]
    fn diacritic_folding_search() {
        let idx = temp_index();
        idx.upsert("/vault/contacts/c.md", Some("uid-3"), "contact", Some("Carla"), "está em São Paulo").unwrap();

        let results = idx.search("Sao Paulo", 10).unwrap();
        assert!(!results.is_empty(), "unicode61 diacritic folding must match 'Sao' → 'São'");
    }

    #[test]
    fn rename_updates_path_keeps_uid() {
        let idx = temp_index();
        idx.upsert("/vault/notes/old.md", Some("uid-r1"), "note", Some("Nota"), "corpo").unwrap();
        idx.set_links("/vault/notes/old.md", Some("Nota"), &[("alvo".into(), "contexto".into())]).unwrap();

        idx.rename("/vault/notes/old.md", "/vault/notes/Nota.md").unwrap();

        assert_eq!(idx.path_for_uid("uid-r1").unwrap().as_deref(), Some("/vault/notes/Nota.md"));
        let hits = idx.search("corpo", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "/vault/notes/Nota.md");
        let back = idx.backlinks(&["alvo".into()]).unwrap();
        assert_eq!(back[0].0, "/vault/notes/Nota.md");
    }

    #[test]
    fn rename_nonexistent_path_is_noop() {
        let idx = temp_index();
        idx.rename("/ghost.md", "/ghost2.md").unwrap();
        assert_eq!(idx.count().unwrap(), 0);
    }
}
