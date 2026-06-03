# Stores do Frontend

O estado reativo do frontend SolidJS está organizado em stores independentes, cada um com responsabilidade única.

---

## Referência rápida

| Store | Arquivo | Persiste? | Descrição |
|---|---|---|---|
| `appearanceStore` | `stores/appearanceStore.ts` | localStorage + vault | Tema, accent, font, temas/snippets do vault |
| `blockTargetStore` | `stores/blockTargetStore.ts` | Não | Handoff de scroll para block-ref |
| `fuzzyPopupStore` | `stores/fuzzyPopupStore.ts` | Não | Estado do popup fuzzy (wiki-links, slash, block-ref) |
| `historyStore` | `stores/historyStore.ts` | Não | Pilhas de undo/redo |
| `layoutStore` | `stores/layoutStore.ts` | localStorage | Painel esquerdo, painel direito, nota ativa |
| `paletteStore` | `stores/paletteStore.ts` | Não | Abertura da command palette (Ctrl+P) |
| `prefsStore` | `stores/prefsStore.ts` | localStorage | Preferências do editor (vim mode) |
| `settingsStore` | `stores/settingsStore.ts` | Não | Abertura do modal de settings |
| `vaultStore` | `stores/vaultStore.ts` | Não | Vault ativo |
| `workspaceStore` | `components/workspace/workspaceStore.ts` | Não | Layout multi-painel e abas |

---

## `appearanceStore`

Gerencia tema visual, fontes e CSS do vault.

```typescript
// Sinais built-in (localStorage: 'ruas.appearance')
theme: Accessor<string>          // ex: "mocha"
setTheme(id: string): void
accent: Accessor<AccentId>
setAccent(id: AccentId): void
font: Accessor<string>
setFont(id: string): void

// Sinais do vault (persistidos em .ruas/appearance.json)
userTheme: Accessor<string | null>      // tema do usuário ativo
enabledSnippets: Accessor<string[]>     // snippets habilitados
availableThemes: Accessor<AppearanceFile[]>
availableSnippets: Accessor<AppearanceFile[]>

// Ações
loadVaultAppearance(): Promise<void>    // chamado após vault open
reloadAppearance(): Promise<void>       // hot-reload (limpa cache CSS)
setUserTheme(name: string | null): Promise<void>
toggleSnippet(name: string, on: boolean): Promise<void>
```

**Cascata de CSS (em ordem de aplicação):**
1. `global.css` — variáveis base (Catppuccin Mocha) e classes de layout
2. `#ruas-builtin` — override de variáveis pelo tema/accent/font selecionados
3. `data-ruas-css="theme:<name>"` — CSS do tema do usuário
4. `data-ruas-css="snippet:<name>"` — um `<style>` por snippet habilitado

**Hot-reload:** o file watcher emite o evento Tauri `appearance-changed` ao salvar um `.css` em `.ruas/themes/` ou `.ruas/snippets/`. O frontend ouve esse evento e chama `reloadAppearance()`.

**Timing:** `loadVaultAppearance()` deve ser chamado após a abertura do vault (`setActiveVault`).

---

## `blockTargetStore`

Handoff para a funcionalidade "abrir nota e rolar até o bloco X".

```typescript
interface BlockTarget { path: string; blockId: string }

pendingBlock: Accessor<BlockTarget | null>
setPendingBlock(target: BlockTarget | null): void
```

**Padrão de uso:**
```typescript
// Em wikiLink.ts ao clicar em [[nota^bloco]]
setPendingBlock({ path: notePath, blockId: 'abc123' })
navigateToNote(notePath, title)

// Em NoteDetail.tsx, ao carregar a nota
createEffect(() => {
  const target = pendingBlock()
  if (target?.path === props.path) {
    setPendingBlock(null)
    scrollToBlock(target.blockId)
  }
})
```

O `setPendingBlock` é chamado **antes** do `navigateToNote` para que `NoteDetail` já encontre o alvo ao montar.

---

## `fuzzyPopupStore`

Estado singleton do popup fuzzy (FuzzyPopup.tsx). Usado por wiki-links, block-refs e slash commands.

```typescript
interface FuzzyItem {
  id: string
  label: string
  sublabel?: string
}

type FuzzySource = 'wiki' | 'blockRef' | 'slash'

interface FuzzyState {
  source: FuzzySource
  items: FuzzyItem[]
  query: string
  anchor: { x: number; y: number }  // posição do cursor no editor
  onSelect(item: FuzzyItem): void
  onClose(): void
}

fuzzyState: Accessor<FuzzyState | null>
isFuzzyOpen(): boolean
openFuzzy(state: FuzzyState): void
patchFuzzy(patch: Partial<FuzzyState>): void
closeFuzzy(): void
```

**Padrão singleton:** apenas um popup pode estar aberto por vez. `openFuzzy` sobrescreve qualquer estado anterior.

---

## `historyStore`

Pilhas de undo/redo para ações do usuário (criação de contato, etc.).

```typescript
interface HistoryCommand {
  description: string
  undo(): void | Promise<void>
  redo(): void | Promise<void>
}

canUndo(): boolean
canRedo(): boolean
undoDescription(): string | undefined
redoDescription(): string | undefined
pushHistory(cmd: HistoryCommand): void
undoLast(): Promise<void>
redoNext(): Promise<void>
```

`pushHistory` limpa a pilha de redo (comportamento padrão de undo/redo).

**Integração em `App.tsx`:** `Ctrl+Z` → `undoLast()`, `Ctrl+Shift+Z` → `redoNext()`. Esses atalhos são ignorados quando o foco está em um `<input>`, `<textarea>` ou no editor CodeMirror 6.

---

## `layoutStore`

Estado do layout de painéis da aplicação (exceto o workspace multi-painel, que fica em `workspaceStore`).

```typescript
// Painel esquerdo (drawer)
leftPanelModule: Accessor<string | null>  // ID do módulo ou null
toggleLeftPanel(id: string): void         // toggle: abre ou fecha o drawer
toggleLeftVisible(): void                 // show/hide preservando o módulo
hideLeftPanel(): void

// Painel direito (TOC/backlinks)
rightVisible: Accessor<boolean>
toggleRight(): void

// Nota ativa (publicada por NoteDetail para o RightPanel)
interface ActiveNote { path: string; onJump(h: Heading): void }
activeNote: Accessor<ActiveNote | null>
setActiveNote(note: ActiveNote | null): void
clearActiveNote(path: string): void  // limpa apenas se o path bater (race-safety)

// Corpo da nota ativa (atualizado live para o TOC)
activeNoteBody: Accessor<string>
setActiveNoteBody(body: string): void
```

**Por que `activeNote` e `activeNoteBody` são sinais separados?** `activeNote` carrega a identidade (path + callback `onJump`) que deve ser estável entre re-renders. `activeNoteBody` muda com cada keystroke. Separar evita que o componente de TOC remonte a cada caractere digitado.

**Persistência:** `leftPanelModule` e `rightVisible` são salvos em localStorage com as chaves `ruas.layout.leftPanel` e `ruas.layout.rightVisible`.

---

## `paletteStore`

```typescript
paletteOpen: Accessor<boolean>
togglePalette(): void
```

Abre/fecha o `CommandPalette`. Ativado por `Ctrl+P` em `App.tsx`.

---

## `prefsStore`

```typescript
vimMode: Accessor<boolean>
setVimMode(value: boolean): void
```

Persistido em `localStorage` com a chave `ruas.editor.prefs`. Quando `vimMode()` é `true`, `EditorPane` carrega a extensão `@replit/codemirror-vim`.

---

## `settingsStore`

```typescript
settingsOpen: Accessor<boolean>
// controle via setSettingsOpen(true/false)
```

Abre/fecha o modal `SettingsModal`.

---

## `vaultStore`

```typescript
interface VaultInfo { path: string; name: string }

activeVault: Accessor<VaultInfo | null>
setActiveVault(info: VaultInfo | null): void
clearVault(): void   // usado pelo botão "Trocar Vault"
```

Quando `activeVault()` é `null`, `App.tsx` exibe `VaultScreen`.
