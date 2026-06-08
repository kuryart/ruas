# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Ruas** (Rapid Universal Annotation System / Rust + Astro) is a cross-platform, privacy-first, self-hosted productivity app covering Contacts, Agenda, Calendar, Projects, Notes, Finances, and Email — all oriented around Markdown.

## Repository structure (monorepo)

```
.
├── Cargo.toml              ← Rust workspace root
├── core/                   ← ruas_core: shared business logic
├── api/                    ← ruas_api: Actix-web HTTP API
├── frontend/               ← Astro + SolidJS UI (pnpm)
│   ├── src                 ← Frontend components, etc.
│   └── src-tauri/          ← Tauri shell crate
├── packages/
│   └── ruas-cmtables/      ← codemirror-markdown-tables (fork, pnpm)
├── docs/                   ← Project documentation
└── .github/workflows/      ← Unified CI (Rust + JS + E2E)
```

## Commands

All commands run from the repo root unless noted.

### Rust (workspace)
```bash
cargo build                     # build all workspace members
cargo test                      # run all tests (core unit + integration)
cargo test -p ruas_core         # test a specific crate
cargo test -p ruas_api          # test the HTTP API crate
cargo test -p Ruas              # test the Tauri shell crate
cargo run -p ruas_api           # run the web API (listens on 127.0.0.1:8080)
cargo clippy -- -D warnings     # lint (correctness/suspicious are deny; perf/style are warn)
```

### Desktop app (Tauri + Astro)
```bash
cd frontend
pnpm tauri dev      # starts Astro dev server (port 4321) + Tauri window
pnpm tauri build    # production bundle
pnpm dev            # Astro only (no Tauri window)
pnpm test           # Vitest unit tests
pnpm test:e2e       # Playwright E2E tests
```

### ruas-cmtables (CodeMirror Markdown tables extension)
```bash
cd packages/ruas-cmtables
pnpm dev            # dev server (Vite)
pnpm build          # build library dist/
pnpm build:demo     # build demo page
pnpm test           # Vitest tests
pnpm lint:ci        # lint (prettier + eslint)
```

## Architecture

The Rust workspace has three crates with a strict dependency rule: **only `core` is shared**.

```
core/  (ruas_core)       ← shared business logic, compiled as staticlib/cdylib/rlib
api/   (ruas_api)        ← Actix-web HTTP API, depends on core
frontend/src-tauri/      ← Tauri shell (desktop/mobile), depends on core
frontend/src/            ← Astro + SolidJS UI
```

The frontend depends on `packages/ruas-cmtables/` (fork of codemirror-markdown-tables) via a pnpm `link:` dependency for interactive Markdown table editing.

**Data flow for a feature:**
1. Implement logic in `core/src/` and expose it publicly.
2. For the desktop app: wrap it as a `#[tauri::command]` in `frontend/src-tauri/src/lib.rs` and register it in the `tauri::generate_handler![]` macro.
3. For the web API: add an Actix-web handler in `api/src/main.rs`.
4. Call from the frontend via `invoke(cmd, args)` from `utils/api.ts` — never import Tauri or `PlatformProxy` directly.

### Key architectural decisions

- **SQLite as indexer**: The file system (`.md` files) is the source of truth. SQLite is a read/search index rebuilt from the file system, not the primary store. FTS5 virtual tables power full-text search.
- **`ruas://` protocol**: Links use `ruas://entity/[UUID]` (not file paths). SQLite maps UUIDs to disk paths, so files can be renamed or moved without breaking internal links.
- **Email**: JMAP/IMAP → SQLite cache for search; `.eml` files created on demand when linking emails to notes. Email HTML must be sanitized (`ammonia`) and rendered in a sandboxed `<iframe>` to prevent tracker/script execution via the Tauri bridge.
- **Plugins**: WASM for core logic (runs inside the Core container), JS for UI components only.
- **Sync** (Pro): State-based sync with E2EE; conflicts produce a `note.conflicted.md` sibling file (last-write-wins).
- **Graph edges are typed**: `Mentions`, `DependsOn`, `Origin`, `BelongsTo` — model these explicitly, not as generic links.
- **Module system** (`core/src/module.rs`): All functionality is packaged as `Module` trait implementations registered in `ModuleRegistry`. Tauri and HTTP layers dispatch through the generic `invoke_module` command — thin typed commands (e.g. `contacts::list_contacts`) are convenience wrappers.
- **Finances module** (planned): Accounts and transactions stored as `.md` files. Account balance in frontmatter; transaction amount and linked account references in frontmatter. Both are markdown entities. The system must validate transactions (e.g. credit ≥ debit, accounts exist) and handle external file changes or raw-mode edits gracefully — stale or broken references should surface as warnings, not corrupt the index or the vault. See `docs/dev/15-finances-module.md`.

### Tauri devUrl
Tauri's `beforeDevCommand` is `pnpm dev`, and it expects Astro at `http://localhost:4321`. Running `pnpm tauri dev` handles both automatically. The `tauri.conf.json` defines this contract.

## Frontend architecture (`frontend/src/`)

The UI is **Astro + SolidJS**. Astro owns the shell (`pages/index.astro`, `layouts/Layout.astro`); all interactive code is SolidJS islands.

### Transport abstraction
`utils/api.ts` exports a single `invoke<T>(cmd, args)` that routes to Tauri IPC (`@tauri-apps/api/core`) when `window.__TAURI_INTERNALS__` is present, or to HTTP fetch (POST to the endpoint matching the command name) otherwise. Also exports `openExternal(url)` for opening browser/tabs. Always import from `utils/api.ts`; never call Tauri or `PlatformProxy` directly. (`utils/PlatformProxy.ts` is legacy — do not use or extend it.)

### Workspace / panel system (`components/workspace/workspaceStore.ts`)
The multi-panel layout is a binary tree of splits. Key types:
- `WorkspaceNode` — either a `LeafNode` (holds a `panelId`) or a `SplitNode` (direction + ratio + two children).
- `Panel` — has an ordered `tabs: Tab[]` and an `activeTabId`.
- `TabContent` — discriminated union; add a new variant here when creating a new module view.

**Preview tab protocol** (Obsidian-style): single-click navigation reuses/replaces the current preview tab (shown in italics); Ctrl-click or the user starting to edit promotes the tab to permanent. Implement this same pattern for any new navigable entity.

### Adding a new module view (checklist)
1. Add `type: 'module-name-list'` and `type: 'module-name-detail'` variants to `TabContent` in `components/workspace/workspaceStore.ts`.
2. Add `navigateTo<Entity>` / `open<Entity>Permanent` helpers in `workspaceStore.ts` (copy contacts pattern).
3. Create `components/<module>/` with `<Module>List.tsx` and `<Module>Detail.tsx`.
4. Register both in `PanelView.tsx`'s `TabContent` switch.
5. Wire the sidebar button in `Sidebar.tsx` (`handleOpen` switch).
6. Add i18n keys to `locales/en-US/<module>.ftl` and `locales/pt-BR/<module>.ftl`, then import them in `i18n/context.tsx`.

### i18n
Fluent (`.ftl` files under `src/locales/<locale>/`). One file per module. Access via `const { t } = useI18n()` from `i18n/context.tsx`. Supported locales: `en-US`, `pt-BR`.

### Styling
All colors come from CSS custom properties defined in `styles/global.css` (Catppuccin Mocha palette). Use `var(--base)`, `var(--mantle)`, `var(--surface0/1/2)`, `var(--text)`, `var(--subtext)`, `var(--muted)`, `var(--accent)`, etc. Never hardcode color values. Layout sizes: `--sidebar-w: 48px`, `--tabbar-h: 36px`, `--radius: 6px`.

## Documentation

Every feature implementation must be documented in `docs/dev/`. The index is at `docs/dev/00-index.md`. Existing documents: architecture (01), module system (02), core index (03), data model (04), Tauri shell (05), HTTP API (06), workspace/panels (07), stores (08), editor (09), i18n (10), styling (11), how-to new module (12), how-to new UI view (13), filename strategy (14), finances module (15).

**When to create a new document:** any non-trivial feature that adds a new system, pattern, or constraint a future developer would need to understand. Name it with the next available two-digit prefix (e.g. `15-feature-name.md`) and add it to `00-index.md`.

**When to update an existing document:** any change that affects an already-documented system (e.g. adding a command to the module system, changing a store contract, adding a new CSS variable).

## Testing

Every feature must ship with tests. Use the appropriate tier:

- **Unit (Rust)** — pure functions with no I/O, in `#[cfg(test)] mod tests` at the bottom of the source file. Use `proptest` for round-trip invariants on parse/serialize functions.
- **Integration (Rust)** — full command pipeline through `ModuleRegistry` against a `TempDir` vault, in `core/tests/integration.rs`.
- **Unit (TypeScript)** — pure utility functions and store logic, colocated as `*.test.ts` alongside the source file, run with `pnpm test` (Vitest).
- **E2E** — critical user-facing flows in `frontend/e2e/*.spec.ts`, run with `pnpm test:e2e` (Playwright). Mock all API calls via `page.route()`; no real backend required. Add shared mock helpers to `frontend/e2e/mock-api.ts`.

CI runs all tiers on every push: `rust` (cargo test + clippy), `js` (ruas-cmtables lint/build/test + frontend Vitest), and `e2e` (Playwright). All tests must pass before merging. See `.github/workflows/ci.yml` for details.

## Conventions

- **Rust edition**: `core/` and `api/` use edition 2024; `frontend/src-tauri/` uses edition 2021. Pin via `rust-toolchain.toml` (stable channel, rustfmt + clippy + rust-analyzer components).
- **Rust style**: `// ── Section headers ──` comments; `#[derive(Debug, Clone, Serialize, Deserialize)]` on data types; `serde(rename = "...")` for field name mapping; `Result<T, String>` for Tauri command returns.
- **Frontend style**: `// ── Section headers ──` comments mirror the Rust convention; SolidJS `createStore`/`createSignal` for reactive state; `batch()` for grouped updates.
- **Module pattern**: Every business domain (contacts, notes, etc.) gets a `*Module` struct implementing the `Module` trait in `core/src/module.rs`, registered in `ModuleRegistry`. Tauri commands are thin wrappers around registry dispatch.
- **Never** import from `@tauri-apps/api/core` directly in UI code — always use `utils/api.ts`.
- **Never** hardcode color values — always use CSS custom properties from `styles/global.css`.

## Notes

<!-- Stub: add quick-reference notes here as the project evolves. -->
