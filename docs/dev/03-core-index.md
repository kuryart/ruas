# Índice SQLite (`IndexManager`)

O `IndexManager` é o motor de busca e resolução de links do Ruas. Fica em `core/src/index.rs`.

O arquivo de banco de dados fica em `<vault>/.ruas/index.db` e pode ser apagado a qualquer momento — será recriado na próxima abertura do vault.

---

## Schema do banco de dados

### Tabela `files`

```sql
CREATE TABLE files (
    path       TEXT PRIMARY KEY,
    uid        TEXT,                       -- UUID do documento (null se não tiver)
    entity     TEXT NOT NULL,              -- tipo: "contact", "note", "agenda", etc.
    title      TEXT,
    indexed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX idx_files_uid ON files(uid) WHERE uid IS NOT NULL;
```

### Tabela `fts` (FTS5 virtual)

```sql
CREATE VIRTUAL TABLE fts USING fts5(
    path   UNINDEXED,   -- não indexado para busca, mas retornado nas rows
    entity UNINDEXED,
    title,
    body,
    tokenize = 'unicode61 remove_diacritics 1'
);
```

O tokenizer `unicode61 remove_diacritics 1` faz normalização de diacríticos: `é → e`, `ç → c`, `ã → a`.

### Tabela `links`

```sql
CREATE TABLE links (
    source_path  TEXT NOT NULL,
    source_title TEXT,
    target_key   TEXT NOT NULL,   -- título ou uid lowercased do link alvo
    context      TEXT,            -- trecho de texto ao redor do link
    PRIMARY KEY (source_path, target_key)
);

CREATE INDEX idx_links_target ON links(target_key);
```

`target_key` é sempre **lowercased**. Ao consultar backlinks, os candidatos (título atual, uid, aliases) também devem ser lowercased.

---

## API do `IndexManager`

### Abertura

| Método | Assinatura | Notas |
|---|---|---|
| `open(vault_path)` | `(&Path) -> Result<Self, String>` | Cria `.ruas/index.db` se não existir; executa `migrate()` (DDL é idempotente) |

### API de escrita

| Método | Assinatura | Notas |
|---|---|---|
| `upsert(path, uid, entity, title, body)` | `(&str, Option<&str>, &str, Option<&str>, &str) -> Result<()>` | DELETE + INSERT para consistência do FTS5; chame ao criar/salvar arquivo |
| `remove(path)` | `(&str) -> Result<()>` | Remove de `files`, `fts` e `links`; chame ao deletar arquivo |
| `set_links(source_path, source_title, links)` | `(&str, &str, &[(String, String)]) -> Result<()>` | Substitui atomicamente todos os links de `source_path`; `links` = `[(target_key, context)]` |
| `rebuild_fts()` | `() -> Result<()>` | Re-popula o FTS5 a partir de `files`; use em bulk reindex |

### API de leitura

| Método | Assinatura | Notas |
|---|---|---|
| `search(query, limit)` | `(&str, usize) -> Result<Vec<SearchResult>>` | Busca em todos os tipos de entidade |
| `search_entity(query, entity, limit)` | `(&str, &str, usize) -> Result<Vec<SearchResult>>` | Busca restrita a um tipo de entidade |
| `backlinks(target_keys)` | `(&[String]) -> Result<Vec<(String, Option<String>, String)>>` | Retorna `(source_path, source_title, context)` para qualquer chave no slice |
| `path_for_uid(uid)` | `(&str) -> Result<Option<String>>` | Resolve `ruas://` URIs — retorna caminho em disco |
| `count()` | `() -> Result<usize>` | Número de documentos indexados (diagnóstico) |

---

## `SearchResult`

```rust
pub struct SearchResult {
    pub path: String,
    pub uid: Option<String>,
    pub entity: String,           // "contact", "note", etc.
    pub title: Option<String>,
    pub snippet: String,          // trecho com termos destacados por <b>...</b>
    pub rank: f64,                // rank BM25 negativo (mais negativo = mais relevante)
}
```

---

## Sintaxe de busca FTS5

O FTS5 aceita consultas no formato:

| Exemplo | Descrição |
|---|---|
| `rust` | Busca pelo token "rust" |
| `rust*` | Prefix search (rust, rusting, etc.) |
| `"hello world"` | Frase exata |
| `hello AND world` | Ambos os termos |
| `hello OR world` | Qualquer um dos termos |
| `hello NOT world` | "hello" sem "world" |

Diacríticos são normalizados: buscar `cafe` encontra "café".

---

## Grafo de links

Quando uma nota é salva, os links wiki `[[alvo]]` são extraídos e gravados na tabela `links`:

```
set_links(source_path, source_title, [(target_key, context), ...])
```

Para buscar backlinks de uma nota, passe os possíveis identificadores como `target_keys`:

```rust
// Backlinks para "minha-nota.md" com uid "abc-123"
let keys = vec!["minha nota".to_string(), "abc-123".to_string()];
let backlinks = index.backlinks(&keys)?;
// Retorna: Vec<(source_path, source_title, context)>
```

A consulta faz `WHERE target_key IN (...)`, portanto múltiplas chaves são eficientes.

---

## Thread safety

`IndexManager` usa `Arc<Mutex<Connection>>` internamente e implementa `Clone`. Pode ser clonado e passado para a thread do file watcher:

```rust
let idx_arc = registry.index_arc(); // Option<Arc<IndexManager>>
```

O lock é obtido por operação (granularidade por método). Para operações em lote de alta concorrência, considere migrar para `r2d2` ou `sqlx` no futuro.

**WAL mode** está ativo (`PRAGMA journal_mode = WAL`), permitindo reads concorrentes sem bloquear writes. Em bancos in-memory (testes) o WAL é ignorado sem efeito colateral.

---

## `rebuild_fts()`

Reconstrói o FTS5 a partir dos dados em `files`. Útil após importações em lote:

```rust
index.rebuild_fts()?;
```

Em operações normais não é necessário — `upsert` mantém o FTS5 atualizado automaticamente.
