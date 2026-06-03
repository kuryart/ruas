# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Ruas** (Rapid Universal Annotation System / Rust + Astro) is a cross-platform, privacy-first, self-hosted productivity app covering Contacts, Agenda, Calendar, Projects, Notes, and Email — all oriented around Markdown.

## Commands

All Rust commands run from the repo root unless noted. The frontend uses **pnpm** and commands run from `frontend/`.

### Rust (workspace)
```bash
cargo build                   # build all workspace members
cargo test                    # run all tests
cargo test -p ruas_core     # test a specific crate
cargo run -p ruas_api       # run the web API (listens on 127.0.0.1:8080)
cargo clippy -- -D warnings   # lint
```

### Desktop app (Tauri + Astro)
```bash
cd frontend
pnpm tauri dev    # starts Astro dev server (port 4321) + Tauri window
pnpm tauri build  # production bundle
pnpm dev          # Astro only (no Tauri window)
```

## Architecture

The workspace has three crates with a strict dependency rule: **only `core` is shared**.

```
core/  (ruas_core)       ← shared business logic, compiled as staticlib/cdylib/rlib
api/   (ruas_api)        ← Actix-web HTTP API, depends on core;
frontend/src-tauri/        ← Tauri shell (desktop/mobile), depends on core
frontend/src/              ← Astro + SolidJS UI
```

**Data flow for a feature:**
1. Implement logic in `core/src/` and expose it publicly.
2. For the desktop app: wrap it as a `#[tauri::command]` in `frontend/src-tauri/src/lib.rs` and register it in `invoke_handler`.
3. For the web API: add an Actix-web handler in `api/src/main.rs`.
4. Call from the frontend via `@tauri-apps/api` (desktop) or fetch (web).

### Key architectural decisions

- **SQLite as indexer**: The file system (`.md` files) is the source of truth. SQLite is a read/search index rebuilt from the file system, not the primary store. FTS5 virtual tables power full-text search.
- **`ruas://` protocol**: Links use `ruas://entity/[UUID]` (not file paths). SQLite maps UUIDs to disk paths, so files can be renamed or moved without breaking internal links.
- **Email**: JMAP/IMAP → SQLite cache for search; `.eml` files created on demand when linking emails to notes. Email HTML must be sanitized (`ammonia`) and rendered in a sandboxed `<iframe>` to prevent tracker/script execution via the Tauri bridge.
- **Plugins**: WASM for core logic (runs inside the Core container), JS for UI components only.
- **Sync** (Pro): State-based sync with E2EE; conflicts produce a `note.conflicted.md` sibling file (last-write-wins).
- **Graph edges are typed**: `Mentions`, `DependsOn`, `Origin`, `BelongsTo` — model these explicitly, not as generic links.

### Tauri `devUrl`
Tauri's `beforeDevCommand` is `pnpm dev`, and it expects Astro at `http://localhost:4321`. Running `pnpm tauri dev` handles both automatically.

## Frontend architecture (`frontend/src/`)

The UI is **Astro + SolidJS**. Astro owns the shell (`pages/index.astro`, `layouts/Layout.astro`); all interactive code is SolidJS islands.

### Transport abstraction
`utils/PlatformProxy.ts` → `utils/api.ts` provides a single `invoke(cmd, args)` that routes to Tauri IPC (`@tauri-apps/api/core`) when `window.__TAURI__` is present, or to `ApiClient` (HTTP POST to `ruas_api`) otherwise. Always import from `utils/api.ts`, never call Tauri directly.

### Workspace / panel system (`components/workspace/`)
The multi-panel layout is a binary tree of splits stored in `workspaceStore.ts`. Key types:
- `WorkspaceNode` — either a `LeafNode` (holds a `panelId`) or a `SplitNode` (direction + ratio + two children).
- `Panel` — has an ordered `tabs: Tab[]` and an `activeTabId`.
- `TabContent` — discriminated union; add a new variant here when creating a new module view.

**Preview tab protocol** (Obsidian-style): single-click navigation reuses/replaces the current preview tab (shown in italics); Ctrl-click or the user starting to edit promotes the tab to permanent. Implement this same pattern for any new navigable entity.

### Adding a new module view (checklist)
1. Add `type: 'module-name-list'` and `type: 'module-name-detail'` variants to `TabContent` in `workspaceStore.ts`.
2. Add `navigateTo<Entity>` / `open<Entity>Permanent` helpers in `workspaceStore.ts` (copy contacts pattern).
3. Create `components/<module>/` with `<Module>List.tsx` and `<Module>Detail.tsx`.
4. Register both in `PanelView.tsx`'s `TabContent` switch.
5. Wire the sidebar button in `Sidebar.tsx` (`handleOpen` switch).
6. Add i18n keys to `locales/en-US/<module>.ftl` and `locales/pt-BR/<module>.ftl`.

### i18n
Fluent (`.ftl` files under `src/locales/<locale>/`). One file per module. Access via `const { t } = useI18n()` from `i18n/context.tsx`. Add a new `.ftl` file and import it in `i18n/context.tsx` when adding a module.

### Styling
All colors come from CSS custom properties defined in `styles/global.css` (Catppuccin Mocha palette). Use `var(--base)`, `var(--mantle)`, `var(--surface0/1/2)`, `var(--text)`, `var(--subtext)`, `var(--muted)`, `var(--accent)`, etc. Never hardcode color values. Layout sizes: `--sidebar-w: 48px`, `--tabbar-h: 36px`, `--radius: 6px`.
