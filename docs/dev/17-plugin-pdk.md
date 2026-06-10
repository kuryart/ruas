# Plugin Development Kit (PDK) — Ruas

Este documento define o contrato que um plugin WASM deve implementar para rodar no Ruas. Plugins são executados via [Extism](https://extism.org/), um runtime WASM com suporte a múltiplas linguagens.

## Estrutura de um plugin

```
meu-plugin/
├── manifest.json    # metadados (id, nome, versão, capabilities)
└── plugin.wasm      # binário WASM compilado
```

### `manifest.json`

```json
{
  "id": "com.exemplo.meu-plugin",
  "name": "Meu Plugin",
  "version": { "major": 1, "minor": 0, "patch": 0 },
  "description": "Faz algo útil.",
  "author": "seu-nome",
  "capabilities": ["VaultRead", "IndexRead"],
  "min_app_version": { "major": 0, "minor": 2, "patch": 0 }
}
```

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | string | Identificador reverse-domain (ex: `com.github.user.plugin`). **Não use o namespace `ruas.*`.** |
| `name` | string | Nome amigável |
| `version` | `{major, minor, patch}` | Versão semântica |
| `description` | string | Descrição curta |
| `author` | string (opcional) | Autor |
| `capabilities` | `string[]` | Permissões requisitadas |
| `entry_point` | string (opcional) | Caminho relativo ao `.wasm` (padrão: `plugin.wasm`) |
| `min_app_version` | object (opcional) | Versão mínima do Ruas |

## Funções exportadas (contrato WASM)

Toda comunicação é via **JSON**. O plugin exporta estas funções, cada uma recebendo uma string JSON e retornando uma string JSON:

### `info() → String`

Retorna metadados do plugin (deve bater com `manifest.json`):

```json
{
  "id": "com.exemplo.meu-plugin",
  "name": "Meu Plugin",
  "version": "1.0.0",
  "description": "Faz algo útil"
}
```

### `capabilities() → String`

Retorna a lista de capabilities requisitadas:

```json
["VaultRead", "IndexRead"]
```

### `dispatch(command: String, args: String, vault_path: String) → String`

Handler de comandos. `args` contém `{"command": "...", "args": {...}, "vault_path": "..."}`.

Retorna:
- Sucesso: `{"ok": <qualquer JSON>}`
- Erro: `{"err": "mensagem de erro"}`

### `on_vault_open(vault_path: String) → String`

Chamado quando o vault é aberto. Retorna `""` para sucesso ou `{"err": "..."}`.

### `on_vault_close(vault_path: String) → String`

Chamado quando o vault é fechado. Retorno ignorado.

### `on_event(event: String) → String`

Recebe eventos do sistema. `event` é um JSON com `{"event": "{...}", "vault_path": "..."}`.

## Funções do host (disponíveis para o plugin)

O Ruas fornece estas funções para o plugin chamar:

### `host_log(level: String, message: String)`

Registra uma mensagem de log. Levels: `"error"`, `"warn"`, `"info"`, `"debug"`.

### `host_get_config(key: String, vault_path: String) → String`

Lê uma configuração persistida do plugin. Retorna o valor como string JSON (ex: `"valor"`, `"42"`, `null`).

## Capabilities

| Capability | Descrição |
|---|---|
| `VaultRead` | Ler arquivos `.md` e metadados do vault |
| `VaultWrite` | Escrever/criar/remover arquivos `.md` no vault |
| `IndexRead` | Consultar o índice SQLite (busca full-text, backlinks) |
| `IndexWrite` | Modificar o índice SQLite |
| `CrossModuleRead` | Ler dados publicados por outros módulos |
| `Network` | Acesso à rede (sempre requer aprovação explícita do usuário) |

## Exemplo: plugin mínimo em Rust

```rust
use extism_pdk::*;
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
struct Info {
    id: String,
    name: String,
    version: String,
    description: String,
}

#[plugin_fn]
pub fn info() -> FnResult<Json<Info>> {
    Ok(Json(Info {
        id: "com.exemplo.hello".into(),
        name: "Hello".into(),
        version: "0.1.0".into(),
        description: "Plugin de exemplo".into(),
    }))
}

fn capabilities() -> FnResult<Json<Vec<String>>> {
    Ok(Json(vec![]))
}

#[derive(Deserialize)]
struct DispatchInput {
    command: String,
    args: serde_json::Value,
    vault_path: String,
}

#[derive(Serialize)]
struct DispatchOutput {
    ok: Option<serde_json::Value>,
    err: Option<String>,
}

#[plugin_fn]
pub fn dispatch(input: String) -> FnResult<Json<DispatchOutput>> {
    let input: DispatchInput = serde_json::from_str(&input)?;
    match input.command.as_str() {
        "ping" => Ok(Json(DispatchOutput { ok: Some(serde_json::json!("pong")), err: None })),
        _ => Ok(Json(DispatchOutput { ok: None, err: Some(format!("unknown command: {}", input.command)) })),
    }
}

#[plugin_fn]
pub fn on_vault_open(vault_path: String) -> FnResult<String> {
    // Inicialização
    Ok(String::new())
}

#[plugin_fn]
pub fn on_vault_close(_vault_path: String) -> FnResult<()> {
    Ok(())
}

#[plugin_fn]
pub fn on_event(_input: String) -> FnResult<()> {
    Ok(())
}
```

## Empacotando o plugin

```bash
# Rust
cargo build --target wasm32-unknown-unknown --release
cp target/wasm32-unknown-unknown/release/meu_plugin.wasm plugin.wasm

# Go
tinygo build -o plugin.wasm -target wasi main.go
```

Copie `plugin.wasm` e `manifest.json` para `<vault>/.ruas/plugins/<plugin-id>/`.
