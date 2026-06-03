# Módulo de Notas — Arquitetura e Implementação Completa

Skill para implementar o módulo de notas do projeto **Ruas** conforme a spec em `.claude/specs/modulo-de-notas.md`. Siga **exatamente** esta ordem de fases. Confirme com o usuário ao concluir cada fase antes de avançar.

---

## Estado atual (já implementado)

| Componente | Arquivo | Status |
|---|---|---|
| `NotesList` | `frontend/src/components/notes/NotesList.tsx` | ✅ |
| `NoteDetail` | `frontend/src/components/notes/NoteDetail.tsx` | ✅ |
| `EditorPane` | `frontend/src/components/notes/EditorPane.tsx` | ✅ CM6 |
| `ViewPane` | `frontend/src/components/notes/ViewPane.tsx` | ✅ marked |
| `catppuccinTheme` | `frontend/src/components/notes/catppuccinTheme.ts` | ✅ |
| `livePreview` | `frontend/src/components/notes/livePreview.ts` | ⚠️ parcial (headings + marks básicos) |
| Tauri commands | `frontend/src-tauri/src/notes.rs` | ✅ CRUD |
| Core module | `core/src/notes.rs` | ✅ parse/serialize/NotesModule |
| i18n | `src/locales/*/notes.ftl` | ✅ |

---

## Arquitetura alvo

```
core/src/
  notes.rs                   ← Note struct + NotesModule (existe)
  notes/
    backlinks.rs             ← índice SQLite: quais UIDs → apontam para → UID atual
    blocks.rs                ← sistema de block-IDs (^id-do-bloco)
    search.rs                ← FTS5 fuzzy search sobre título/tags/body

frontend/src/
  components/notes/
    NotesList.tsx             ← lista + árvore de pastas (expandir)
    NoteDetail.tsx            ← orquestrador 3 painéis (expandir)
    EditorPane.tsx            ← CM6 (expandir extensões)
    ViewPane.tsx              ← marked (expandir)
    catppuccinTheme.ts        ← tema CM6 (existe)
    livePreview.ts            ← live preview (expandir)
    FuzzyPopup.tsx            ← popup reutilizável de fuzzy-find
    FrontmatterEditor.tsx     ← editor visual de YAML/properties
    RightPanel.tsx            ← painel direito (3-dots → TOC | Backlinks)
    TableOfContents.tsx       ← TOC com headings clicáveis
    BacklinksPanel.tsx        ← notas que apontam para a atual

    editor/
      wikiLink.ts             ← extensão CM6 para [[nota]]
      embedRenderer.ts        ← extensão CM6 para ![[nota]]
      blockRef.ts             ← extensão CM6 para [[nota^id]]
      latexRenderer.ts        ← extensão CM6 KaTeX ($…$ e $$…$$)
      mermaidRenderer.ts      ← extensão CM6 blocos ```mermaid
      tableInteraction.ts     ← seleção multi-célula, insert/delete linha/col
      autoPairs.ts            ← fechar automaticamente *, **, [, ", '
      folding.ts              ← folding de headings e listas
      vimMode.ts              ← keybindings Vim via @codemirror/vim
      commandPalette.ts       ← widget Ctrl+P (ou /)

  stores/
    historyStore.ts           ← pilha back/forward de navegação (existe? expandir)
```

### Regra de dependência de fases

```
Fase A (editor) → independente
Fase B (wiki refs) → precisa Fase A (CM6 rodando)
Fase C (LaTeX/Mermaid) → independente de B
Fase D (painéis) → precisa backend (Fase F parcial: search_notes)
Fase E (produtividade) → independente
Fase F (backend) → pode ser feito em paralelo com A-E
Fase G (highlighting) → independente
```

---

## Bibliotecas adicionais necessárias

```bash
cd frontend

# LaTeX e Mermaid
pnpm add katex mermaid

# Vim mode para CM6
pnpm add @codemirror/vim

# Fuzzy search no frontend
pnpm add fuse.js

# Linguagens de sintaxe para CM6 (highlighting extensível)
pnpm add @codemirror/lang-javascript @codemirror/lang-python \
         @codemirror/lang-rust @codemirror/lang-go \
         @codemirror/lang-java @codemirror/lang-cpp \
         @codemirror/lang-html @codemirror/lang-css \
         @codemirror/lang-sql @codemirror/lang-json \
         @codemirror/lang-yaml
```

---

## Fase A — Editor Completo (live preview expandido)

### A1 — Live preview: todos os elementos markdown

Arquivo: `frontend/src/components/notes/livePreview.ts`

O estado atual renderiza headings e esconde `HeaderMark`, `EmphasisMark`, `CodeMark`. Adicionar:

**Nós a tratar fora da linha do cursor (render widget + ocultar markup):**

| Nó Lezer | Comportamento |
|---|---|
| `ATXHeading1`–`ATXHeading6` | Já implementado |
| `BulletList`, `OrderedList` | Ocultar `ListMark` (`-`, `*`, `1.`); renderizar `•` ou número antes do item via widget |
| `HorizontalRule` | Ocultar `---` / `***`; injetar `<hr>` via widget |
| `FencedCode` | Ocultar delimitadores `` ``` ``; renderizar bloco com background `var(--mantle)` |
| `InlineCode` | Ocultar backticks; renderizar com `background: var(--surface0)` |
| `Link` | Ocultar `[text](url)` → mostrar só `text` com cor `var(--accent)` via MarkDecoration |
| `Image` | Ocultar `![alt](src)` → renderizar `<img>` via widget |
| `Blockquote` | Ocultar `>` ; injetar border-left via MarkDecoration na linha |
| `Table` | Ocultar pipes `|`; renderizar `<table>` via widget |
| `StrongEmphasis` | Já via `EmphasisMark`; garantir negrito via MarkDecoration |
| `Emphasis` | Garantir itálico via MarkDecoration |
| `Strikethrough` | Garantir line-through via MarkDecoration |

**Regra central:** Se qualquer character do nó estiver na linha do cursor → mostrar raw. Fora do cursor → decoration.

**Sintaxe avançada** (adicionar ao parser markdown do CM6):

```ts
import { markdown } from '@codemirror/lang-markdown';
import { GFM, Subscript, Superscript, Footnote } from '@lezer/markdown';

markdown({
  extensions: [GFM, Subscript, Superscript, Footnote],
})
```

Adicionar tratamento no live preview para:
- `==highlight==` → `background: var(--yellow)` via MarkDecoration  
- `^superscript^` → `<sup>` via widget
- `~subscript~` → `<sub>` via widget
- `[^1]` footnote → numeração inline + tooltip com texto

### A2 — Tabelas interativas

Arquivo: `frontend/src/components/notes/editor/tableInteraction.ts`

Extensão CM6 que:
1. **Seleção multi-célula**: mousedown + drag detecta células entre `|` delimiters; aplica `SelectionMark` decoration nas células selecionadas
2. **Delete em células selecionadas**: `keymap` captura `Delete`/`Backspace` → limpa conteúdo das células selecionadas
3. **Delete linha completa**: se todas as células de uma linha estão selecionadas → `Delete` → remove a linha do documento
4. **Delete coluna completa**: se todas as células de uma coluna (mesmo índice em todas as linhas) estão selecionadas → `Delete` → remove a coluna
5. **Delete tabela completa**: se todos os cells estão selecionados → `Delete` → remove o bloco `Table`
6. **Botões flutuantes**: `TooltipView` que aparece quando cursor está dentro de `Table`:
   - Ícone `+ row` → insere linha abaixo da atual
   - Ícone `+ col` → insere coluna à direita da atual

### A3 — Auto-closing pairs e wrapping

Arquivo: `frontend/src/components/notes/editor/autoPairs.ts`

Extensão CM6 via `keymap`:

| Trigger | Sem seleção | Com seleção |
|---|---|---|
| `*` | insere `**` move cursor para meio | envolve: `*seleção*` |
| digitado `**` (double) | insere `****` move cursor | envolve: `**seleção**` |
| `[` | insere `[]()` coloca cursor antes de `]` | envolve: `[seleção]()` |
| `"` | insere `""` move cursor | envolve: `"seleção"` |
| `'` | insere `''` move cursor | envolve: `'seleção'` |
| `(` | insere `()` move cursor | envolve: `(seleção)` |

Detectar seleção via `state.selection.main.empty`. Se não-vazia → wrap. Se vazia → insert par.

**Critério A:** Live preview renderiza todos elementos (testar com nota de exemplo completa). Tabelas têm botões flutuantes. Auto-pairs funcionam em seleção e inserção.

---

## Fase B — Sistema de Referências Wiki

### B1 — WikiLink popup (`[[nota]]`)

Arquivo: `frontend/src/components/notes/editor/wikiLink.ts`

Extensão CM6 que:
1. Detecta quando o usuário digita `[[` (via `EditorView.updateListener`)
2. Ao detectar, abre `FuzzyPopup` posicionado na linha do cursor
3. À medida que o usuário digita, filtra a lista via `invoke('search_notes', { query })`
4. Setas ↑↓ navegam; `Enter` ou `Tab` confirma; `Esc` cancela
5. Ao confirmar: substitui `[[texto_digitado]]` por `[[título_da_nota]]`
6. Suporta aliases: `[[nota|alias]]`

Arquivo: `frontend/src/components/notes/FuzzyPopup.tsx`

Componente SolidJS reutilizável:
```tsx
interface FuzzyPopupProps {
  items: Array<{ id: string; label: string; sublabel?: string }>;
  query: string;
  onSelect: (item: { id: string; label: string }) => void;
  onClose: () => void;
  anchor: { x: number; y: number };
}
```
- Usa `fuse.js` para fuzzy matching local na lista recebida
- Renderiza lista com highlight dos caracteres que fazem match
- Posicionado absolutamente relativo ao `anchor`

**Renderização de WikiLinks no ViewPane:**

No `ViewPane.tsx`, pós-parse do `marked`, interceptar links `[[nota]]`:
- Renderizar como `<a class="wiki-link" data-path="...">título</a>`
- Click → `navigateToNote(path, title)`

**Renderização de WikiLinks no livePreview:**

Widget que substitui `[[nota]]` (fora do cursor) por `<span class="wiki-link">título</span>` com cor `var(--accent)`.

### B2 — Embeds (`![[nota]]`)

Arquivo: `frontend/src/components/notes/editor/embedRenderer.ts`

Extensão CM6 que:
1. Detecta nós `![[caminho]]` no syntax tree (ou via regex se lezer não tiver suporte nativo)
2. Fora do cursor: substitui por `EmbedWidget` que:
   - Para `.md`: chama `invoke('read_note', { path })` e renderiza o body via `marked.parse()` num `<div class="embed-note">`
   - Para imagens (`.png`, `.jpg`, `.svg`): renderiza `<img>`
   - Para PDF: renderiza `<iframe>` com `src="asset://..."`
3. Fuzzy popup ao digitar `![[` idêntico ao B1

Estilos `.embed-note` em `global.css`:
```css
.embed-note {
  border: 1px solid var(--surface1);
  border-radius: var(--radius);
  padding: 12px 16px;
  margin: 8px 0;
  background: var(--mantle);
}
.embed-note::before {
  content: attr(data-title);
  display: block;
  font-size: 0.8em;
  color: var(--muted);
  margin-bottom: 8px;
}
```

### B3 — Block References (`[[nota^id-do-bloco]]`)

**Backend** — `core/src/notes/blocks.rs`:
```rust
// Ao salvar uma nota, escanear parágrafos/itens de lista sem ^id
// e atribuir IDs (6 chars aleatórios) para qualquer bloco que seja referenciável.
// Formato: parágrafo seguido de `^a1b2c3` na mesma linha.

pub fn ensure_block_ids(body: &str) -> String { /* ... */ }
pub fn list_blocks(body: &str) -> Vec<BlockMeta> { /* ... */ }
// BlockMeta { id: String, preview: String (primeiros 80 chars do bloco) }
```

Novo Tauri command: `list_blocks(path: String) -> Vec<BlockMeta>`

**Frontend** — `editor/blockRef.ts`:
1. Detecta `[[nota^` no input
2. Abre popup com `invoke('list_blocks', { path })` + fuzzy search nos previews
3. Ao confirmar: completa `[[nota^id-do-bloco]]`
4. Widget (fora do cursor): renderiza preview do bloco referenciado em tooltip ao hover

**Critério B:** Digitar `[[` abre popup com lista de notas. Selecionar insere link formatado. `![[nota]]` renderiza conteúdo inline. `[[nota^id]]` navega para o bloco.

---

## Fase C — LaTeX e Mermaid

### C1 — LaTeX (KaTeX)

Arquivo: `frontend/src/components/notes/editor/latexRenderer.ts`

Extensão CM6 que:
1. Detecta `$...$` (inline) e `$$...$$` (bloco) via regex no documento
2. Para cada região fora do cursor: substitui por `LatexWidget` que chama `katex.renderToString(expr, { throwOnError: false })`
3. Na região do cursor: mostra raw com highlighting `var(--yellow)`
4. Escape: `\$` → literal `$` (não renderiza LaTeX)

No **ViewPane**: adicionar pós-processamento do HTML do `marked` para converter `$...$` e `$$...$$` via KaTeX antes de injetar no DOM.

### C2 — Mermaid

Arquivo: `frontend/src/components/notes/editor/mermaidRenderer.ts`

Extensão CM6 que:
1. Detecta nós `FencedCode` com info `mermaid`
2. Fora do cursor: substitui o bloco por `MermaidWidget` que:
   - Chama `mermaid.render(id, code)` assincronamente
   - Injeta o SVG resultante no DOM do widget
   - Trata erros de sintaxe Mermaid mostrando mensagem de erro com fundo vermelho
3. Na linha do cursor: revela raw com highlighting normal de código

No **ViewPane**: interceptar `<pre><code class="language-mermaid">` no HTML do `marked` e renderizar via Mermaid.

**Critério C:** `$a+b$` renderiza fórmula inline. `$$...$$` renderiza bloco centrado. Bloco mermaid renderiza diagrama. Erros Mermaid/KaTeX mostram fallback sem quebrar o editor.

---

## Fase D — Painéis e Navegação

### D1 — Histórico de navegação (back/forward)

Arquivo: `frontend/src/stores/historyStore.ts` (pode já existir — verificar)

```ts
// Pilha separada por painel (panelId)
// navigateToNote já deve chamar pushHistory
// Expor: canGoBack(panelId), canGoForward(panelId), goBack(panelId), goForward(panelId)
```

No `NoteDetail.tsx`: botões `←` e `→` no toolbar que chamam `goBack`/`goForward`.

### D2 — Painel direito (TOC + Backlinks)

Arquivo: `frontend/src/components/notes/RightPanel.tsx`

```
┌──────────────────┐
│ [⋯]             │  ← botão 3-dots abre menu
├──────────────────┤
│ ● TOC           │  ← padrão
│ ○ Backlinks     │
└──────────────────┘
```

- Estado interno: `activeTab: 'toc' | 'backlinks'`
- Renderiza `<TableOfContents>` ou `<BacklinksPanel>` conforme aba ativa

Arquivo: `frontend/src/components/notes/TableOfContents.tsx`

- Recebe `body: string`
- Extrai headings via regex `/^(#{1,6})\s+(.+)$/gm`
- Renderiza lista com indentação proporcional ao nível (`--` * (level - 1) * 12px)
- Click → `view.dispatch({ selection: { anchor: posDoHeading } })` via ref ao `EditorView`
  - Em modo View: scroll para `<hN>` correspondente via `id` attribute

Arquivo: `frontend/src/components/notes/BacklinksPanel.tsx`

- Recebe `notePath: string`  
- Chama `invoke('get_backlinks', { path: notePath })`
- Renderiza lista de notas com preview do contexto onde o link aparece
- Click → `navigateToNote(path, title)`

### D3 — Frontmatter Properties UI

Arquivo: `frontend/src/components/notes/FrontmatterEditor.tsx`

Props: `{ fm: NoteFrontmatter; onChange: (fm: NoteFrontmatter) => void }`

```
┌─────────────────────────────────────┐
│ title    [__________________________│
│ tags     [tag1 ×] [tag2 ×] [+ add] │
│ created  2026-05-30 (read-only)     │
│ modified 2026-05-30 (read-only)     │
│ [+ Add property]                    │
└─────────────────────────────────────┘
```

- Campo `title`: sincroniza com o campo title do toolbar do `NoteDetail`
- Campo `tags`: chips removíveis + input para adicionar nova tag
- Campos de data: somente leitura, formatados
- `[+ Add property]`: adiciona campo custom ao frontmatter (chave/valor)
- Em modo `raw`: o `FrontmatterEditor` é ocultado; o frontmatter fica visível no CM6

Em `NoteDetail.tsx`: renderizar `<FrontmatterEditor>` acima do `EditorPane`/`ViewPane`, exceto em modo raw.

### D4 — Árvore de notas no painel esquerdo

Expandir `NotesList.tsx` para suportar estrutura de pastas:

Novo Tauri command: `list_notes_tree() -> Vec<NoteTreeNode>`
```rust
pub struct NoteTreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<NoteTreeNode>,
}
```

No frontend:
- Renderizar árvore colapsável com ícones de pasta/nota
- Pastas podem ter uma nota de mesmo nome (como no Notion) — se existir `pasta/pasta.md`, exibir a pasta como clicável
- Estado de colapso persistido em `localStorage`

**Critério D:** Botões ← → navegam histórico. Painel direito alterna TOC/Backlinks. Frontmatter Editor mostra e edita propriedades visualmente. Árvore de notas mostra estrutura de pastas.

---

## Fase E — Produtividade

### E1 — Folding

Arquivo: `frontend/src/components/notes/editor/folding.ts`

Usa a API nativa de folding do CM6 (`@codemirror/language` → `codeFolding`, `foldGutter`):

```ts
import { codeFolding, foldGutter, foldKeymap } from '@codemirror/language';
```

- Adicionar ícone de fold na gutter ao lado de headings e listas aninhadas
- Keybind: `Ctrl+Shift+[` para fold, `Ctrl+Shift+]` para unfold (padrão CM6)
- Fold de heading oculta tudo até o próximo heading do mesmo nível ou superior

Adicionar ao `buildExtensions` no `EditorPane.tsx`.

### E2 — Command Palette (Ctrl+P e `/`)

Arquivo: `frontend/src/components/notes/editor/commandPalette.ts`

Implementação como `TooltipView` do CM6:

1. `Ctrl+P` → abre palette global (busca notas por nome)
2. `/` no início de uma linha → abre palette de comandos de formatação:
   - `heading 1`, `heading 2`, ..., `heading 6`
   - `bold`, `italic`, `strikethrough`
   - `code block`, `quote`, `table`, `horizontal rule`
   - `link`, `image`
3. Fuzzy search nas opções com setas ↑↓ e `Enter`
4. `Esc` fecha

A palette de busca de notas (`Ctrl+P`) usa `invoke('search_notes', { query })`.

### E3 — Vim Mode

Arquivo: `frontend/src/components/notes/editor/vimMode.ts`

```ts
import { vim } from '@codemirror/vim';
export const vimExtension = vim();
```

Adicionado condicionalmente ao `buildExtensions` conforme preferência do usuário:
```ts
...(userPrefs().vimMode ? [vimExtension] : []),
```

Preferência persistida em `localStorage` via `prefsStore.ts`. Toggle na toolbar do `NoteDetail` (ícone de teclado).

### E4 — Tags globais

A tag `#nome-da-tag` dentro do body de uma nota deve:
1. No editor (livePreview): colorir com `var(--accent)` via `MarkDecoration`
2. No ViewPane: interceptar pós-processamento do `marked` e converter em `<span class="tag">#nome</span>`
3. Ao salvar: extrair tags `#tag` do body e mesclar com `frontmatter.tags` antes de persistir
4. Na sidebar: futuro módulo Tags usa `invoke('list_all_tags')` que consulta todos os módulos

Novo Tauri command: `list_all_tags() -> Vec<TagMeta>` (soma tags de notas, contacts, etc.)

**Critério E:** Folding de headings funciona via gutter. `Ctrl+P` abre palette de notas. `/` no início de linha abre palette de comandos. Vim mode pode ser ativado/desativado no toolbar. Tags `#exemplo` são coloridas e exportadas ao frontmatter ao salvar.

---

## Fase F — Backend: Backlinks e Busca

### F1 — Índice de Backlinks

Arquivo: `core/src/notes/backlinks.rs`

```rust
// Executado após cada NoteSaved event
// Extrai todos os [[uid]] e [[título]] do body
// Atualiza tabela SQLite: source_uid → target_uid

pub fn index_backlinks(source: &Note, conn: &Connection) -> Result<()>;
pub fn get_backlinks(target_uid: &str, conn: &Connection) -> Result<Vec<BacklinkMeta>>;

pub struct BacklinkMeta {
    pub source_path: String,
    pub source_title: String,
    pub context: String, // ~100 chars ao redor do link
}
```

Schema SQLite:
```sql
CREATE TABLE IF NOT EXISTS backlinks (
    source_uid TEXT NOT NULL,
    target_uid TEXT NOT NULL,
    context    TEXT,
    PRIMARY KEY (source_uid, target_uid)
);
```

Novo Tauri command: `get_backlinks(path: String) -> Vec<BacklinkMeta>`

### F2 — Busca fuzzy de notas

Arquivo: `core/src/notes/search.rs`

```rust
// FTS5 sobre título + body
// Retorna NoteMeta ordenado por relevância (rank FTS5)

pub fn search_notes(query: &str, conn: &Connection, vault_path: &Path) -> Result<Vec<NoteMeta>>;
```

Novo Tauri command: `search_notes(query: String) -> Vec<NoteMeta>`

O índice FTS5 é mantido atualizado via `NoteSaved` e `NoteDeleted` events.

Schema:
```sql
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    uid UNINDEXED,
    path UNINDEXED,
    title,
    body,
    content='notes', -- tabela real (se houver)
    tokenize='porter unicode61'
);
```

### F3 — Block IDs

`core/src/notes/blocks.rs` — ver B3.

Ao chamar `save_note`, o `NotesModule` deve:
1. Chamar `ensure_block_ids(&body)` → body com IDs atribuídos aos blocos sem ID
2. Salvar o body modificado
3. Atualizar o frontmatter com `modified`

**Critério F:** `get_backlinks` retorna notas corretas ao testar com 2 notas linkadas. `search_notes("rust")` retorna notas com "rust" no título/body. Block IDs são gerados ao salvar.

---

## Fase G — Syntax Highlighting Multi-linguagem

### G1 — Highlighting de código no EditorPane

Arquivo: `frontend/src/components/notes/editor/languageSupport.ts`

```ts
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
// ... outros imports

// Mapa de linguagens disponíveis
export const LANGUAGE_MAP: Record<string, () => LanguageSupport> = {
  js: javascript, javascript,
  ts: () => javascript({ typescript: true }), typescript,
  python, py: python,
  rust, rs: rust,
  go, golang: go,
  // ...
};

// Extensão CM6 que detecta o info string do FencedCode e ativa o parser correto
export function dynamicLanguageHighlight(): Extension { /* ... */ }
```

A extensão `dynamicLanguageHighlight` usa `StreamLanguage` ou `LanguageDescription` + `LanguageSupport` para ativar highlighting por bloco de código.

### G2 — Extensibilidade por plugins

A arquitetura deve permitir que plugins (futuro) registrem novas linguagens via:
```ts
// Em um plugin de comunidade:
import { registerLanguage } from 'ruas-plugin-api';
import { lua } from '@codemirror/lang-lua';
registerLanguage('lua', lua);
```

Por ora: implementar `LANGUAGE_MAP` como objeto mutável global e expor `registerLanguage(name, factory)`.

**Critério G:** Bloco ` ```rust ` tem highlighting de Rust. Bloco ` ```python ` tem highlighting de Python. Linguagem desconhecida não quebra o editor.

---

## Layout final do NoteDetail

```
┌─ Sidebar (48px) ─┬──── NoteDetail (flex-1) ──────────────────┬── RightPanel (240px) ──┐
│                  │ [←][→] [título]   [View][Edit][Raw][⌨️][⋯] │ [⋯]                    │
│  Árvore de       ├───────────────────────────────────────────┤ ├──────────────────────┤
│  Notas           │ ┌── FrontmatterEditor ───────────────────┐ │ │ TOC / Backlinks      │
│  (NotesList)     │ │ title  [_______]  tags [tag1×][+]     │ │ │                      │
│                  │ └────────────────────────────────────────┘ │ │ ## Heading 1         │
│                  │                                             │ │   ### Sub            │
│                  │  <EditorPane mode="edit">                  │ │ ## Heading 2         │
│                  │    ou                                       │ │                      │
│                  │  <ViewPane>                                 │ │ ──────────────────── │
│                  │                                             │ │ Backlinks:           │
│                  │                                             │ │ • Nota X             │
│                  │                                             │ │ • Nota Y             │
└──────────────────┴─────────────────────────────────────────────┴────────────────────────┘
```

---

## Ordem de entrega e critérios de aceite

| Fase | Critério de aceite |
|---|---|
| **A** | Live preview renderiza listas, HR, code, links, images, tables, blockquotes. Auto-pairs funcionam. Tabelas têm botões flutuantes. |
| **B** | `[[` abre popup com fuzzy search. WikiLinks renderizam em view/edit mode. Embeds mostram conteúdo. Block refs completam com `^id`. |
| **C** | `$E=mc^2$` renderiza KaTeX inline. `$$...$$` renderiza em bloco. Bloco mermaid renderiza diagrama SVG. |
| **D** | ← → navegam histórico por painel. TOC lista headings clicáveis. Backlinks panel mostra notas. FrontmatterEditor edita visualmente. Árvore de pastas no painel esquerdo. |
| **E** | Folding via gutter funciona. `Ctrl+P` abre palette. `/` abre palette de comandos. Vim mode toggle no toolbar. Tags `#abc` coloridas e exportadas. |
| **F** | `get_backlinks` retorna correto. `search_notes` busca por título e body. Block IDs gerados ao salvar. |
| **G** | Highlighting de Rust, Python, JS, Go em blocos de código. Linguagem desconhecida: sem erro. |

---

## Regras gerais

- Seguir o **padrão de Contacts** em tudo que tiver equivalente (store, tabs, IPC).
- Usar apenas `var(--*)` CSS; nunca hardcode de cor.
- Não criar abstrações além do necessário para cada fase.
- Confirmar com o usuário após cada fase antes de avançar.
- Se uma fase revelar necessidade de ajuste no plano, propor a mudança antes de implementar.
- Nunca pular um critério de aceite mesmo que o passo seguinte pareça simples.
- Fases podem ser implementadas em ordem diferente se o usuário solicitar — o grafo de dependências acima indica o que é obrigatório respeitar.
