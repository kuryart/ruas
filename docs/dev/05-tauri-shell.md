# Tauri Shell

O shell Tauri fica em `frontend/src-tauri/src/` e é o ponto de entrada da aplicação desktop. Ele gerencia o ciclo de vida do vault, registra os módulos, expõe Tauri commands ao frontend e mantém o file watcher.

---

## Estado global

Três tipos de estado são gerenciados via `tauri::State`:

```rust
// Módulo registry compartilhado entre todas as Tauri commands.
pub struct RegistryState(Arc<Mutex<ModuleRegistry>>);

// Caminho do vault ativo. None quando nenhum vault está aberto.
pub struct VaultState(pub Mutex<Option<PathBuf>>);

// File watcher ativo. Substituído a cada troca de vault.
pub struct WatcherState(Mutex<Option<notify::RecommendedWatcher>>);
```

---

## `build_registry()`

```rust
fn build_registry() -> ModuleRegistry {
    let mut registry = ModuleRegistry::new();
    registry.register(ContactsModule::default());
    registry.register(NotesModule::default());
    registry
}
```

Para adicionar um novo módulo built-in, inclua `registry.register(SeuModulo::default());` aqui.

---

## Todos os Tauri commands registrados

### Commands genéricos (lib.rs)

| Command | Args | Retorno | Descrição |
|---|---|---|---|
| `invoke_module` | `module_id: String, command: String, args: Value` | `Result<Value, String>` | Despacha para qualquer módulo pelo ID |
| `list_modules` | — | `Value` | JSON com info, comandos e schema de settings de todos os módulos |
| `get_module_settings` | `module_id: String` | `Result<Value, String>` | Lê configurações de um módulo |
| `set_module_settings` | `module_id: String, settings: Value` | `Result<(), String>` | Salva configurações de um módulo |
| `search_index` | `query: String, limit: Option<usize>` | `Result<Vec<SearchResult>, String>` | Busca global no FTS5 |
| `resolve_uid` | `uid: String` | `Result<Option<String>, String>` | Resolve ruas:// UID → caminho |

### Commands de vault (vault.rs)

| Command | Args | Retorno | Descrição |
|---|---|---|---|
| `select_folder` | — | `Result<Option<String>, String>` | Abre dialog nativo de seleção de pasta |
| `new_vault` | `path: String, name: String` | `Result<VaultInfo, String>` | Cria vault + abre |
| `open_vault` | `path: String` | `Result<VaultInfo, String>` | Valida e abre vault existente |
| `get_active_vault` | — | `Option<VaultInfo>` | Retorna vault atual (sem bloquear) |

### Commands de contatos (contacts.rs)

| Command | Args | Retorno |
|---|---|---|
| `list_contacts` | — | `Result<Vec<ContactMeta>, String>` |
| `read_contact` | `path: String` | `Result<Contact, String>` |
| `save_contact` | `contact: Contact` | `Result<(), String>` |
| `create_contact` | `given_name: String, family_name: String` | `Result<Contact, String>` |
| `delete_contact` | `path: String` | `Result<(), String>` |

### Commands de notas (notes.rs)

| Command | Args | Retorno |
|---|---|---|
| `list_notes` | — | `Result<Vec<NoteMeta>, String>` |
| `read_note` | `path: String` | `Result<Note, String>` |
| `search_notes` | `query: String` | `Result<Vec<NoteMeta>, String>` |
| `create_note` | `title: String` | `Result<Note, String>` |
| `save_note` | `note: Note` | `Result<(), String>` |
| `delete_note` | `path: String` | `Result<(), String>` |
| `list_blocks` | `path: String` | `Result<Vec<BlockMeta>, String>` |
| `get_backlinks` | `path: String` | `Result<Vec<BacklinkMeta>, String>` |
| `list_notes_tree` | — | `Result<Vec<NoteTreeNode>, String>` |

### Commands de appearance (appearance.rs)

| Command | Args | Retorno |
|---|---|---|
| `list_appearance` | — | `Result<AppearanceList, String>` |
| `read_appearance_css` | `path: String` | `Result<String, String>` |
| `get_appearance_config` | — | `Result<AppearanceConfig, String>` |
| `set_appearance_config` | `config: AppearanceConfig` | `Result<(), String>` |
| `open_appearance_folder` | `kind: String` | `Result<(), String>` |

`kind` para `open_appearance_folder` é `"themes"` ou `"snippets"`.

---

## `VaultInfo`

```rust
pub struct VaultInfo {
    pub path: String,
    pub name: String,
}
```

---

## Fluxo de ativação do vault (`activate_vault`)

```
activate_vault(app, vault_path, registry, watcher_state)
  1. Para o watcher anterior (se existir): watcher_state.lock() → drop
  2. registry.lock() → on_vault_open(vault_path)
       → IndexManager::open(vault_path)
       → todos os módulos: on_vault_open(ctx)
  3. persist_vault(app, vault_path) → grava last_vault.json
  4. Inicia novo notify::RecommendedWatcher:
       → watch(vault_path, RecursiveMode::Recursive)
       → thread de handler: debounce de eventos, chama handle_fs_event
  5. Armazena watcher em watcher_state
```

**`last_vault.json`** fica em `<tauri_app_config_dir>/last_vault.json`. No Linux é geralmente `~/.config/Ruas/last_vault.json`.

---

## File watcher (`watcher.rs`)

O watcher usa `notify::RecommendedWatcher` (inotify no Linux, FSEvents no macOS, ReadDirectoryChanges no Windows).

**Lógica de despacho de eventos:**

| Arquivo alterado | Ação |
|---|---|
| `*.md` fora de `.ruas/` | `ModuleEvent::FileCreated/Modified/Deleted` → `registry.emit()` |
| `*.css` em `.ruas/themes/` ou `.ruas/snippets/` | Emite evento Tauri `appearance-changed` para o webview |
| Qualquer arquivo em `.ruas/` (exceto themes/snippets) | Ignorado |

Os módulos reagem aos `ModuleEvent::FileCreated/Modified/Deleted` em `on_event` para manter o índice atualizado.

---

## Seed de dados de desenvolvimento

Em builds de debug (`#[cfg(debug_assertions)]`), a função `seed_sample_contacts(vault_path)` em `contacts.rs` cria alguns contatos de exemplo se `<vault>/contacts/` estiver vazio. Não é chamada em builds de produção.
