# Sistema de Módulos do Core

O sistema de módulos é o ponto de extensão central do Ruas. Todo domínio (Contacts, Notes, Agenda, etc.) é um módulo que implementa o trait `Module` de `ruas_core`.

**Arquivo principal:** `core/src/module.rs`

---

## Trait `Module`

```rust
pub trait Module: Send + Sync { ... }
```

| Método | Assinatura | Obrigatório | Propósito |
|---|---|---|---|
| `info` | `&self -> &ModuleInfo` | Sim | Identidade do módulo (id, nome, versão) |
| `capabilities` | `&self -> &[Capability]` | Não | Recursos que o módulo precisa acessar |
| `settings_schema` | `&self -> &[SettingField]` | Não | Campos configuráveis exibidos na UI de settings |
| `commands` | `&self -> &[CommandDescriptor]` | Não | Manifesto de comandos (documentação e menus) |
| `dispatch` | `(&str, Value, &VaultContext) -> DispatchResult` | Não | Handler de comandos |
| `on_vault_open` | `(&VaultContext) -> Result<(), String>` | Não | Lifecycle: vault aberto (criar dirs, indexar, migrar) |
| `on_vault_close` | `(&VaultContext)` | Não | Lifecycle: vault fechado (flush, fechar conexões) |
| `on_event` | `(&ModuleEvent, &VaultContext)` | Não | Reage a eventos de outros módulos |

**Contrato importante:**
- `info()` e `capabilities()` devem ser puros e baratos (sem I/O).
- Lifecycle hooks nunca devem fazer `panic!` — retorne `Err` em caso de falha.
- `dispatch()` recebe JSON e retorna JSON, mantendo a interface agnóstica de transport.

---

## `ModuleInfo`

```rust
pub struct ModuleInfo {
    pub id: String,        // ex: "ruas.contacts" — reverse-domain, único globalmente
    pub name: String,      // ex: "Contacts"
    pub version: Version,
    pub description: String,
}
```

**Convenção de ID:** módulos built-in usam `"ruas.*"`. Plugins de terceiros **não devem** usar este namespace.

## `Version`

```rust
pub struct Version { pub major: u32, pub minor: u32, pub patch: u32 }

// Construção:
Version::new(0, 1, 0)

// Display: "0.1.0"
```

---

## `Capability` e `TrustLevel`

```rust
pub enum Capability {
    VaultRead,        // leitura de arquivos no vault
    VaultWrite,       // escrita de arquivos no vault
    IndexRead,        // consultas no SQLite (search, backlinks)
    IndexWrite,       // upsert/remove no SQLite
    CrossModuleRead,  // leitura de dados de outros módulos
    Network,          // acesso à rede
}

pub enum TrustLevel {
    Core,   // built-in: todas as capabilities são pré-aprovadas automaticamente
    Plugin, // plugin externo: capabilities aprovadas individualmente pelo usuário
}
```

| Capability | O que libera |
|---|---|
| `VaultRead` | `std::fs::read` em arquivos dentro de `ctx.vault_path` |
| `VaultWrite` | `std::fs::write/remove` dentro de `ctx.vault_path` |
| `IndexRead` | `ctx.index().search(...)`, `backlinks(...)`, `path_for_uid(...)` |
| `IndexWrite` | `ctx.index().upsert(...)`, `remove(...)`, `set_links(...)` |
| `CrossModuleRead` | Leitura de dados de outros módulos via registry |
| `Network` | Chamadas de rede (JMAP, IMAP, etc.) |

**Enforcement:** módulos `Core` são sempre confiáveis (sem verificação). Para módulos `Plugin`, o registry checa se cada capability declarada está na lista `approved` do `RegistryEntry`.

---

## `VaultContext`

```rust
pub struct VaultContext<'a> {
    pub vault_path: &'a Path,
    pub events: &'a dyn EventSink,
    // index: privado
}
```

Métodos públicos:

```rust
// Acesso ao índice SQLite. Retorna None em testes sem vault.
pub fn index(&self) -> Option<&IndexManager>

// Configurações persistidas deste módulo (lê/escreve .ruas/modules/<id>/config.json).
pub fn settings(&self, module_id: &str) -> ModuleSettings
```

**Regra:** `VaultContext` é sempre criado pelo registry (via `make_ctx`). Nunca construa diretamente em código de transport (Tauri/HTTP). Em testes, use `VaultContext::new(path, &NoopSink)`.

---

## `ModuleRegistry`

```rust
pub struct ModuleRegistry {
    entries: Vec<RegistryEntry>,
    index: Option<Arc<IndexManager>>,
}
```

### API pública

| Método | Descrição |
|---|---|
| `new()` | Cria registry vazio |
| `register(module)` | Registra módulo built-in (TrustLevel::Core, todas as capabilities aprovadas) |
| `get(id)` | Busca módulo por ID |
| `entries()` | Lista todos os entries (com trust e capabilities aprovadas) |
| `dispatch(module_id, command, args, vault_path)` | Despacha comando para um módulo |
| `on_vault_open(vault_path)` | Abre índice + chama `on_vault_open` em todos os módulos |
| `on_vault_close(vault_path)` | Chama `on_vault_close` em todos os módulos + fecha índice |
| `emit(event, vault_path)` | Broadcast de `ModuleEvent` para todos os módulos |
| `index()` | Acesso ao índice ativo |
| `index_arc()` | Clone do `Arc<IndexManager>` (para threads do watcher) |

### Fluxo de `dispatch`

```
ModuleRegistry::dispatch(module_id, command, args, vault_path)
  1. Localiza entry pelo module_id → Err se não encontrado
  2. check_capabilities(entry)    → Err se violação (só Plugin)
  3. BufferedSink::new()          → sink para capturar eventos emitidos
  4. make_ctx(vault_path, &sink)  → monta VaultContext com índice
  5. entry.module.dispatch(command, args, &ctx)
  6. flush_events(sink.drain())   → re-despacha eventos coletados para todos os módulos
  7. Retorna Ok(Value)
```

A separação entre etapas 5 e 6 garante que eventos disparados durante o dispatch só chegam aos outros módulos **depois** que o dispatch original terminou, evitando re-entância.

---

## Sistema de eventos

### `ModuleEvent`

```rust
#[non_exhaustive]
pub enum ModuleEvent {
    // Lifecycle
    VaultOpened,
    VaultClosed,
    // Filesystem
    FileCreated  { path: String },
    FileModified { path: String },
    FileDeleted  { path: String },
    // Contacts
    ContactSaved   { uid: String },
    ContactDeleted { uid: String },
    // Notes
    NoteSaved   { uid: String },
    NoteDeleted { uid: String },
}
```

O atributo `#[non_exhaustive]` significa que novos variantes podem ser adicionados sem quebrar `match` em código externo (use `_ => {}` no default).

### `EventSink` e implementações

```rust
pub trait EventSink: Send + Sync {
    fn emit(&self, event: ModuleEvent);
}

pub struct NoopSink;          // descarta todos os eventos (testes)
pub struct BufferedSink;      // acumula eventos, drenados via drain()
```

Em produção o registry usa `BufferedSink`. Código de teste usa `NoopSink`.

---

## `CommandDescriptor` / `ParamDescriptor`

```rust
pub struct CommandDescriptor {
    pub name: String,
    pub label_key: String,        // chave i18n para o label
    pub description_key: String,  // chave i18n para a descrição
    pub params: Vec<ParamDescriptor>,
}

pub struct ParamDescriptor {
    pub name: String,
    pub kind: ParamKind,
    pub required: bool,
    pub description_key: String,
}

pub enum ParamKind { String, Number, Boolean, Json }
```

Esses descritores são **informativos** (usados pela UI para menus e help text). A validação dos args é responsabilidade do método `dispatch` do módulo.

---

## `ModuleSettings`

```rust
pub struct ModuleSettings { config_path: PathBuf }
```

Path de storage: `<vault>/.ruas/modules/<sanitized-module-id>/config.json`

| Método | Descrição |
|---|---|
| `for_module(vault_path, module_id)` | Construtor (usa `ctx.settings(id)` em vez de chamar direto) |
| `get(key)` | Lê valor de uma chave (retorna `None` se ausente) |
| `set(key, value)` | Salva uma chave (Value = serde_json::Value) |
| `get_all()` | Retorna todas as configurações como `Value` (objeto JSON) |
| `set_all(values)` | Substitui toda a configuração |

`get_all` e `set_all` são úteis para a UI de settings que lida com o schema completo de uma vez.

---

## `SettingField` e `SettingKind`

```rust
pub struct SettingField {
    pub key: &'static str,
    pub label_key: &'static str,
    pub description_key: Option<&'static str>,
    pub kind: SettingKind,
    pub default: Value,
    pub required: bool,
}

pub enum SettingKind {
    Text,
    Password,
    Toggle,
    Url,
    Number { min: Option<f64>, max: Option<f64> },
    Select { options: Vec<SelectOption> },
}

pub struct SelectOption {
    pub value: &'static str,
    pub label_key: &'static str,
}
```

---

## Padrões de teste

```rust
// Módulo stub mínimo para testes
struct StubModule(ModuleInfo);
impl Module for StubModule {
    fn info(&self) -> &ModuleInfo { &self.0 }
}

// VaultContext em teste (sem índice)
let dir = tempdir().unwrap();
let sink = NoopSink;
let ctx = VaultContext::new(dir.path(), &sink);

// Índice in-memory (veja index.rs para o padrão)
let conn = Connection::open_in_memory().unwrap();
```
