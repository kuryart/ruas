/// SQLite-backed index for the vault.
///
/// The file system (`.md` files) is the **source of truth**. The index is a
/// read/search cache derived from those files — it can always be rebuilt.
///
/// Responsibilities:
/// - FTS5 full-text search across all module content
/// - UUID → disk path resolution (for `ruas://` links)
/// - Per-entity metadata for listing without scanning files
///
/// All public methods are synchronous; the underlying connection is shared via
/// `Arc<Mutex<Connection>>` so the index can be cloned and used from multiple
/// call sites (Tauri commands, file watcher, module lifecycle hooks).
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};

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
}

// ── IndexManager ───────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct IndexManager {
    db: Arc<Mutex<Connection>>,
}

impl IndexManager {
    /// Open (or create) the index at `<vault>/.ruas/index.db`.
    pub fn open(vault_path: &Path) -> Result<Self, String> {
        let ruas_dir = vault_path.join(".ruas");
        std::fs::create_dir_all(&ruas_dir)
            .map_err(|e| format!("index: cannot create .ruas dir: {e}"))?;

        let conn = Connection::open(ruas_dir.join("index.db"))
            .map_err(|e| format!("index: cannot open database: {e}"))?;

        let idx = Self { db: Arc::new(Mutex::new(conn)) };
        idx.migrate()?;
        Ok(idx)
    }

    // ── Schema ─────────────────────────────────────────────────────────

    fn migrate(&self) -> Result<(), String> {
        let conn = self.db.lock().unwrap();

        // journal_mode returns a result row — must use query_row, not execute
        // (WAL is ignored for in-memory databases, which is fine for tests)
        conn.query_row("PRAGMA journal_mode = WAL", [], |_| Ok(()))
            .map_err(|e| format!("index: journal_mode: {e}"))?;

        // These PRAGMAs are setter-only (no result rows) — safe for execute_batch
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
            -- `target_key` is the lowercased link text (note title or uid), so
            -- backlink lookups resolve a note's current title/uid against it.
            CREATE TABLE IF NOT EXISTS links (
                source_path  TEXT NOT NULL,
                source_title TEXT,
                target_key   TEXT NOT NULL,
                context      TEXT,
                PRIMARY KEY (source_path, target_key)
            );
            CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_key);
        ").map_err(|e| format!("index: DDL migration failed: {e}"))
    }

    // ── Write API ──────────────────────────────────────────────────────

    /// Index or re-index a single file.
    /// If the path already exists in the index it is updated in place.
    pub fn upsert(
        &self,
        path: &str,
        uid: Option<&str>,
        entity: &str,
        title: Option<&str>,
        body: &str,
    ) -> Result<(), String> {
        let conn = self.db.lock().unwrap();

        conn.execute(
            "INSERT INTO files (path, uid, entity, title)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(path) DO UPDATE SET
               uid        = excluded.uid,
               entity     = excluded.entity,
               title      = excluded.title,
               indexed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
            params![path, uid, entity, title],
        )
        .map_err(|e| format!("index: upsert files failed: {e}"))?;

        // FTS is maintained explicitly (delete + insert) to stay in sync
        conn.execute("DELETE FROM fts WHERE path = ?1", params![path])
            .map_err(|e| format!("index: fts delete failed: {e}"))?;
        conn.execute(
            "INSERT INTO fts(path, entity, title, body) VALUES (?1, ?2, ?3, ?4)",
            params![path, entity, title.unwrap_or(""), body],
        )
        .map_err(|e| format!("index: fts insert failed: {e}"))?;

        Ok(())
    }

    /// Remove a file from the index (called when the file is deleted).
    pub fn remove(&self, path: &str) -> Result<(), String> {
        let conn = self.db.lock().unwrap();
        conn.execute("DELETE FROM files WHERE path = ?1", params![path])
            .map_err(|e| format!("index: remove files failed: {e}"))?;
        conn.execute("DELETE FROM fts WHERE path = ?1", params![path])
            .map_err(|e| format!("index: remove fts failed: {e}"))?;
        conn.execute("DELETE FROM links WHERE source_path = ?1", params![path])
            .map_err(|e| format!("index: remove links failed: {e}"))?;
        Ok(())
    }

    /// Replace the set of outgoing links recorded for a source note.
    /// `links` is a list of `(target_key, context)` pairs (target_key lowercased).
    pub fn set_links(
        &self,
        source_path: &str,
        source_title: Option<&str>,
        links: &[(String, String)],
    ) -> Result<(), String> {
        let mut conn = self.db.lock().unwrap();
        let tx = conn.transaction().map_err(|e| format!("index: links tx: {e}"))?;
        tx.execute("DELETE FROM links WHERE source_path = ?1", params![source_path])
            .map_err(|e| format!("index: links clear: {e}"))?;
        for (key, context) in links {
            tx.execute(
                "INSERT OR REPLACE INTO links (source_path, source_title, target_key, context)
                 VALUES (?1, ?2, ?3, ?4)",
                params![source_path, source_title, key, context],
            )
            .map_err(|e| format!("index: links insert: {e}"))?;
        }
        tx.commit().map_err(|e| format!("index: links commit: {e}"))
    }

    /// Drop and rebuild the FTS index from the `files` table.
    /// Use after bulk upserts to ensure consistency.
    pub fn rebuild_fts(&self) -> Result<(), String> {
        self.db
            .lock()
            .unwrap()
            .execute_batch("INSERT INTO fts(fts) VALUES('rebuild');")
            .map_err(|e| format!("index: fts rebuild failed: {e}"))
    }

    // ── Read API ───────────────────────────────────────────────────────

    /// Full-text search across all indexed entities.
    /// Results are ordered by relevance (FTS5 `rank`).
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchResult>, String> {
        let conn = self.db.lock().unwrap();

        // Drive from FTS to keep `rank` accessible, then join metadata.
        // snippet column indices: 0=path(UNINDEXED) 1=entity(UNINDEXED) 2=title 3=body
        // Use -1 to let FTS5 choose the column with most matches.
        let mut stmt = conn
            .prepare(
                "SELECT f.path, f.uid, f.entity, f.title,
                        snippet(fts, -1, '<b>', '</b>', '…', 24) AS snip,
                        fts.rank
                 FROM fts
                 JOIN files f USING(path)
                 WHERE fts MATCH ?1
                 ORDER BY fts.rank
                 LIMIT ?2",
            )
            .map_err(|e| format!("index: search prepare: {e}"))?;

        let rows: rusqlite::Result<Vec<_>> = stmt
            .query_map(params![query, limit as i64], |row| {
                Ok(SearchResult {
                    path:    row.get(0)?,
                    uid:     row.get(1)?,
                    entity:  row.get(2)?,
                    title:   row.get(3)?,
                    snippet: row.get(4).unwrap_or_default(),
                    rank:    row.get(5).unwrap_or(0.0),
                })
            })
            .map_err(|e| format!("index: search query: {e}"))?
            .collect();

        rows.map_err(|e| format!("index: search row: {e}"))
    }

    /// Full-text search restricted to a single entity type (e.g. "note").
    pub fn search_entity(&self, query: &str, entity: &str, limit: usize) -> Result<Vec<SearchResult>, String> {
        let conn = self.db.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT f.path, f.uid, f.entity, f.title,
                        snippet(fts, -1, '<b>', '</b>', '…', 24) AS snip,
                        fts.rank
                 FROM fts
                 JOIN files f USING(path)
                 WHERE fts MATCH ?1 AND f.entity = ?2
                 ORDER BY fts.rank
                 LIMIT ?3",
            )
            .map_err(|e| format!("index: search_entity prepare: {e}"))?;

        let rows: rusqlite::Result<Vec<_>> = stmt
            .query_map(params![query, entity, limit as i64], |row| {
                Ok(SearchResult {
                    path:    row.get(0)?,
                    uid:     row.get(1)?,
                    entity:  row.get(2)?,
                    title:   row.get(3)?,
                    snippet: row.get(4).unwrap_or_default(),
                    rank:    row.get(5).unwrap_or(0.0),
                })
            })
            .map_err(|e| format!("index: search_entity query: {e}"))?
            .collect();

        rows.map_err(|e| format!("index: search_entity row: {e}"))
    }

    /// Notes that link to any of `target_keys` (lowercased title/uid of the
    /// target note). Returns `(source_path, source_title, context)`.
    pub fn backlinks(&self, target_keys: &[String]) -> Result<Vec<(String, Option<String>, String)>, String> {
        if target_keys.is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.db.lock().unwrap();
        let placeholders = target_keys.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT DISTINCT source_path, source_title, context
             FROM links WHERE target_key IN ({placeholders})
             ORDER BY source_title COLLATE NOCASE",
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| format!("index: backlinks prepare: {e}"))?;
        let rows: rusqlite::Result<Vec<_>> = stmt
            .query_map(rusqlite::params_from_iter(target_keys.iter()), |row| {
                Ok((row.get(0)?, row.get(1)?, row.get::<_, Option<String>>(2)?.unwrap_or_default()))
            })
            .map_err(|e| format!("index: backlinks query: {e}"))?
            .collect();
        rows.map_err(|e| format!("index: backlinks row: {e}"))
    }

    /// Resolve a `ruas://` UID to its current file path.
    pub fn path_for_uid(&self, uid: &str) -> Result<Option<String>, String> {
        self.db
            .lock()
            .unwrap()
            .query_row(
                "SELECT path FROM files WHERE uid = ?1",
                params![uid],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("index: uid lookup failed: {e}"))
    }

    /// Number of indexed documents (useful for diagnostics).
    pub fn count(&self) -> Result<usize, String> {
        self.db
            .lock()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM files", [], |row| row.get::<_, i64>(0))
            .map(|n| n as usize)
            .map_err(|e| format!("index: count failed: {e}"))
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_index() -> IndexManager {
        // In-memory SQLite — fast and isolated per test
        let conn = Connection::open_in_memory().unwrap();
        let idx = IndexManager { db: Arc::new(Mutex::new(conn)) };
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
        assert_eq!(idx.count().unwrap(), 1); // no duplicates
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

        // Re-indexing replaces the source's links (no duplicates / stale rows).
        idx.set_links("/v/notes/a.md", Some("Source"), &[("other".into(), "ctx".into())]).unwrap();
        assert!(idx.backlinks(&["target".into()]).unwrap().is_empty());
        assert_eq!(idx.backlinks(&["other".into()]).unwrap().len(), 1);

        // remove() clears links too.
        idx.remove("/v/notes/a.md").unwrap();
        assert!(idx.backlinks(&["other".into()]).unwrap().is_empty());
    }

    #[test]
    fn diacritic_folding_search() {
        let idx = temp_index();
        idx.upsert("/vault/contacts/c.md", Some("uid-3"), "contact", Some("Carla"), "está em São Paulo").unwrap();

        // Search without diacritics should still find the entry
        let results = idx.search("Sao Paulo", 10).unwrap();
        assert!(!results.is_empty(), "unicode61 diacritic folding must match 'Sao' → 'São'");
    }
}
