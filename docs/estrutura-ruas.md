# Estrutura do projeto ruas

O projeto é um monorepo unificado.

## Decisão

Em vez de manter dois repositórios separados com um diretório container, o diretório raiz tornou-se o repositório git principal (monorepo), movendo o conteúdo do antigo `ruas/ruas/` para a raiz e o `ruas-cmtables/` para `packages/ruas-cmtables/`.

## Estrutura final

```
ruas/                          ← monorepo root (git)
├── .github/workflows/
│   ├── ci.yml                 ← CI unificado (Rust + JS + E2E)
│   ├── demo.yml               ← Deploy demo do ruas-cmtables (GitHub Pages)
│   └── publish.yml            ← Publicação do ruas-cmtables no npm
├── .reasonix/                 ← Skills e memória do Reasonix
├── CLAUDE.md                  ← Instruções para IA (único, sem duplicação)
├── .gitignore
├── Cargo.toml                 ← Rust workspace (core, api, frontend/src-tauri)
├── Cargo.lock
├── rust-toolchain.toml
├── core/                      ← ruas_core: lógica de negócio compartilhada
├── api/                       ← ruas_api: HTTP API (Actix-web)
├── frontend/                  ← Astro + SolidJS (pnpm)
│   ├── package.json           ← dependência link:../packages/ruas-cmtables
│   └── src-tauri/             ← Tauri shell crate
├── packages/
│   └── ruas-cmtables/         ← Fork do codemirror-markdown-tables (pnpm)
└── docs/                      ← Documentação do projeto
```

## CI/CD

CI unificado em `.github/workflows/ci.yml`:

| Job | O que faz |
|---|---|
| `rust` | `cargo test -p ruas_core`, `cargo check -p ruas_api`, clippy |
| `js` | ruas-cmtables: lint → build → test; frontend: Vitest |
| `e2e` | Playwright (depende de rust + js) |

Workflows auxiliares:
- `demo.yml`: build e deploy do demo do ruas-cmtables no GitHub Pages (dispara com `paths: packages/ruas-cmtables/**`)
- `publish.yml`: publica ruas-cmtables no npm (dispara em release)

## Como foi feita a migração

1. Converter `ruas-cmtables` de npm para pnpm (`pnpm install`, gerar `pnpm-lock.yaml`)
2. Mover `ruas/*` para a raiz
3. Mover `ruas-cmtables/` para `packages/ruas-cmtables/`
4. Ajustar `link:` no `frontend/package.json` de `../../ruas-cmtables` para `../packages/ruas-cmtables`
5. `git init` na raiz e commit inicial
6. Remover `.github/workflows/` antigos dos subdiretórios (agora unificados na raiz)
