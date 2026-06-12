// ── TantivyManager: Full-text search index ───────────────────────────────
///
/// Tantivy is the read-optimised FTS engine with field boosting, stemming,
/// and fuzzy search. libSQL remains the write-side authoritative store
/// (metadata + outbox). The async index worker reads from the outbox and
/// updates Tantivy in the background (CQRS split).
///
/// Schema (see spec §4.1):
/// ┌──────────┬──────────────────────────────────────────┐
/// │ Field    │ Type / Attributes          │ Weight     │
/// ├──────────┼────────────────────────────┼────────────┤
/// │ uid      │ STORED + STRING            │ —          │
/// │ path     │ STORED + STRING            │ —          │
/// │ entity   │ STORED + STRING            │ —          │
/// │ title    │ STORED + TEXT (stemming)   │ 3.0        │
/// │ aliases  │ STORED + TEXT (stemming)   │ 3.0        │
/// │ tags     │ STORED + TEXT (raw token.) │ 2.0        │
/// │ fm       │ STORED + TEXT (stemming)   │ 1.5        │
/// │ body     │ STORED + TEXT (stemming)   │ 1.0        │
/// └──────────┴────────────────────────────┴────────────┘
///
/// `tags` uses a raw tokeniser so that exact tokens like "rust" are matched
/// without stemming or splitting. `fm` holds the remaining frontmatter as
/// JSON after `tags` and `aliases` have been popped (see §4.2 "Pop & Mutate").
use std::path::{Path, PathBuf};
use tantivy::collector::TopDocs;
use tantivy::query::{
    BooleanQuery, BoostQuery, FuzzyTermQuery, Occur, Query, TermQuery,
};
use tantivy::schema::*;
use tantivy::tokenizer::*;
use tantivy::{Index, IndexReader, IndexWriter, ReloadPolicy, TantivyDocument, Term};

// ── Public types ───────────────────────────────────────────────────────────

/// A search hit returned by Tantivy.
#[derive(Debug, Clone)]
pub struct TantivyHit {
    pub uid: Option<String>,
    pub path: String,
    pub entity: String,
    pub title: Option<String>,
    /// Raw BM25 score from Tantivy (higher = more relevant).
    pub bm25_score: f64,
}

/// Schema field handles — obtained once and reused.
pub struct TantivyFields {
    pub uid: Field,
    pub path: Field,
    pub entity: Field,
    pub title: Field,
    pub aliases: Field,
    pub tags: Field,
    pub fm: Field,
    pub body: Field,
}

// ── TantivyManager ─────────────────────────────────────────────────────────

pub struct TantivyManager {
    index: Index,
    reader: IndexReader,
    fields: TantivyFields,
    _dir: PathBuf,
}

impl TantivyManager {
    /// Open (or create) the Tantivy index at `<vault>/.ruas/tantivy/`.
    /// Automatically rebuilds the index if the tokenizer version changed.
    pub fn open(vault_path: &Path) -> Result<Self, String> {
        let dir = vault_path.join(".ruas").join("tantivy");
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("tantivy: cannot create dir: {e}"))?;

        // ── Version check: if tokenizer changed, rebuild from scratch ──
        const TOKENIZER_VERSION: u32 = 2;
        let version_file = dir.join("TOKENIZER_VERSION");
        let needs_rebuild = match std::fs::read_to_string(&version_file) {
            Ok(s) => s.trim().parse::<u32>().unwrap_or(0) != TOKENIZER_VERSION,
            Err(_) => true, // no version file → fallback to rebuild check
        };

        if needs_rebuild && dir.join("meta.json").exists() {
            log::info!(
                "[tantivy] Tokenizer version changed — deleting old index for rebuild."
            );
            std::fs::remove_dir_all(&dir)
                .map_err(|e| format!("tantivy: cannot remove old index: {e}"))?;
            std::fs::create_dir_all(&dir)
                .map_err(|e| format!("tantivy: cannot recreate dir: {e}"))?;
        }

        let (schema, fields) = build_schema();

        let index = if dir.join("meta.json").exists() {
            Index::open_in_dir(&dir)
                .map_err(|e| format!("tantivy: open failed: {e}"))?
        } else {
            Index::create_in_dir(&dir, schema.clone())
                .map_err(|e| format!("tantivy: create failed: {e}"))?
        };

        // Write the current tokenizer version after successful open.
        let _ = std::fs::write(&version_file, TOKENIZER_VERSION.to_string());

        // Register tokenizers for the text fields.
        register_tokenizers(&index);

        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::OnCommitWithDelay)
            .try_into()
            .map_err(|e| format!("tantivy: reader builder: {e}"))?;

        Ok(Self {
            index,
            reader,
            fields,
            _dir: dir,
        })
    }

    /// Create a new `IndexWriter` for bulk or single-document indexing.
    /// The caller must call `commit()` to make documents searchable.
    pub fn writer(&self, buffer_mb: usize) -> Result<IndexWriter, String> {
        self.index
            .writer(buffer_mb * 1_000_000)
            .map_err(|e| format!("tantivy: writer: {e}"))
    }

    /// Build and write a document into the index (single write).
    /// For bulk operations prefer `writer()` and loop over documents.
    pub fn index_document(
        &self,
        uid: Option<&str>,
        path: &str,
        entity: &str,
        title: Option<&str>,
        aliases: Option<&str>,
        tags: Option<&str>,
        fm: Option<&str>,
        body: &str,
    ) -> Result<(), String> {
        let mut writer = self.writer(50)?;

        // Delete previous version first (idempotent upsert).
        writer.delete_term(tantivy::Term::from_field_text(self.fields.path, path));

        let mut doc = TantivyDocument::new();
        if let Some(v) = uid {
            doc.add_text(self.fields.uid, v);
        }
        doc.add_text(self.fields.path, path);
        doc.add_text(self.fields.entity, entity);
        if let Some(v) = title {
            doc.add_text(self.fields.title, v);
        }
        if let Some(v) = aliases {
            doc.add_text(self.fields.aliases, v);
        }
        if let Some(v) = tags {
            doc.add_text(self.fields.tags, v);
        }
        if let Some(v) = fm {
            doc.add_text(self.fields.fm, v);
        }
        doc.add_text(self.fields.body, body);

        writer
            .add_document(doc)
            .map_err(|e| format!("tantivy: add_document: {e}"))?;

        writer
            .commit()
            .map(|_| ())
            .map_err(|e| format!("tantivy: commit: {e}"))
    }

    /// Delete a document by path.
    pub fn delete_document(&self, path: &str) -> Result<(), String> {
        let mut writer = self.writer(50)?;
        writer.delete_term(tantivy::Term::from_field_text(self.fields.path, path));
        writer
            .commit()
            .map(|_| ())
            .map_err(|e| format!("tantivy: commit: {e}"))
    }

    /// Search across all text fields.
    /// Returns top `limit` hits sorted by BM25 score (descending).
    pub fn search(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<TantivyHit>, String> {
        self.search_entity(query, None, limit)
    }

    /// Search with an optional entity filter (e.g. "note", "contact").
    pub fn search_entity(
        &self,
        query: &str,
        entity_filter: Option<&str>,
        limit: usize,
    ) -> Result<Vec<TantivyHit>, String> {
        let searcher = self.reader.searcher();
        let built = build_search_query(query, &self.fields);
        let built_query = match &built {
            Some(q) => q,
            None => return Ok(Vec::new()),
        };

        log::debug!(
            "[tantivy] search_entity: raw='{query}', expanded='{}', entity={entity_filter:?}",
            describe_query(query),
        );

        // ── Collect ────────────────────────────────────────────────────
        // Fetch extra results because entity filtering is post-query.
        let fetch_limit = (limit * 5).min(500);

        let top_docs = searcher
            .search(built_query.as_ref(), &TopDocs::with_limit(fetch_limit))
            .map_err(|e| format!("tantivy: search: {e}"))?;

        log::debug!("[tantivy] raw hits before entity filter: {}", top_docs.len());

        let mut hits = Vec::with_capacity(top_docs.len().min(limit));
        for (score, doc_address) in top_docs {
            let doc: TantivyDocument = searcher
                .doc(doc_address)
                .map_err(|e| format!("tantivy: retrieve doc: {e}"))?;

            let hit_entity = extract_text(&doc, self.fields.entity);

            if let Some(filter) = entity_filter {
                if hit_entity.as_str() != filter {
                    continue;
                }
            }

            hits.push(TantivyHit {
                uid: doc
                    .get_first(self.fields.uid)
                    .and_then(|v| v.as_str().map(|s| s.to_string())),
                path: extract_text(&doc, self.fields.path),
                entity: hit_entity,
                title: {
                    let t = extract_text(&doc, self.fields.title);
                    (!t.is_empty()).then_some(t)
                },
                bm25_score: score as f64,
            });

            if hits.len() >= limit {
                break;
            }
        }

        log::debug!("[tantivy] results after entity filter: {}", hits.len());
        Ok(hits)
    }

    /// Access the schema fields (useful for building queries externally).
    pub fn fields(&self) -> &TantivyFields {
        &self.fields
    }

    /// Return the underlying index.
    pub fn index(&self) -> &Index {
        &self.index
    }

    /// Return the reader (for advanced use).
    pub fn reader(&self) -> &IndexReader {
        &self.reader
    }
}

// ── Schema construction ────────────────────────────────────────────────────

fn build_schema() -> (Schema, TantivyFields) {
    let mut builder = Schema::builder();

    let uid = builder.add_text_field("uid", STRING | STORED);
    let path = builder.add_text_field("path", STRING | STORED);
    let entity = builder.add_text_field("entity", STRING | STORED);
    // TEXT fields with per-field tokenizer options.
    let title = builder.add_text_field("title", text_field_opts());
    let aliases = builder.add_text_field("aliases", text_field_opts());
    // tags uses the raw tokenizer (no stemming/splitting).
    let tags = builder.add_text_field("tags", tags_field_opts());
    let fm = builder.add_text_field("fm", text_field_opts());
    let body = builder.add_text_field("body", text_field_opts());

    let schema = builder.build();
    let fields = TantivyFields {
        uid,
        path,
        entity,
        title,
        aliases,
        tags,
        fm,
        body,
    };
    (schema, fields)
}

/// Register custom tokenizers on the index:
/// - The global `default` tokenizer is set to SimpleTokenizer → LowerCaser →
///   AsciiFoldingFilter → Stemmer(English) for title / aliases / fm / body.
/// - `raw_tags`: RawTokenizer → LowerCaser → AsciiFoldingFilter (for tags).
///
/// AsciiFoldingFilter maps é→e, ç→c, ã→a, etc. so "abrao" matches "Abraão".
fn register_tokenizers(index: &Index) {
    use tantivy::tokenizer::Language;

    // ── Stemming tokenizer (English) — registered as "default" ──────────
    let stem_en = TextAnalyzer::builder(SimpleTokenizer::default())
        .filter(LowerCaser)
        .filter(AsciiFoldingFilter)
        .filter(Stemmer::new(Language::English))
        .build();
    index.tokenizers().register("default", stem_en);

    // ── Raw tokenizer for tags ─────────────────────────────────────────
    let raw = TextAnalyzer::builder(RawTokenizer::default())
        .filter(LowerCaser)
        .filter(AsciiFoldingFilter)
        .build();
    index.tokenizers().register("raw_tags", raw);
}

/// Configure per-field tokenizer for the tags field (raw, no stemming).
fn tags_field_opts() -> TextOptions {
    let indexing = TextFieldIndexing::default()
        .set_tokenizer("raw_tags")
        .set_index_option(IndexRecordOption::WithFreqsAndPositions);
    TextOptions::default()
        .set_indexing_options(indexing)
        .set_stored()
}

/// Configure per-field tokenizer for text fields that use stemming.
fn text_field_opts() -> TextOptions {
    let indexing = TextFieldIndexing::default()
        .set_tokenizer("default")
        .set_index_option(IndexRecordOption::WithFreqsAndPositions);
    TextOptions::default()
        .set_indexing_options(indexing)
        .set_stored()
}

// ── Helper ─────────────────────────────────────────────────────────────────

fn extract_text(doc: &TantivyDocument, field: Field) -> String {
    doc.get_first(field)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

// ── Programmatic query builder ─────────────────────────────────────────────
///
/// Builds a Tantivy query that matches each user token with
///   - exact term match (TermQuery)
///   - fuzzy match, edit distance 1 (FuzzyTermQuery)
///   - prefix match (RegexQuery: `token.*`)
/// across all searchable text fields, with per-field boosting.
///
/// Tokens are combined with AND (Must); within each token group the three
/// match strategies are OR'd (Should). Returns None when the query yields
/// no usable tokens.

fn build_search_query(raw: &str, fields: &TantivyFields) -> Option<Box<dyn Query>> {
    let normalized = strip_diacritics(raw);
    let tokens: Vec<String> = normalized
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_lowercase())
        .collect();

    if tokens.is_empty() {
        return None;
    }

    let text_fields: [(Field, f64); 5] = [
        (fields.title, 3.0),
        (fields.aliases, 3.0),
        (fields.tags, 2.0),
        (fields.fm, 1.5),
        (fields.body, 1.0),
    ];

    // ── For each token, build a Should group across all fields ─────────
    let mut token_groups: Vec<(Occur, Box<dyn Query>)> = Vec::new();

    for token in &tokens {
        let mut field_clauses: Vec<(Occur, Box<dyn Query>)> = Vec::new();

        for &(field, boost) in &text_fields {
            let term = Term::from_field_text(field, token);

            // ── Three match strategies OR'd together ─────────────────
            let mut strategy_or: Vec<(Occur, Box<dyn Query>)> = Vec::new();

            // Exact match
            strategy_or.push((Occur::Should, Box::new(TermQuery::new(
                term.clone(),
                IndexRecordOption::WithFreqs,
            ))));

            // Fuzzy match (edit distance 1, not prefix)
            strategy_or.push((Occur::Should, Box::new(FuzzyTermQuery::new(
                term.clone(),
                1,
                false,
            ))));

            // Prefix match: FuzzyTermQuery in prefix mode with distance=0
            // matches any analyzed term starting with `token`.
            // Skip for single-char tokens (matches everything; noise).
            if token.len() > 1 {
                strategy_or.push((Occur::Should, Box::new(FuzzyTermQuery::new_prefix(
                    term.clone(),
                    0,
                    true,
                ))));
            }

            let field_inner: Box<dyn Query> =
                Box::new(BooleanQuery::new(strategy_or));

            // Apply field boost
            let boosted: Box<dyn Query> =
                Box::new(BoostQuery::new(field_inner, boost as f32));

            field_clauses.push((Occur::Should, boosted));
        }

        let token_or: Box<dyn Query> = Box::new(BooleanQuery::new(field_clauses));
        token_groups.push((Occur::Must, token_or));
    }

    Some(Box::new(BooleanQuery::new(token_groups)))
}

/// Human-readable description for debug logging.
fn describe_query(raw: &str) -> String {
    let normalized = strip_diacritics(raw);
    let tokens: Vec<&str> = normalized
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .collect();
    if tokens.is_empty() {
        return "(empty)".to_string();
    }
    tokens
        .iter()
        .map(|t| {
            let c = t.to_lowercase();
            if c.len() <= 1 {
                format!("({c}|{c}~1)")
            } else {
                format!("({c}|{c}~1|{c}*)")
            }
        })
        .collect::<Vec<_>>()
        .join(" AND ")
}

// ── Diacritic folding ──────────────────────────────────────────────────────

/// Strip diacritics from Latin characters: é→e, ç→c, ã→a, ü→u, etc.
/// Also handles common non-Latin diacritics and ligatures.
pub fn strip_diacritics(s: &str) -> String {
    s.chars().map(map_diacritic).collect()
}

fn map_diacritic(c: char) -> char {
    // Fast path: ASCII stays as-is.
    if c.is_ascii() {
        return c;
    }
    // ── Latin diacritics — exhaustive mapping ────────────────────────
    match c {
        // grave
        'À' | 'Á' | 'Â' | 'Ã' | 'Ä' | 'Å' => 'A',
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' => 'a',
        // E
        'È' | 'É' | 'Ê' | 'Ë' => 'E',
        'è' | 'é' | 'ê' | 'ë' => 'e',
        // I
        'Ì' | 'Í' | 'Î' | 'Ï' => 'I',
        'ì' | 'í' | 'î' | 'ï' => 'i',
        // O
        'Ò' | 'Ó' | 'Ô' | 'Õ' | 'Ö' | 'Ø' => 'O',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' => 'o',
        // U
        'Ù' | 'Ú' | 'Û' | 'Ü' => 'U',
        'ù' | 'ú' | 'û' | 'ü' => 'u',
        // Y
        'Ý' | 'Ÿ' => 'Y',
        'ý' | 'ÿ' => 'y',
        // C
        'Ç' => 'C',
        'ç' => 'c',
        // N
        'Ñ' => 'N',
        'ñ' => 'n',
        // D/stroke
        'Ð' => 'D',
        'ð' => 'd',
        // S
        'Š' => 'S', 'š' => 's',
        // Z
        'Ž' => 'Z', 'ž' => 'z',
        // L
        'Ł' => 'L', 'ł' => 'l',
        // Æ / æ → ae (two chars — rare, keep as-is for simplicity)
        // ß → ss
        'ß' => 's',
        // Everything else stays unchanged (Cyrillic, Greek, etc.).
        _ => c,
    }
}


// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_manager() -> TantivyManager {
        let tmp = tempfile::tempdir().unwrap();
        TantivyManager::open(tmp.path()).unwrap()
    }

    #[test]
    fn index_and_search_basic() {
        let tm = temp_manager();
        tm.index_document(
            Some("uid-1"),
            "/vault/notes/a.md",
            "note",
            Some("Learning Rust"),
            Some("rustlang, ferris"),
            Some("rust, programming"),
            Some(r#"{"status":"draft"}"#),
            "Rust is a systems programming language focusing on safety and speed.",
        )
        .unwrap();

        tm.index_document(
            Some("uid-2"),
            "/vault/notes/b.md",
            "note",
            Some("Cooking Recipes"),
            None,
            Some("cooking, food"),
            Some(r#"{"difficulty":"easy"}"#),
            "This is a recipe for pasta carbonara.",
        )
        .unwrap();

        // Search for "rust" — the first note should be the top hit.
        let hits = tm.search("rust", 10).unwrap();
        assert!(!hits.is_empty());
        assert_eq!(hits[0].uid.as_deref(), Some("uid-1"));
        assert!(hits[0].bm25_score > 0.0);
    }

    #[test]
    fn search_entity_filter() {
        let tm = temp_manager();
        tm.index_document(
            Some("uid-c"),
            "/vault/contacts/alice.md",
            "contact",
            Some("Alice Smith"),
            None,
            None,
            None,
            "Alice is a developer.",
        )
        .unwrap();
        tm.index_document(
            Some("uid-n"),
            "/vault/notes/alice.md",
            "note",
            Some("Meeting with Alice"),
            None,
            None,
            None,
            "Discussed the new project.",
        )
        .unwrap();

        let contacts = tm.search_entity("alice", Some("contact"), 10).unwrap();
        assert_eq!(contacts.len(), 1);
        assert_eq!(contacts[0].uid.as_deref(), Some("uid-c"));

        let notes = tm.search_entity("alice", Some("note"), 10).unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].uid.as_deref(), Some("uid-n"));
    }

    #[test]
    fn title_matches_outrank_body() {
        let tm = temp_manager();
        // Doc with term only in body
        tm.index_document(
            Some("uid-1"),
            "/vault/notes/one.md",
            "note",
            Some("Something Else"),
            None,
            None,
            None,
            "This document mentions rust.",
        )
        .unwrap();
        // Doc with term in title
        tm.index_document(
            Some("uid-2"),
            "/vault/notes/two.md",
            "note",
            Some("Rust Programming"),
            None,
            None,
            None,
            "Some other text.",
        )
        .unwrap();

        let hits = tm.search("rust", 10).unwrap();
        // Title match (weight 3x) should outrank body-only match (weight 1x)
        assert_eq!(hits[0].uid.as_deref(), Some("uid-2"));
    }

    #[test]
    fn delete_document_removes_from_index() {
        let tm = temp_manager();
        tm.index_document(
            Some("uid-x"),
            "/vault/notes/x.md",
            "note",
            Some("Delete Me"),
            None,
            None,
            None,
            "This will be deleted.",
        )
        .unwrap();

        assert!(!tm.search("deleted", 10).unwrap().is_empty());

        tm.delete_document("/vault/notes/x.md").unwrap();

        assert!(tm.search("deleted", 10).unwrap().is_empty());
    }

    #[test]
    fn upsert_overwrites_previous() {
        let tm = temp_manager();
        tm.index_document(
            Some("uid-1"),
            "/vault/notes/a.md",
            "note",
            Some("Version One"),
            None,
            None,
            None,
            "old content",
        )
        .unwrap();
        tm.index_document(
            Some("uid-1"),
            "/vault/notes/a.md",
            "note",
            Some("Version Two"),
            None,
            None,
            None,
            "new content about tantivy",
        )
        .unwrap();

        let hits = tm.search("tantivy", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title.as_deref(), Some("Version Two"));
    }

    #[test]
    fn describe_query_output() {
        let desc = describe_query("rust proj");
        assert!(desc.contains("rust"), "must contain first token");
        assert!(desc.contains("proj"), "must contain second token");
        assert!(desc.contains("AND"), "multi-token combines with AND");
        assert!(desc.contains('*'), "prefix indicator present");
        assert!(desc.contains("~1"), "fuzzy indicator present");
    }

    #[test]
    fn describe_single_char_no_prefix() {
        let desc = describe_query("x");
        assert!(!desc.contains('*'), "1-char token should not have prefix");
        assert!(desc.contains("~1"), "but should have fuzzy");
    }

    // ── Diacritic folding ──────────────────────────────────────────────

    #[test]
    fn diacritic_folding_in_describe() {
        // "abrao" should produce a description with fuzzy + prefix indicators
        let desc = describe_query("abrao");
        assert!(desc.contains("abrao"), "exact token in description: {desc}");
        assert!(desc.contains("~1"), "fuzzy indicator: {desc}");
        assert!(desc.contains('*'), "prefix indicator: {desc}");
    }

    #[test]
    fn strip_diacritics_converts_latin() {
        assert_eq!(strip_diacritics("São"), "Sao");
        assert_eq!(strip_diacritics("café"), "cafe");
        assert_eq!(strip_diacritics("Abraão"), "Abraao");
        assert_eq!(strip_diacritics("João"), "Joao");
        assert_eq!(strip_diacritics("Müller"), "Muller");
    }

    #[test]
    fn fuzzy_prefix_finds_partial_query() {
        let tm = temp_manager();
        tm.index_document(
            Some("uid-rita"),
            "/vault/contacts/rita.md",
            "contact",
            Some("Rita Bayer"),
            None,
            None,
            None,
            "Contact info for Rita.",
        )
        .unwrap();

        // "ri" should match "Rita" via prefix ri*
        let hits = tm.search("ri", 10).unwrap();
        assert!(!hits.is_empty(), "prefix 'ri' should match 'Rita'");

        // "rita" should match exactly
        let hits2 = tm.search("rita", 10).unwrap();
        assert!(!hits2.is_empty(), "exact 'rita' should match 'Rita'");

        // "rit" (partial) should match via prefix
        let hits3 = tm.search("rit", 10).unwrap();
        assert!(!hits3.is_empty(), "prefix 'rit' should match 'Rita'");
    }

    #[test]
    fn diacritic_fuzzy_finds_abraao() {
        let tm = temp_manager();
        tm.index_document(
            Some("uid-abraao"),
            "/vault/contacts/abraao.md",
            "contact",
            Some("Abraão Filho"),
            None,
            None,
            None,
            "Contact info.",
        )
        .unwrap();

        // "abrao" should fuzzy-match "Abraão" after diacritic folding
        let hits = tm.search("abrao", 10).unwrap();
        assert!(!hits.is_empty(), "'abrao' should match 'Abraão' (diacritic folding + fuzzy)");
        assert_eq!(hits[0].uid.as_deref(), Some("uid-abraao"));
    }
}
