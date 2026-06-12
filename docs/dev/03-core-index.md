# Índice libSQL + Tantivy (`IndexManager` + `TantivyManager`)

O sistema de indexação do Ruas usa uma arquitetura CQRS: **libSQL** é o write-side (persistência ACID + metadados + outbox) e **Tantivy** é o read-side (FTS com BM25 + field boosting + stemming).

- `IndexManager` → `core/src/index.rs` — libSQL (metadados, outbox, tracking de frecency)
- `TantivyManager` → `core/src/tantivy_index.rs` — Tantivy (FTS, BM25, boosting)
- `IndexWorker` → `core/src/index_worker.rs` — worker assíncrono que consome a outbox
- `scorer` → `core/src/scorer.rs` — fórmula BM25 × Frecency × Contexto

O arquivo libSQL fica em `<vault>/.ruas/index.db` e o índice Tantivy em `<vault>/.ruas/tantivy/`. Ambos podem ser apagados — serão recriados na próxima abertura do vault.

---

## Schema do banco de dados (libSQL)

### Tabela `files`

```sql
CREATE TABLE files (
    path       TEXT PRIMARY KEY,
    uid        TEXT,
    entity     TEXT NOT NULL,              -- tipo: "contact", "note", "agenda", etc.
    title      TEXT,
    times_opened INTEGER NOT NULL DEFAULT 0,  -- frecency tracking
    last_access TEXT,                         -- ISO-8601 timestamp, última visita
    indexed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX idx_files_uid ON files(uid) WHERE uid IS NOT NULL;
```

### Tabela `fts` (FTS5 virtual — fallback)

```sql
CREATE VIRTUAL TABLE fts USING fts5(
    path   UNINDEXED,
    entity UNINDEXED,
    title,
    body,
    tokenize = 'unicode61 remove_diacritics 1'
);
```

Mantida como fallback quando o Tantivy não está disponível (ex.: testes in-memory).

### Tabela `links`

```sql
CREATE TABLE links (
    source_path  TEXT NOT NULL,
    source_title TEXT,
    target_key   TEXT NOT NULL,
    context      TEXT,
    PRIMARY KEY (source_path, target_key)
);

CREATE INDEX idx_links_target ON links(target_key);
```

### Tabela `outbox` (fila de indexação assíncrona)

```sql
CREATE TABLE outbox (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    path       TEXT NOT NULL,
    entity     TEXT NOT NULL,
    action     TEXT NOT NULL,  -- 'upsert' | 'delete'
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```

O `IndexWorker` consome esta tabela e atualiza o Tantivy em background.

---

## Schema do Tantivy

| Campo    | Tipo                          | Peso BM25 |
|----------|-------------------------------|-----------|
| `uid`    | STORED + STRING               | —         |
| `path`   | STORED + STRING               | —         |
| `entity` | STORED + STRING               | —         |
| `title`  | STORED + TEXT (stemming)      | 3.0       |
| `aliases`| STORED + TEXT (stemming)      | 3.0       |
| `tags`   | STORED + TEXT (raw tokenizer) | 2.0       |
| `fm`     | STORED + TEXT (stemming)      | 1.5       |
| `body`   | STORED + TEXT (stemming)      | 1.0       |

- `tags` usa tokenizer raw (sem stemming/splitting) para matching exato.
- `fm` contém o restante do frontmatter como JSON após Pop & Mutate.
- Tokenizer padrão: `SimpleTokenizer → LowerCaser → Stemmer(English)`.

---

## API do `IndexManager`

### Abertura

| Método | Assinatura | Notas |
|---|---|---|
| `open(vault_path)` | `(&Path) -> Result<Self, String>` | Cria `.ruas/index.db` se não existir; executa `migrate()` |

### API de escrita

| Método | Assinatura | Notas |
|---|---|---|
| `upsert(path, uid, entity, title, body)` | `(&str, Option<&str>, &str, Option<&str>, &str) -> Result<()>` | Atualiza `files` + `fts` + enfileira na `outbox` |
| `remove(path)` | `(&str) -> Result<()>` | Remove de `files`, `fts`, `links` + enfileira delete na `outbox` |
| `rename(old_path, new_path)` | `(&str, &str) -> Result<()>` | Atualiza path em `files`, `fts`, `links` em uma transaction |
| `set_links(source_path, source_title, links)` | `(&str, &str, &[(String, String)]) -> Result<()>` | Substitui atomicamente os links de `source_path` |

### API de leitura

| Método | Assinatura | Notas |
|---|---|---|
| `search(query, limit)` | `(&str, usize) -> Result<Vec<SearchResult>>` | FTS5 fallback (prefira Tantivy + scorer) |
| `search_entity(query, entity, limit)` | `(&str, &str, usize) -> Result<Vec<SearchResult>>` | FTS5 fallback com filtro de entidade |
| `backlinks(target_keys)` | `(&[String]) -> Result<Vec<...>>` | Backlinks por chave |
| `path_for_uid(uid)` | `(&str) -> Result<Option<String>>` | Resolve `ruas://` URIs |
| `count()` | `() -> Result<usize>` | Documentos indexados |

### Frecency tracking

| Método | Assinatura | Notas |
|---|---|---|
| `record_access(path)` | `(&str) -> Result<()>` | Incrementa `times_opened` + atualiza `last_access` |
| `get_batch_stats(paths)` | `(&[String]) -> Result<Vec<...>>` | Carrega `(times_opened, last_access)` em lote |
| `get_total_frecency()` | `() -> Result<i64>` | `SUM(times_opened)` para aging |
| `halve_all_frecency()` | `() -> Result<()>` | Aging: divide todos por 2, zera < 1 |

### Outbox

| Método | Assinatura | Notas |
|---|---|---|
| `enqueue(path, entity, action)` | `(&str, &str, &str) -> Result<()>` | Insere tarefa na outbox |
| `drain_outbox(limit)` | `(usize) -> Result<Vec<OutboxEntry>>` | Consome entradas (FIFO) |
| `delete_outbox(id)` | `(i64) -> Result<()>` | Ack de entrada processada |

---

## `SearchResult`

```rust
pub struct SearchResult {
    pub path: String,
    pub uid: Option<String>,
    pub entity: String,              // "contact", "note", etc.
    pub title: Option<String>,
    pub snippet: String,             // trecho com <b>...</b> destacados
    pub rank: f64,                   // rank FTS5 (fallback)
    pub bm25_score: f64,             // score bruto do Tantivy (BM25)
    pub final_score: f64,            // score combinado (BM25 × Frecency × Contexto)
}
```

---

## Fluxo de indexação

1. **Salvar**: módulo chama `IndexManager::upsert()` → grava em `files` + `fts` + `outbox` (transação ACID).
2. **Despertar**: `upsert()` dispara `tx.send(())` no canal MPSC.
3. **Worker**: `IndexWorker` acorda, drena a `outbox`, lê o arquivo do disco, aplica Pop & Mutate, indexa no Tantivy, dá ack (`delete_outbox`).
4. **Crash recovery**: na inicialização, o worker drena toda a outbox antes de entrar no loop reativo.

Para detalhes completos da arquitetura de busca (CQRS, scoring, frecency), veja [17-search-architecture.md](17-search-architecture.md).
