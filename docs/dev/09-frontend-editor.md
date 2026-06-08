# Editor e Renderização Markdown

O editor usa **CodeMirror 6** com extensões customizadas para Markdown aprimorado. A visualização usa **marked** + KaTeX + Mermaid.

**Arquivos principais:**
- `components/notes/EditorPane.tsx` — wrapper CM6
- `components/notes/ViewPane.tsx` — renderização Markdown
- `components/notes/editor/` — extensões CodeMirror 6

---

## `EditorPane`

### Interface `EditorApi`

```typescript
interface EditorApi {
  scrollToLine(line: number): void  // 1-based, posiciona o cursor e rola
}
```

### `buildExtensions(mode)`

Monta a pilha de extensões CM6 conforme o modo:

```
Sempre:
  @replit/codemirror-vim (se vimMode() ativado — deve ser primeiro!)
  catppuccinTheme + catppuccinHighlightStyle
  markdown({ base: markdownLanguage, extensions: [GFM, superscript, subscript] })
  codeLanguages (syntax highlighting em code blocks)
  autoPairs()
  history()
  folding()
  EditorView.lineWrapping
  flashField (StateField para block highlight)

Modo 'edit' adiciona:
  markdownLivePreview
  tableInteraction()
  blockRef()
  wikiLinks()
  slashCommands()
  latex()
  mermaidDiagram()
  blockIdConceal()
  embedRenderer()

Modo 'raw' adiciona:
  lineNumbers()
```

### Block flash

Ao rolar para um bloco (`^blockId`):

```typescript
// StateEffect que ativa o flash
const setFlash: StateEffectType<number>  // line number

// StateField que mantém as decorações de highlight
const flashField: StateField<DecorationSet>
// CSS class: .cm-block-flash (transição CSS, dura ~1400ms)
```

Fluxo: `scrollToBlock(blockId)` → localiza a linha com ` ^blockId` → scroll → `dispatch(setFlash(lineNumber))` → timer de 1200ms → `dispatch(setFlash(0))` para remover.

---

## `ViewPane`

### Interface `ViewApi`

```typescript
interface ViewApi {
  scrollToHeading(slug: string): void
}
```

### Pipeline de renderização Markdown

O corpo da nota passa pelos seguintes estágios em ordem:

```
1. stripBlockIds(body)
      Remove sufixos " ^blockId" das linhas para não aparecerem no HTML.

2. extractMath(text)
      Extrai $$...$$ e $...$ (LaTeX), renderiza com KaTeX,
      substitui por placeholders %%RUASMATH{i}%%.
      KaTeX errors são exibidos inline como <span class="katex-error">.

3. marked.parse(text, { gfm: true, breaks: true })
      Converte Markdown para HTML (headings, listas, tabelas, code blocks, etc.)

4. renderEmbeds(html)
      Substitui ![[alvo]] por:
        - <img> para imagens (.png, .jpg, .gif, .webp, .svg)
        - <iframe> para PDFs (.pdf)
        - <div class="embed-note" data-target="alvo"> para notas

5. renderWikiLinks(html)
      Substitui [[alvo]], [[alvo|alias]], [[nota^bloco]] por:
        <a class="wiki-link" data-target="alvo" data-block="bloco">alias</a>

6. renderTagsHtml(html)
      Envolve #tag em <span class="tag">#tag</span>

7. KaTeX restore
      Substitui %%RUASMATH{i}%% pelo HTML KaTeX previamente renderizado.
```

Após renderização, um `createEffect` faz:
- Atribui IDs para headings (`id="slugified-heading"`)
- Preenche `<div.embed-note>` com conteúdo de notas via `invoke('read_note')`
- Renderiza diagramas Mermaid em `<code class="language-mermaid">`

### Cliques no ViewPane

```typescript
onClick(e: MouseEvent) {
  const link = e.target.closest('a')
  if (link?.classList.contains('wiki-link')) {
    // abre nota (single-click = preview, Ctrl = permanent)
  } else if (link?.href.startsWith('http')) {
    // abre no browser externo via openExternal()
  }
}
```

---

## Extensões CodeMirror 6

**Diretório:** `components/notes/editor/`

| Arquivo | Função exportada | O que faz |
|---|---|---|
| `autoPairs.ts` | `autoPairs()` | Auto-fecha `[]`, `()`, `{}`, `**`, backticks; remove par ao apagar |
| `blockIdConceal.ts` | `blockIdConceal()` | Oculta ` ^blockId` no modo edit (Decoration replace) |
| `blockRef.ts` | `blockRef()` | Detecta `[[nota^`; ao completar, chama `setPendingBlock + navigateToNote`; usa FuzzyPopup para listar blocos da nota alvo |
| `embedRenderer.ts` | `embedKind(target)`, `fillNoteEmbed(target, body)` | Classifica embed por extensão; preenche `<div.embed-note>` com corpo da nota no modo edit |
| `folding.ts` | `folding()` | Folding de seções de heading (gutter com ▾) |
| `languageSupport.ts` | `codeLanguages` | Mapa de linguagens para syntax highlighting em fenced code blocks |
| `latexRenderer.ts` | `latex()` | Renderiza `$$...$$` e `$...$` com KaTeX via Decoration widget |
| `mermaidRenderer.ts` | `mermaidDiagram()` | Renderiza fenced blocks `mermaid` como SVG via Decoration widget |
| `mermaidLoader.ts` | `renderMermaid(text)` | Lazy import do mermaid, retorna SVG como string |
| `slashCommands.ts` | `slashCommands()` | Detecta `/` no início de linha; abre FuzzyPopup com comandos disponíveis (tabela, code block, etc.) |
| `tableInteraction.ts` | `tableInteraction()` | Tab/Shift+Tab navega entre células de tabela GFM; Enter adiciona nova linha |
| `tags.ts` | `extractBodyTags(body)`, `renderTagsHtml(html)` | Extrai tags `#tag` do corpo; envolve em `<span class="tag">` no HTML |
| `toc.ts` | `extractHeadings(body)`, `slugify(text)` | Parseia headings ATX (`#`...`######`); produz `Heading { level, text, line, slug }` |
| `wikiLink.ts` | `wikiLinks()`, `openNoteByTitle(title, permanent?, blockId?)` | Decora `[[...]]` com Decoration mark; detecta `[[` para abrir FuzzyPopup de busca de notas; clique abre nota |

---

## `toc.ts` — tipos e funções

```typescript
interface Heading {
  level: number    // 1–6
  text: string
  line: number     // linha no corpo (1-based)
  slug: string     // ex: "minha-nota" para "## Minha Nota"
}

function extractHeadings(body: string): Heading[]
  // Parseia headings ATX; pula headings dentro de fenced code blocks.
  // Deduplica slugs (segundo "titulo" vira "titulo-1", etc.)

function slugify(text: string): string
  // Minúsculas, remove acentos, substitui espaços por hífens,
  // remove caracteres não-alfanuméricos.
```

---

## `tags.ts` — extração de tags

```typescript
function extractBodyTags(body: string): string[]
  // Regex: /#([A-Za-zÀ-ÿ0-9_/-]+)/g
  // Retorna sem o #, deduplicado.

function renderTagsHtml(html: string): string
  // Substitui #tag (fora de code blocks) por <span class="tag">#tag</span>
```

Tags extraídas por `NoteDetail` ao salvar são mescladas com `frontmatter.tags` (sem duplicatas).
