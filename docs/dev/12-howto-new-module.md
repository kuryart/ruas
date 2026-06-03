# Como Criar um Novo Módulo Backend

Este guia usa `ruas.contacts` e `ruas.notes` como referência. Adapte os nomes para o seu módulo.

**Exemplo fictício:** módulo `ruas.bookmarks` para favoritos.

---

## Passo 1 — Criar `core/src/<módulo>.rs`

### 1.1 Structs de domínio

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookmarkFrontmatter {
    pub uid:     Option<String>,
    pub title:   String,
    pub url:     String,
    pub tags:    Vec<String>,
    pub created: Option<String>,
    pub modified: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bookmark {
    pub path: String,
    pub frontmatter: BookmarkFrontmatter,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookmarkMeta {
    pub path: String,
    pub title: String,
    pub url: String,
    pub tags: Option<Vec<String>>,
}
```

### 1.2 Funções de parsing e serialização

```rust
pub fn parse_bookmark(path: &str, content: &str) -> Result<Bookmark, String> {
    let (fm, body) = split_frontmatter(content)?;
    Ok(Bookmark { path: path.to_string(), frontmatter: fm, body })
}

pub fn serialize_bookmark(fm: &BookmarkFrontmatter, body: &str) -> Result<String, String> {
    let yaml = serde_yaml::to_string(fm)
        .map_err(|e| format!("serialize error: {e}"))?;
    Ok(format!("---\n{yaml}---\n\n{body}"))
}

pub fn bookmark_to_meta(b: &Bookmark) -> BookmarkMeta {
    BookmarkMeta {
        path: b.path.clone(),
        title: b.frontmatter.title.clone(),
        url: b.frontmatter.url.clone(),
        tags: if b.frontmatter.tags.is_empty() { None } else { Some(b.frontmatter.tags.clone()) },
    }
}
```

### 1.3 Struct do módulo com impl `Module`

```rust
use crate::module::*;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub struct BookmarksModule {
    info: ModuleInfo,
    commands: Vec<CommandDescriptor>,
}

impl Default for BookmarksModule {
    fn default() -> Self {
        Self {
            info: ModuleInfo {
                id: "ruas.bookmarks".to_string(),
                name: "Bookmarks".to_string(),
                version: Version::new(0, 1, 0),
                description: "Favoritos em Markdown".to_string(),
            },
            commands: vec![
                // Declare seus comandos aqui
            ],
        }
    }
}

impl BookmarksModule {
    fn bookmarks_dir(&self, ctx: &VaultContext) -> PathBuf {
        ctx.vault_path.join("bookmarks")
    }

    fn cmd_list(&self, ctx: &VaultContext) -> DispatchResult {
        let dir = self.bookmarks_dir(ctx);
        // lê arquivos .md, retorna Vec<BookmarkMeta>
        todo!()
    }

    fn cmd_create(&self, title: String, url: String, ctx: &VaultContext) -> DispatchResult {
        // cria arquivo .md, atualiza índice, emite evento
        todo!()
    }

    fn index_bookmark_file(&self, path: &Path, ctx: &VaultContext) {
        if let Some(idx) = ctx.index() {
            // lê arquivo, faz upsert no índice
            todo!()
        }
    }
}

impl Module for BookmarksModule {
    fn info(&self) -> &ModuleInfo { &self.info }

    fn capabilities(&self) -> &[Capability] {
        &[Capability::VaultRead, Capability::VaultWrite,
          Capability::IndexRead, Capability::IndexWrite]
    }

    fn commands(&self) -> &[CommandDescriptor] { &self.commands }

    fn dispatch(&self, command: &str, args: Value, ctx: &VaultContext<'_>) -> DispatchResult {
        match command {
            "list"   => self.cmd_list(ctx),
            "create" => {
                let title = args["title"].as_str().ok_or("missing title")?.to_string();
                let url   = args["url"].as_str().ok_or("missing url")?.to_string();
                self.cmd_create(title, url, ctx)
            }
            _ => Err(format!("Unknown command: {command}")),
        }
    }

    fn on_vault_open(&self, ctx: &VaultContext<'_>) -> Result<(), String> {
        std::fs::create_dir_all(self.bookmarks_dir(ctx))
            .map_err(|e| format!("bookmarks: cannot create dir: {e}"))?;
        // Indexa arquivos existentes
        for entry in std::fs::read_dir(self.bookmarks_dir(ctx)).unwrap_or_else(|_| todo!()) {
            if let Ok(e) = entry {
                self.index_bookmark_file(&e.path(), ctx);
            }
        }
        Ok(())
    }

    fn on_event(&self, event: &ModuleEvent, ctx: &VaultContext<'_>) {
        match event {
            ModuleEvent::FileCreated { path } | ModuleEvent::FileModified { path } => {
                let p = Path::new(path);
                if p.starts_with(self.bookmarks_dir(ctx)) && p.extension() == Some("md".as_ref()) {
                    self.index_bookmark_file(p, ctx);
                }
            }
            ModuleEvent::FileDeleted { path } => {
                if let Some(idx) = ctx.index() {
                    let _ = idx.remove(path);
                }
            }
            _ => {}
        }
    }
}
```

---

## Passo 2 — Re-exportar de `core/src/lib.rs`

```rust
pub mod bookmarks;
pub use bookmarks::{Bookmark, BookmarkMeta, BookmarksModule, parse_bookmark, serialize_bookmark};
```

---

## Passo 3 — Registrar em `build_registry()` (Tauri shell)

Em `frontend/src-tauri/src/lib.rs`:

```rust
fn build_registry() -> ModuleRegistry {
    let mut registry = ModuleRegistry::new();
    registry.register(ContactsModule::default());
    registry.register(NotesModule::default());
    registry.register(BookmarksModule::default());  // ← adicione aqui
    registry
}
```

---

## Passo 4 — Typed Tauri commands

Crie `frontend/src-tauri/src/bookmarks.rs`:

```rust
use ruas_core::{Bookmark, BookmarkMeta};
use crate::vault::{VaultState, get_vault_path};
use crate::RegistryState;
use serde_json::json;
use tauri::State;

fn dispatch(
    vault_state: &State<VaultState>,
    registry: &State<RegistryState>,
    command: &str,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let vault_path = get_vault_path(vault_state)?;
    let reg = registry.0.lock().unwrap();
    reg.dispatch("ruas.bookmarks", command, args, &vault_path)
}

#[tauri::command]
pub fn list_bookmarks(
    state: State<VaultState>,
    registry: State<RegistryState>,
) -> Result<Vec<BookmarkMeta>, String> {
    let val = dispatch(&state, &registry, "list", json!({}))?;
    serde_json::from_value(val).map_err(|e| e.to_string())
}

// ... outros commands (create, save, delete, read)
```

Em `lib.rs`, adicione ao `invoke_handler!`:

```rust
bookmarks::list_bookmarks,
// ...
```

---

## Passo 5 — HTTP handlers

Crie `api/src/bookmarks.rs` seguindo o padrão de `api/src/contacts.rs`. Registre em `api/src/main.rs`:

```rust
.service(web::resource("/list_bookmarks").to(bookmarks::list_bookmarks))
```

---

## Passo 6 — Integração com o índice

Em `on_vault_open`, indexe todos os arquivos existentes:

```rust
fn index_bookmark_file(&self, path: &Path, ctx: &VaultContext) {
    let Ok(content) = std::fs::read_to_string(path) else { return };
    let Ok(bookmark) = parse_bookmark(&path.to_string_lossy(), &content) else { return };
    if let Some(idx) = ctx.index() {
        let _ = idx.upsert(
            &path.to_string_lossy(),
            bookmark.frontmatter.uid.as_deref(),
            "bookmark",
            Some(&bookmark.frontmatter.title),
            &bookmark.body,
        );
    }
}
```

Em `cmd_create`/`cmd_save`, após gravar o arquivo:

```rust
self.index_bookmark_file(Path::new(&bookmark.path), ctx);
ctx.events.emit(ModuleEvent::BookmarkSaved { uid: bookmark.frontmatter.uid.unwrap_or_default() });
// Nota: adicione BookmarkSaved ao enum ModuleEvent em core/src/module/event.rs
```

Em `cmd_delete`:

```rust
if let Some(idx) = ctx.index() {
    idx.remove(&path)?;
}
std::fs::remove_file(&path).map_err(|e| e.to_string())?;
ctx.events.emit(ModuleEvent::BookmarkDeleted { uid });
```

---

## Passo 7 — Settings do módulo

Se o módulo tem configurações:

```rust
fn settings_schema(&self) -> &[SettingField] {
    &[
        SettingField {
            key: "default_tags",
            label_key: "bookmarks-setting-default-tags",
            description_key: Some("bookmarks-setting-default-tags-desc"),
            kind: SettingKind::Text,
            default: serde_json::Value::String("".to_string()),
            required: false,
        },
    ]
}
```

Para ler/escrever no dispatch:

```rust
let settings = ctx.settings(self.info().id.as_str());
let default_tags = settings.get("default_tags")
    .and_then(|v| v.as_str().map(String::from))
    .unwrap_or_default();
```

---

## Passo 8 — Arquivos i18n

Crie:
- `frontend/src/locales/pt-BR/bookmarks.ftl`
- `frontend/src/locales/en-US/bookmarks.ftl`

Importe em `frontend/src/i18n/context.tsx` (veja [10-i18n.md](10-i18n.md)).

---

## Passo 9 — Testes

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::module::{NoopSink, VaultContext};
    use tempfile::TempDir;

    fn make_ctx(dir: &TempDir) -> (NoopSink, VaultContext) {
        let sink = NoopSink;
        let ctx = VaultContext::new(dir.path(), &sink);
        (sink, ctx)
    }

    #[test]
    fn test_on_vault_open_creates_dir() {
        let dir = TempDir::new().unwrap();
        let module = BookmarksModule::default();
        let sink = NoopSink;
        let ctx = VaultContext::new(dir.path(), &sink);
        module.on_vault_open(&ctx).unwrap();
        assert!(dir.path().join("bookmarks").is_dir());
    }

    #[test]
    fn test_dispatch_list_empty() {
        let dir = TempDir::new().unwrap();
        let module = BookmarksModule::default();
        let sink = NoopSink;
        let ctx = VaultContext::new(dir.path(), &sink);
        module.on_vault_open(&ctx).unwrap();
        let result = module.dispatch("list", serde_json::json!({}), &ctx).unwrap();
        assert_eq!(result, serde_json::json!([]));
    }
}
```

---

## Matriz de capabilities por módulo

| Módulo | VaultRead | VaultWrite | IndexRead | IndexWrite | Network |
|---|---|---|---|---|---|
| `ruas.contacts` | Sim | Sim | Sim | Sim | Não |
| `ruas.notes` | Sim | Sim | Sim | Sim | Não |
| `ruas.bookmarks` (exemplo) | Sim | Sim | Sim | Sim | Não |
| Email (planejado) | Sim | Sim | Sim | Sim | Sim |

---

## Contrato de `DispatchResult`

```rust
pub type DispatchResult = Result<serde_json::Value, String>;
```

- `Ok(Value)` em qualquer sucesso — o transporte (Tauri/HTTP) serializa como JSON
- `Err(String)` para erros — o Tauri serializa a string como exception message no JS
- **Nunca** faça `panic!` em dispatch — sempre retorne `Err`
- Erros de validação de argumento → `Err("campo X obrigatório".to_string())`
- Erros de I/O → `Err(e.to_string())`
