# Modelo de Dados do Core

Tipos de domínio definidos em `ruas_core`. Todos implementam `Serialize`/`Deserialize` (serde_json) e são usados tanto pelo Tauri shell quanto pela API HTTP.

---

## Vault

**Arquivo:** `core/src/vault.rs`

```rust
pub struct VaultConfig {
    pub name: String,
    pub created: String,  // ISO 8601, ex: "2024-01-15T10:30:00Z"
}
```

### Funções

```rust
// Cria um novo vault: mkdir, grava .ruas/config.json, retorna a config.
pub fn create_vault(base_path: &Path, name: &str) -> Result<VaultConfig, String>

// Valida que base_path é um vault existente (lê .ruas/config.json).
pub fn validate_vault(base_path: &Path) -> Result<VaultConfig, String>
```

---

## Contacts

**Arquivo:** `core/src/contacts.rs`

### Tipos

```rust
pub struct ContactEmail {
    pub field_type: String,  // "work", "home", "other"
    pub value: String,
}

pub struct ContactPhone {
    pub field_type: String,  // "work", "home", "mobile", "other"
    pub value: String,
}

pub struct ContactAddress {
    pub field_type: String,
    pub street:  Option<String>,
    pub city:    Option<String>,
    pub region:  Option<String>,
    pub code:    Option<String>,
    pub country: Option<String>,
}
```

```rust
pub struct ContactFrontmatter {
    pub uid:         Option<String>,   // UUID v4
    pub full_name:   Option<String>,   // vCard FN
    pub given_name:  Option<String>,   // vCard N givenName
    pub family_name: Option<String>,   // vCard N familyName
    pub email:       Vec<ContactEmail>,
    pub tel:         Vec<ContactPhone>,
    pub org:         Option<String>,   // organização
    pub title:       Option<String>,   // cargo
    pub adr:         Vec<ContactAddress>,
    pub url:         Option<String>,
    pub bday:        Option<String>,   // ISO 8601: "1990-05-23"
    pub note:        Option<String>,
    pub photo:       Option<String>,
    pub tags:        Vec<String>,
    pub created:     Option<String>,
    pub modified:    Option<String>,
    // + campos extras preservados via serde(flatten)
}
```

**`display_name()`** — ordem de resolução:
1. `full_name` se preenchido
2. `"<given_name> <family_name>"` se ambos presentes
3. `given_name` sozinho
4. `family_name` sozinho
5. `"Unknown"`

**`initials()`** — extrai iniciais do display name (máx. 2 caracteres).

```rust
pub struct Contact {
    pub path: String,
    pub frontmatter: ContactFrontmatter,
    pub body: String,   // conteúdo Markdown após o frontmatter YAML
}

pub struct ContactMeta {
    pub path: String,
    pub display_name: String,
    pub initials: String,
    pub org: Option<String>,
    pub primary_email: Option<String>,
    pub tags: Option<Vec<String>>,
}
```

### Funções públicas

```rust
// Parseia arquivo .md com frontmatter YAML → Contact.
pub fn parse_contact(path: &str, content: &str) -> Result<Contact, String>

// Serializa Contact de volta para string .md (---\n<YAML>\n---\n\n<body>).
pub fn serialize_contact(fm: &ContactFrontmatter, body: &str) -> Result<String, String>

// Extrai metadados leves para listagem.
pub fn contact_to_meta(c: &Contact) -> ContactMeta
```

### Storage

Contatos ficam em `<vault>/contacts/<nome>.md`. O nome do arquivo é derivado do display name na criação (snake_case, sem acentos).

---

## Notes

**Arquivo:** `core/src/notes.rs`

### Tipos

```rust
pub struct NoteFrontmatter {
    pub uid:      Option<String>,   // UUID v4
    pub title:    Option<String>,
    pub tags:     Vec<String>,
    pub created:  Option<String>,
    pub modified: Option<String>,
    pub extra:    BTreeMap<String, serde_yaml::Value>,  // propriedades customizadas
}
```

O campo `extra` garante round-trip: qualquer chave YAML não reconhecida é preservada sem modificação.

```rust
pub struct Note {
    pub path: String,
    pub frontmatter: NoteFrontmatter,
    pub body: String,
}

pub struct NoteMeta {
    pub path: String,
    pub title: String,
    pub tags: Option<Vec<String>>,
    pub modified: Option<String>,
}

pub struct BacklinkMeta {
    pub source_path: String,
    pub source_title: String,
    pub context: String,   // trecho de texto ao redor do link wiki
}

pub struct NoteTreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<NoteTreeNode>,
}

pub struct BlockMeta {
    pub id: String,
    pub preview: String,  // primeiros ~60 chars do conteúdo da linha
}
```

### Funções públicas

```rust
// Parseia arquivo .md com frontmatter YAML → Note.
pub fn parse_note(path: &str, content: &str) -> Result<Note, String>

// Serializa Note → string .md.
pub fn serialize_note(fm: &NoteFrontmatter, body: &str) -> Result<String, String>

// Extrai metadados leves para listagem.
pub fn note_to_meta(n: &Note) -> NoteMeta

// Busca por query no diretório (fallback filesystem, sem FTS5).
pub fn search_notes_in_dir(dir: &Path, query: &str) -> Vec<NoteMeta>

// Encontra backlinks (filesystem scan — use o índice quando disponível).
pub fn find_backlinks_in_dir(dir: &Path, target_path: &str) -> Vec<BacklinkMeta>

// Constrói árvore de diretórios/notas recursiva.
pub fn build_notes_tree(dir: &Path) -> Vec<NoteTreeNode>

// Lista BlockMeta de todas as linhas referenceable em um corpo.
pub fn list_blocks(body: &str) -> Vec<BlockMeta>

// Garante que todas as linhas referenceable tenham um ^id. Retorna body modificado.
pub fn ensure_block_ids(body: &str) -> String
```

### O que é uma "linha referenceable"

`list_blocks` e `ensure_block_ids` reconhecem linhas referenceable como aquelas que:
- Não são linhas vazias
- Não são delimitadores de bloco fenced (` ``` `)
- Não são separadores horizontais (`---`, `***`)
- Não são cabeçalhos (`# ...`)
- Não são linhas de tabela (`| ... |`)

Cada linha referenceable recebe um `^id` sufixado ao final se ainda não tiver um.

### Formato de saída do `serialize_note`

```
---
uid: "550e8400-e29b-41d4-a716-446655440000"
title: "Minha Nota"
tags:
  - rust
  - dev
created: "2024-01-15T10:30:00Z"
modified: "2024-01-15T14:00:00Z"
chave-custom: valor
---

Conteúdo da nota em Markdown.
```

---

## Appearance

**Arquivo:** `core/src/appearance.rs`

```rust
pub struct AppearanceFile {
    pub name: String,   // nome sem extensão, ex: "meu-tema"
    pub path: String,   // caminho relativo ao vault, ex: ".ruas/themes/meu-tema.css"
}

pub struct AppearanceList {
    pub themes:   Vec<AppearanceFile>,   // arquivos em .ruas/themes/
    pub snippets: Vec<AppearanceFile>,   // arquivos em .ruas/snippets/
}

pub struct AppearanceConfig {
    pub user_theme:       Option<String>,   // nome do tema ativo (None = padrão)
    pub enabled_snippets: Vec<String>,       // nomes dos snippets habilitados
}
```

### Funções públicas

```rust
// Lista temas e snippets disponíveis no vault.
pub fn list_appearance(vault: &Path) -> AppearanceList

// Lê o conteúdo CSS de um arquivo de tema/snippet.
pub fn read_appearance_css(vault: &Path, path: &str) -> Result<String, String>

// Remove @import remotos e url() remotos de CSS fornecido pelo usuário.
// Defesa em profundidade contra CSS malicioso.
pub fn sanitize_user_css(css: &str) -> String

// Lê .ruas/appearance.json (cria com padrão se não existir).
pub fn read_config(vault: &Path) -> AppearanceConfig

// Grava .ruas/appearance.json.
pub fn write_config(vault: &Path, config: &AppearanceConfig) -> Result<(), String>
```

**`sanitize_user_css`** remove:
- `@import url(...)` e `@import "..."` com URLs remotas
- `url(http://...)` e `url(https://...)` em propriedades CSS
