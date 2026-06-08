# Arquitetura do Sistema

## Dependências entre crates

```
┌─────────────────────────────────────────────────────┐
│                    ruas_core                        │
│  (lógica de negócio pura, sem I/O de rede)          │
│  crate-type: staticlib + cdylib + rlib              │
└──────────────────┬────────────────┬─────────────────┘
                   │                │
       ┌───────────▼──────┐  ┌──────▼────────────────────┐
       │    ruas_api      │  │  frontend/src-tauri        │
       │  (Actix-web)     │  │  (Tauri shell)             │
       │  REST HTTP API   │  │  Tauri commands + watcher  │
       └──────────────────┘  └───────────────────────────┘
                                        │
                              ┌─────────▼──────────┐
                              │  frontend/src/      │
                              │  Astro + SolidJS    │
                              │  (UI universal)     │
                              └────────────────────┘
```

**Regra de dependência**: somente `ruas_core` é compartilhado. Nem `ruas_api` nem o shell Tauri dependem um do outro.

---

## Modelo em três camadas

| Camada | Componentes | Responsabilidade |
|---|---|---|
| **Core** | `ruas_core` | Lógica de domínio pura: parsing, serialização, módulos, índice SQLite |
| **Transport** | `ruas_api`, `frontend/src-tauri` | Expõe o core via REST ou Tauri IPC; gerencia ciclo de vida do vault |
| **UI** | `frontend/src/` | Shell Astro + islands SolidJS; consome transport via `invoke()` |

---

## Princípio: filesystem como fonte da verdade

Os arquivos `.md` em disco são **a fonte canônica** de todos os dados. O SQLite em `.ruas/index.db` é um **cache de busca/listagem** derivado desses arquivos:

- Se o índice for apagado ou corrompido, `on_vault_open` dos módulos o reconstrói varrendo o disco.
- Nunca armazene dados no índice que não existam no arquivo `.md` correspondente.
- Ao escrever (save), sempre grave o arquivo `.md` primeiro; o índice é atualizado em seguida via `upsert`.

---

## Protocolo `ruas://`

Links internos usam o formato `ruas://entity/[UUID]` em vez de caminhos de arquivo. Isso permite mover ou renomear arquivos sem quebrar links.

```
ruas://note/550e8400-e29b-41d4-a716-446655440000
ruas://contact/7c9e6679-7425-40de-944b-e07fc1f90ae7
```

Resolução: `IndexManager::path_for_uid(uid)` consulta `SELECT path FROM files WHERE uid = ?`.

---

## Layout do vault em disco

```
<vault>/
├── .ruas/
│   ├── config.json               ← VaultConfig { name, created }
│   ├── index.db                  ← SQLite: FTS5 + UUID→path + links
│   ├── modules/
│   │   ├── ruas.contacts/
│   │   │   └── config.json       ← ModuleSettings do módulo contacts
│   │   └── ruas.notes/
│   │       └── config.json
│   ├── themes/
│   │   └── meu-tema.css          ← temas CSS do usuário
│   └── snippets/
│       └── meu-snippet.css       ← snippets CSS do usuário
├── contacts/
│   ├── fulano-de-tal.md          ← contato em formato vCard+Markdown
│   └── ...
└── notes/                        ← notas (subdiretórios livres)
    ├── projeto-x/
    │   └── ideia.md
    └── diario.md
```

---

## Sequência de startup

```
1. frontend carrega → App.tsx chama get_active_vault
2. Shell Tauri: load_last_vault(<app_config_dir>/last_vault.json)
3.   → validate_vault(vault_path) → lê .ruas/config.json
4.   → registry.on_vault_open(vault_path)
5.     → IndexManager::open(vault_path)  [cria index.db se não existir, roda migrate()]
6.     → para cada módulo registrado:
7.         módulo.on_vault_open(ctx)  [cria dirs, indexa arquivos existentes]
8.     → registry emite ModuleEvent::VaultOpened a todos os módulos
9.   → inicia file watcher (notify::RecommendedWatcher sobre o vault)
10.  → retorna VaultInfo { path, name } ao frontend
11. frontend: setActiveVault(info) → renderiza shell principal
12. frontend: loadVaultAppearance() → aplica tema e snippets
```

Se não houver last_vault.json, o frontend exibe `VaultScreen` para o usuário criar ou abrir um vault.

---

## Fluxo de dados end-to-end: `list_contacts`

```
1. ContactsList.tsx
     → invoke("list_contacts")                        [utils/api.ts]

2. utils/api.ts
     → isTauri() ? tauriInvoke(...) : httpInvoke(...)

── Caminho Tauri ──────────────────────────────────────────────
3. frontend/src-tauri/src/contacts.rs
     → list_contacts(state, registry)
     → dispatch(vault_state, registry, "list", json!({}))

4. ModuleRegistry::dispatch("ruas.contacts", "list", {}, vault_path)
     → check_capabilities(entry)    [VaultRead: OK]
     → BufferedSink::new()
     → ContactsModule::dispatch("list", {}, ctx)
     → ContactsModule::cmd_list(ctx)
     → lê arquivos .md em <vault>/contacts/
     → retorna Vec<ContactMeta> como serde_json::Value

5. registry: flush_events(sink.drain(), vault_path)
     → sem eventos neste caso

6. Retorna Ok(Value) → Tauri serializa como JSON

── Caminho HTTP ───────────────────────────────────────────────
3. POST /list_contacts  →  api/src/contacts.rs::list_contacts()
     → lê $HOME/ruas/contacts/*.md diretamente (sem registry)
     → retorna Vec<ContactMeta> como JSON

── Continuação comum ──────────────────────────────────────────
7. ContactsList.tsx: contacts resource atualiza → SolidJS re-renderiza lista
```

---

## Módulos planejados

Os módulos abaixo ainda não foram implementados. Quando implementados, seguirão o mesmo padrão de `ContactsModule`/`NotesModule`:

| ID | Módulo | Status |
|---|---|---|
| `ruas.contacts` | Contatos vCard+MD | Implementado |
| `ruas.notes` | Notas Markdown | Implementado |
| `ruas.agenda` | Agenda / tarefas | Planejado |
| `ruas.calendar` | Calendário | Planejado |
| `ruas.projects` | Projetos Kanban | Planejado |
| `ruas.email` | E-mail JMAP/IMAP | Planejado |
