# Ruas — Documentação para Desenvolvedores

Ruas é um workspace de produtividade orientado a Markdown (Contatos, Agenda, Calendário, Notas, E-mail, Projetos), cross-platform e self-hosted. Do ponto de vista de desenvolvedor: o **sistema de arquivos é a fonte da verdade** (arquivos `.md`), o **SQLite é apenas um índice de busca** reconstituível, e toda funcionalidade é empacotada em **módulos** com um contrato uniforme.

---

## Pré-requisitos

| Requisito | Versão mínima | Notas |
|---|---|---|
| Rust | Edition 2024 (rustup stable) | `cargo build` na raiz do workspace |
| pnpm | ≥ 9 | usado no diretório `frontend/` |
| Tauri CLI | ≥ 2.6 | `cargo install tauri-cli` |
| Node.js | ≥ 20 | pnpm precisa de Node |
| Sistema | Linux, macOS ou Windows | Android via cross-compile |

## Comandos rápidos

```bash
# Rust — rodar da raiz do workspace
cargo build                   # compila todos os crates
cargo test                    # roda todos os testes
cargo test -p ruas_core       # testa apenas o core
cargo run -p ruas_api         # inicia a API web (127.0.0.1:8080)
cargo clippy -- -D warnings   # lint

# Desktop (Tauri + Astro) — rodar de frontend/
cd frontend
pnpm tauri dev    # inicia servidor Astro (4321) + janela Tauri
pnpm tauri build  # bundle de produção
pnpm dev          # apenas Astro, sem janela Tauri
```

---

## Navegação pela documentação

| Arquivo | Quando ler |
|---|---|
| [01-architecture.md](01-architecture.md) | Primeira leitura obrigatória — visão geral do sistema |
| [02-core-module-system.md](02-core-module-system.md) | Antes de criar qualquer módulo novo |
| [03-core-index.md](03-core-index.md) | Ao implementar busca ou backlinks |
| [04-core-data-model.md](04-core-data-model.md) | Referência de todos os tipos de domínio (Vault, Contacts, Notes, Appearance) |
| [05-tauri-shell.md](05-tauri-shell.md) | Ao adicionar Tauri commands ou entender o ciclo de vida do vault |
| [06-http-api.md](06-http-api.md) | Ao usar a API REST (frontend web, testes de integração) |
| [07-frontend-workspace.md](07-frontend-workspace.md) | Ao mexer no layout multi-painel ou navegação de tabs |
| [08-frontend-stores.md](08-frontend-stores.md) | Referência de estado reativo do frontend |
| [09-frontend-editor.md](09-frontend-editor.md) | Ao trabalhar no editor CodeMirror 6 ou na renderização Markdown |
| [10-i18n.md](10-i18n.md) | Ao adicionar strings de UI ou novos idiomas |
| [11-styling.md](11-styling.md) | Ao criar ou modificar componentes visuais |
| [12-howto-new-module.md](12-howto-new-module.md) | Guia passo a passo para novo módulo backend |
| [13-howto-new-ui-view.md](13-howto-new-ui-view.md) | Guia passo a passo para nova view no workspace |
| [14-filename-strategy.md](14-filename-strategy.md) | Nomes de arquivo por título, sanitização, rename guard, fluxo completo |
| [15-finances-module.md](15-finances-module.md) | Módulo de finanças — contas, transações, validação e linking com contatos |

Documentação adicional:
- [../theming.md](../theming.md) — guia de temas e snippets CSS (foco no usuário)
- [../locale.md](../locale.md) — sistema de localização e NLP de agenda (planejado)

---

## Glossário

| Termo | Definição |
|---|---|
| **vault** | Diretório raiz de dados do usuário. Contém os arquivos `.md` e o subdiretório `.ruas/`. |
| **módulo** | Unidade de funcionalidade que implementa o trait `Module` do `ruas_core`. Exemplos: `ContactsModule`, `NotesModule`. |
| **panel** | Área de conteúdo retangular dentro do workspace. Cada panel tem uma barra de tabs. |
| **tab** | Aba dentro de um panel. Pode ser _preview_ (itálico, substituível) ou _permanente_. |
| **preview tab** | Tab aberta por single-click; é reutilizada/substituída na próxima navegação. Promovida a permanente ao editar. |
| **ruas:// URI** | Formato `ruas://entity/[UUID]` para links internos. O índice SQLite mapeia UUID → caminho em disco. |
| **FTS5** | Extensão de full-text search do SQLite, usada como motor de busca do índice. |
| **VaultContext** | Struct passada a todo dispatch de módulo; fornece `vault_path`, `events` e acesso ao índice. |
| **TabContent** | Union type TypeScript que identifica o tipo de conteúdo de uma tab (ex: `note-detail`, `contact-detail`). |
| **WorkspaceNode** | Nó na árvore binária de layout: `LeafNode` (panel) ou `SplitNode` (divisão horizontal/vertical). |
