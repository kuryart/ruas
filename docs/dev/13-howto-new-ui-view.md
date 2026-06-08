# Como Criar uma Nova View no Workspace

Este guia segue o padrão dos módulos de Contatos e Notas. Todos os 6 passos são obrigatórios para uma integração completa.

**Exemplo fictício:** módulo `bookmarks`.

---

## Passo 1 — Estender `TabContent` em `workspaceStore.ts`

**Arquivo:** `frontend/src/components/workspace/workspaceStore.ts`

```typescript
// Adicione os novos variantes ao union type TabContent:
type TabContent =
  | { type: 'contacts-list' }
  | { type: 'contact-detail'; contactPath: string }
  | { type: 'notes-list' }
  | { type: 'note-detail'; notePath: string }
  | { type: 'placeholder'; module: string }
  // ↓ Adicione aqui:
  | { type: 'bookmarks-list' }
  | { type: 'bookmark-detail'; bookmarkPath: string }
```

---

## Passo 2 — Adicionar navigation helpers em `workspaceStore.ts`

Copie exatamente o padrão de notas (`navigateToNote`, `openNotePermanent`, etc.) e adapte para o novo módulo:

```typescript
// Preview tab (single-click)
export function navigateToBookmark(path: string, title: string, panelId?: string): void {
  const pid = panelId ?? focusedPanelId()
  const tab: Tab = { id: nanoid(), title, content: { type: 'bookmark-detail', bookmarkPath: path }, preview: true }
  // 1. Existe aba permanente com esse path? → ativa
  // 2. Existe aba preview? → substitui in-place
  // 3. Senão → cria nova aba preview
  // Registra no navStacks (veja padrão de navigateToNote)
}

// Aba permanente (Ctrl/Cmd-click)
export function openBookmarkPermanent(path: string, title: string): void { ... }

// Promove preview para permanente ao iniciar edição
export function promoteBookmarkPreviewByPath(path: string): void { ... }

// Sincroniza título da aba ao renomear
export function updateBookmarkTabTitle(path: string, title: string): void { ... }

// Abre a lista de bookmarks
export function openBookmarksList(panelId?: string): void {
  const pid = panelId ?? focusedPanelId()
  // Verifica se já existe aba de lista → ativa; senão cria
  openTab(pid, { id: nanoid(), title: 'Bookmarks', content: { type: 'bookmarks-list' } })
}
```

---

## Passo 3 — Criar os componentes

### `BookmarksList.tsx`

**Arquivo:** `frontend/src/components/bookmarks/BookmarksList.tsx`

Estrutura mínima:

```tsx
import { createResource, createSignal, For } from 'solid-js'
import { invoke } from '../../utils/api'
import { navigateToBookmark, openBookmarkPermanent } from '../workspace/workspaceStore'
import { useI18n } from '../../i18n/context'
import { pushHistory } from '../../stores/historyStore'

export function BookmarksList() {
  const { t } = useI18n()
  const [query, setQuery] = createSignal('')
  const [bookmarks, { refetch }] = createResource(() => invoke<BookmarkMeta[]>('list_bookmarks'))

  const filtered = () => {
    const q = query().toLowerCase()
    return (bookmarks() ?? []).filter(b =>
      !q || b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)
    )
  }

  async function createBookmark() {
    const bookmark = await invoke<Bookmark>('create_bookmark', { title: 'Novo Bookmark', url: '' })
    await refetch()
    openBookmarkPermanent(bookmark.path, bookmark.frontmatter.title)
    // Registre undo/redo se necessário
  }

  return (
    <div class="left-panel">
      <div class="left-panel-header">
        <span>{t('bookmarks-header')}</span>
        <button onClick={createBookmark} title={t('bookmarks-new-btn-title')}>+</button>
      </div>
      <input
        class="list-search"
        placeholder={t('bookmarks-search-placeholder')}
        value={query()}
        onInput={e => setQuery(e.currentTarget.value)}
      />
      <div class="left-panel-body">
        <For each={filtered()}>
          {(b) => (
            <button
              class="note-list-item"  // reutilize classe existente ou crie nova
              onClick={e => e.ctrlKey || e.metaKey
                ? openBookmarkPermanent(b.path, b.title)
                : navigateToBookmark(b.path, b.title)
              }
            >
              <span class="truncate">{b.title}</span>
              <span class="subtext truncate">{b.url}</span>
            </button>
          )}
        </For>
      </div>
    </div>
  )
}
```

### `BookmarkDetail.tsx`

**Arquivo:** `frontend/src/components/bookmarks/BookmarkDetail.tsx`

Padrão de auto-save e promoção de preview:

```tsx
import { createResource, createSignal, onCleanup, createEffect } from 'solid-js'
import { invoke } from '../../utils/api'
import { promoteBookmarkPreviewByPath, updateBookmarkTabTitle } from '../workspace/workspaceStore'

export function BookmarkDetail(props: { path: string }) {
  const [bookmark, { refetch }] = createResource(() => props.path, path =>
    invoke<Bookmark>('read_bookmark', { path })
  )

  const [title, setTitle] = createSignal('')
  const [url, setUrl] = createSignal('')
  const [saveStatus, setSaveStatus] = createSignal<'saved'|'unsaved'|'saving'|'error'>('saved')
  let saveTimer: ReturnType<typeof setTimeout>
  let promoted = false

  // Popula ao carregar
  createEffect(() => {
    const b = bookmark()
    if (!b) return
    setTitle(b.frontmatter.title)
    setUrl(b.frontmatter.url)
    setSaveStatus('saved')
    promoted = false
  })

  // Salva ao sair
  onCleanup(() => {
    clearTimeout(saveTimer)
    if (saveStatus() === 'unsaved') saveNow()
  })

  function promoteOnce() {
    if (!promoted) {
      promoted = true
      promoteBookmarkPreviewByPath(props.path)
    }
  }

  async function saveNow() {
    setSaveStatus('saving')
    try {
      await invoke('save_bookmark', {
        bookmark: {
          path: props.path,
          frontmatter: { ...bookmark()!.frontmatter, title: title(), url: url(), modified: new Date().toISOString() },
          body: bookmark()!.body,
        }
      })
      setSaveStatus('saved')
    } catch {
      setSaveStatus('error')
    }
  }

  function scheduleSave() {
    setSaveStatus('unsaved')
    clearTimeout(saveTimer)
    saveTimer = setTimeout(saveNow, 800)
  }

  function onTitleChange(value: string) {
    promoteOnce()
    setTitle(value)
    updateBookmarkTabTitle(props.path, value)
    scheduleSave()
  }

  return (
    <div class="panel">
      <input
        class="note-title-input"
        value={title()}
        onInput={e => onTitleChange(e.currentTarget.value)}
        placeholder="Título"
      />
      <input
        class="inline-input"
        value={url()}
        onInput={e => { promoteOnce(); setUrl(e.currentTarget.value); scheduleSave() }}
        placeholder="URL"
      />
      {/* ... outros campos ... */}
      <div class="status-bar">
        <span style={{ color: saveStatus() === 'saved' ? 'var(--green)' : 'var(--yellow)' }}>
          {saveStatus()}
        </span>
      </div>
    </div>
  )
}
```

---

## Passo 4 — Registrar em `PanelView.tsx`

**Arquivo:** `frontend/src/components/workspace/PanelView.tsx`

```tsx
import { BookmarksList } from '../bookmarks/BookmarksList'
import { BookmarkDetail } from '../bookmarks/BookmarkDetail'

// Na função tabIcon():
case 'bookmarks-list':
case 'bookmark-detail':
  return <IconBookmark />   // crie ou reutilize ícone SVG

// No componente TabContent():
<Match when={tab.content.type === 'bookmarks-list'}>
  <BookmarksList />
</Match>
<Match when={tab.content.type === 'bookmark-detail'}>
  <BookmarkDetail path={(tab.content as BookmarkDetailContent).bookmarkPath} />
</Match>
```

---

## Passo 5 — Wiring no `Sidebar.tsx`

**Arquivo:** `frontend/src/components/Sidebar.tsx`

```typescript
// Adicione o ícone SVG:
const icons = {
  // ... existentes ...
  bookmarks: `<svg ...>...</svg>`,
}

// Adicione ao array de módulos:
const MODULE_IDS = ['contacts', 'agenda', 'calendar', 'notes', 'email', 'projects', 'bookmarks']

// Se quiser no drawer esquerdo (lista persistente):
const DRAWER_MODULES = new Set(['notes', 'contacts', 'bookmarks'])

// Se preferir abrir no workspace (sem drawer):
// handleOpen já chama openModule() automaticamente para módulos fora de DRAWER_MODULES
```

Adicione também em `LeftPanel.tsx` se o módulo usa o drawer esquerdo:

```typescript
const BODIES: Record<string, Component> = {
  notes: NotesList,
  contacts: ContactsList,
  bookmarks: BookmarksList,  // ← adicione aqui
}
```

---

## Passo 6 — Strings i18n

Crie os arquivos `.ftl` mínimos (veja [10-i18n.md](10-i18n.md#chaves-mínimas-por-módulo)):

**`locales/pt-BR/bookmarks.ftl`:**
```fluent
bookmarks-header = Favoritos
bookmarks-new-btn-title = Novo favorito
bookmarks-search-placeholder = Buscar favoritos...
bookmarks-loading = Carregando...
bookmarks-empty = Nenhum favorito ainda.
bookmarks-no-results = Nenhum resultado encontrado.
bookmark-status-saved = Salvo
bookmark-status-unsaved = Não salvo
bookmark-status-saving = Salvando...
bookmark-status-error = Erro ao salvar
```

**`locales/en-US/bookmarks.ftl`:** versão em inglês correspondente.

Importe em `i18n/context.tsx` (veja [10-i18n.md](10-i18n.md)).

---

## Itens adicionais opcionais

### Integração com o painel direito

Se o detalhe do módulo precisa de TOC ou backlinks:

```typescript
// Em BookmarkDetail.tsx, ao montar:
setActiveNote({ path: props.path, onJump: () => {} })
onCleanup(() => clearActiveNote(props.path))
setActiveNoteBody(bookmark()?.body ?? '')
```

### Undo/redo de criação

```typescript
// Em BookmarksList.tsx, após criar:
pushHistory({
  description: `Criar favorito: ${bookmark.frontmatter.title}`,
  async undo() {
    await invoke('delete_bookmark', { path: bookmark.path })
    refetch()
  },
  async redo() {
    // re-cria ou abre o backup
  },
})
```

### Barra de status com save status

O padrão de cores para `saveStatus`:

```typescript
const statusColor = {
  saved:   'var(--green)',
  unsaved: 'var(--yellow)',
  saving:  'var(--subtext)',
  error:   'var(--red)',
}
```

---

## Checklist de integração completa

- [ ] `TabContent` estendido com os novos tipos
- [ ] Navigation helpers adicionados em `workspaceStore.ts`
- [ ] `<Module>List.tsx` criado com busca, criação e single/ctrl-click
- [ ] `<Module>Detail.tsx` criado com auto-save (debounce ~800ms) e `promoteOnce`
- [ ] Ambos registrados em `PanelView.tsx` (tabIcon + TabContent switch)
- [ ] Botão adicionado em `Sidebar.tsx` (+ ícone SVG)
- [ ] Adicionado a `DRAWER_MODULES` ou chamando `openModule()` conforme preferência
- [ ] Adicionado a `BODIES` em `LeftPanel.tsx` se usa drawer
- [ ] Arquivos `.ftl` criados para pt-BR e en-US
- [ ] `.ftl` importados em `context.tsx`
