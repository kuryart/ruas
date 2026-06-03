# API HTTP (`ruas_api`)

A API HTTP é uma interface alternativa ao Tauri IPC. É usada principalmente em:
- Frontend web rodando no browser sem Tauri
- Testes de integração via `curl` ou cliente HTTP

**Arquivo:** `api/src/main.rs` + `api/src/contacts.rs` + `api/src/notes.rs`

---

## Configuração

| Parâmetro | Valor |
|---|---|
| Bind address | `0.0.0.0:8080` |
| CORS allowed origin | `$RUAS_FRONTEND_URL` (default: `http://localhost:4321`) |
| CORS methods | POST, GET, OPTIONS |
| CORS headers | Authorization, Accept, Content-Type |
| Data root (contacts) | `$HOME/ruas/contacts/` |
| Data root (notes) | `$HOME/ruas/` |

**Diferença importante em relação ao Tauri:** a API HTTP usa `$HOME/ruas` como raiz fixa. O Tauri usa o `vault_path` selecionado pelo usuário. Isso significa que não há suporte a múltiplos vaults na API HTTP.

---

## Endpoints

Todos os endpoints usam `POST` com body JSON (`Content-Type: application/json`).

### Contatos

| Endpoint | Body | Resposta |
|---|---|---|
| `POST /list_contacts` | `{}` | `Vec<ContactMeta>` |
| `POST /read_contact` | `{ "path": "contacts/joao.md" }` | `Contact` |
| `POST /save_contact` | `{ "contact": { Contact } }` | `Contact` |
| `POST /create_contact` | `{ "given_name": "João", "family_name": "Silva" }` | `Contact` |
| `POST /delete_contact` | `{ "path": "contacts/joao.md" }` | `{}` |

### Notas

| Endpoint | Body | Resposta |
|---|---|---|
| `POST /list_notes` | `{}` | `Vec<NoteMeta>` |
| `POST /read_note` | `{ "path": "notes/diario.md" }` | `Note` |
| `POST /save_note` | `{ "note": { Note } }` | `Note` |
| `POST /create_note` | `{ "title": "Nova Nota" }` | `Note` |
| `POST /delete_note` | `{ "path": "notes/diario.md" }` | `{}` |
| `POST /search_notes` | `{ "query": "rust" }` | `Vec<NoteMeta>` |
| `POST /list_blocks` | `{ "path": "notes/diario.md" }` | `Vec<BlockMeta>` |
| `POST /get_backlinks` | `{ "path": "notes/diario.md" }` | `Vec<BacklinkMeta>` |
| `POST /list_notes_tree` | `{}` | `Vec<NoteTreeNode>` |

### Appearance

| Endpoint | Body | Resposta |
|---|---|---|
| `POST /list_appearance` | `{}` | `AppearanceList` |
| `POST /read_appearance_css` | `{ "path": ".ruas/themes/meu-tema.css" }` | `String` (CSS) |
| `POST /get_appearance_config` | `{}` | `AppearanceConfig` |
| `POST /set_appearance_config` | `{ "config": { AppearanceConfig } }` | `{}` |

---

## Formato de erro

Respostas de erro retornam status HTTP não-2xx com corpo em texto plano:

```
HTTP/1.1 500 Internal Server Error
Content-Type: text/plain

Contact file not found: contacts/joao.md
```

---

## Diferenças em relação ao Tauri

| Aspecto | Tauri | HTTP API |
|---|---|---|
| Seleção de vault | Qualquer caminho via `open_vault` | Fixo em `$HOME/ruas` |
| Module registry | Sim (dispatch via registry) | Não (handlers diretos) |
| SQLite / FTS5 | Sim (via IndexManager) | Parcial: backlinks usam filesystem scan |
| `search_notes` | Usa `IndexManager::search_entity` | Usa `search_notes_in_dir` (filesystem) |
| `get_backlinks` | Usa `IndexManager::backlinks` | Usa `find_backlinks_in_dir` (filesystem) |
| Múltiplos vaults | Sim | Não |

A API HTTP é deliberadamente mais simples. Para funcionalidades completas (busca FTS5, múltiplos vaults, file watcher), use o Tauri.

---

## Exemplo de uso com curl

```bash
# Listar contatos
curl -s -X POST http://localhost:8080/list_contacts \
  -H "Content-Type: application/json" \
  -d '{}' | jq .

# Criar nota
curl -s -X POST http://localhost:8080/create_note \
  -H "Content-Type: application/json" \
  -d '{"title": "Teste"}' | jq .

# Buscar notas
curl -s -X POST http://localhost:8080/search_notes \
  -H "Content-Type: application/json" \
  -d '{"query": "projeto*"}' | jq .
```
