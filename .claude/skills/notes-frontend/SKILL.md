# Notes Frontend — Implementação passo a passo

Você está implementando o frontend do módulo de notas do projeto **Ruas**. Siga **exatamente** esta ordem, marcando cada passo como concluído antes de avançar. Confirme com o usuário sempre que um passo estiver pronto.

## Contexto de decisão de bibliotecas

Três modos de edição, três abordagens:

| Modo | Comportamento | Tecnologia |
|---|---|---|
| **Visualização** | Markdown renderizado, read-only | `marked` → HTML |
| **Edição** (live preview) | Linha/bloco do cursor em raw, resto renderizado | CodeMirror 6 + `@lezer/markdown` + `Decoration` |
| **Raw** | Texto puro, frontmatter visível e editável | CodeMirror 6 com syntax highlighting |

---

## Passo 1 — Dependências

```bash
cd frontend
pnpm add marked @codemirror/view @codemirror/state @codemirror/commands \
         @codemirror/lang-markdown @codemirror/language @lezer/markdown
```

Verificar que `package.json` e `pnpm-lock.yaml` foram atualizados. **Não avançar** até o build compilar sem erros.

---

## Passo 2 — workspaceStore: tipos e navegação de notas

Arquivo: `frontend/src/components/workspace/workspaceStore.ts`

1. Adicionar ao union `TabContent`:
   ```ts
   | { type: 'notes-list' }
   | { type: 'note-detail'; notePath: string }
   ```

2. Implementar as funções (espelham exatamente o padrão de contacts):
   - `navigateToNote(path, title)` — preview tab (single-click)
   - `openNotePermanent(path, title)` — permanent tab (Ctrl+click)
   - `openNotesList(panelId?)` — abre a lista de notas
   - `promoteNotePreviewByPath(notePath)` — promove preview → permanent ao editar
   - `updateNoteTabTitle(notePath, title)` — sincroniza título da tab

---

## Passo 3 — i18n

Criar os dois arquivos de locale com as mesmas chaves (traduzidas):

- `frontend/src/locales/en-US/notes.ftl`
- `frontend/src/locales/pt-BR/notes.ftl`

Chaves mínimas:
```fluent
notes-title = Notes
notes-new = New note
notes-untitled = Untitled
notes-mode-view = View
notes-mode-edit = Edit
notes-mode-raw = Raw
notes-empty = No notes yet
notes-delete-confirm = Delete this note?
```

Registrar ambos os arquivos em `frontend/src/i18n/context.tsx` (seguir o padrão dos outros módulos).

---

## Passo 4 — NotesList.tsx

Arquivo: `frontend/src/components/notes/NotesList.tsx`

Segue o padrão de `ContactsList.tsx`:

- Chama `invoke('list_notes')` ao montar
- Exibe título + tags (pílulas) + data de modificação formatada ("há 2 dias", etc.)
- Single-click → `navigateToNote` (preview tab)
- Ctrl+click → `openNotePermanent`
- Botão `+` no header → `invoke('create_note', { title: '' })` → abre imediatamente em edit mode via `openNotePermanent`
- Campo de busca local que filtra por título e tags
- Estado de loading e estado vazio com mensagem i18n

---

## Passo 5 — NoteDetail.tsx (orquestrador)

Arquivo: `frontend/src/components/notes/NoteDetail.tsx`

Props: `{ path: string }`

Estrutura:
```
┌─────────────────────────────────────────────────────┐
│ [título editável inline]   [View] [Edit] [Raw]  [⋯] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  <ViewPane>  OU  <EditorPane mode="edit|raw">       │
│                                                     │
└─────────────────────────────────────────────────────┘
```

Responsabilidades:
- Carrega nota via `invoke('read_note', { path })`
- Estado de modo: `view | edit | raw` (padrão: `edit`)
- Título: `<input>` inline no toolbar; ao editar, chama `promoteNotePreviewByPath` e `updateNoteTabTitle`
- **Auto-save**: debounce de 1 s após última alteração em body ou título
- **Ctrl+S**: salva imediatamente
- Ao iniciar qualquer edição: chama `promoteNotePreviewByPath(path)` para promover o preview tab

---

## Passo 6 — ViewPane.tsx (modo visualização)

Arquivo: `frontend/src/components/notes/ViewPane.tsx`

Props: `{ body: string }`

- Chama `marked.parse(body)` → HTML
- Injeta via `innerHTML` num `<div class="prose">`
- `user-select: text` para permitir copiar
- **CSS `.prose`** a adicionar em `global.css` (apenas as regras necessárias, usando variáveis Catppuccin):
  - `h1`–`h6`: tamanhos decrescentes, `var(--text)`, `font-weight: 600`
  - `p`, `li`: `line-height: 1.7`, `var(--subtext)`
  - `code` inline: background `var(--surface0)`, `font-family: monospace`
  - `pre > code`: block code com background `var(--mantle)`, padding, border-radius
  - `blockquote`: border-left `var(--accent)`, `var(--muted)`
  - `a`: `var(--accent)`
  - `strong`: `var(--text)`
  - `hr`: `var(--surface1)`

---

## Passo 7 — EditorPane.tsx com CodeMirror 6

Arquivo: `frontend/src/components/notes/EditorPane.tsx`

Props: `{ content: string; mode: 'edit' | 'raw'; onChange: (value: string) => void }`

### Tema Catppuccin Mocha para CM6

Criar em `frontend/src/components/notes/catppuccinTheme.ts`:

```ts
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

export const catppuccinTheme = EditorView.theme({ /* ... */ }, { dark: true });
export const catppuccinHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.heading1, color: '#89b4fa', fontWeight: '700', fontSize: '1.4em' },
    { tag: tags.heading2, color: '#89b4fa', fontWeight: '600', fontSize: '1.2em' },
    // headings 3-6 proporcionais...
    { tag: tags.strong, color: '#cdd6f4', fontWeight: '700' },
    { tag: tags.emphasis, color: '#cdd6f4', fontStyle: 'italic' },
    { tag: tags.url, color: '#94e2d5' },
    { tag: tags.string, color: '#a6e3a1' },
    { tag: tags.monospace, color: '#f38ba8' },
    { tag: tags.comment, color: '#6c7086', fontStyle: 'italic' },
    { tag: tags.meta, color: '#f9e2af' },   // frontmatter
  ])
);
```

### Raw mode

Extensions: `[markdown(), catppuccinTheme, catppuccinHighlight, lineNumbers(), ...]`
Conteúdo: **body completo incluindo o bloco `---frontmatter---`**

### Edit mode (live preview)

Criar a extensão `markdownLivePreview` em `frontend/src/components/notes/livePreview.ts`:

```ts
import { ViewPlugin, Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';

// Regra central: nós fora da linha do cursor → decorations que escondem a sintaxe
// Headings fora do cursor → widget que renderiza <hN> no lugar da linha
```

Algoritmo:
1. `update()`: obtém a linha do cursor via `view.state.selection.main.head`
2. Percorre `syntaxTree(view.state)` com `.cursor()`
3. Para nós do tipo `HeaderMark`, `EmphasisMark`, `StrongMark`, `CodeMark`, `LinkMark`:
   - Se o nó está em linha ≠ cursor: `Decoration.replace({})` sobre o intervalo do token
4. Para nós `ATXHeading1`–`ATXHeading6`:
   - Se linha ≠ cursor: substituir a linha por `Decoration.replace({ widget: new HeadingWidget(level, text) })`
5. O bloco de frontmatter (`---…---`) é sempre ocultado em edit mode (posição 0 até o segundo `---\n`)

Conteúdo passado ao editor em edit mode: **apenas o body** (sem frontmatter), porque o título é editado no toolbar.

---

## Passo 8 — Wiring em PanelView.tsx e Sidebar.tsx

### PanelView.tsx

Adicionar imports e Match para as novas views:
```tsx
import NotesList from '../notes/NotesList';
import NoteDetail from '../notes/NoteDetail';

// Dentro de TabContent:
<Match when={props.tab.content.type === 'notes-list'}>
  <NotesList />
</Match>
<Match when={props.tab.content.type === 'note-detail'}>
  <NoteDetail path={(props.tab.content as { notePath: string }).notePath} />
</Match>
```

Adicionar ícone de notes no `tabIcon` switch.

### Sidebar.tsx

Em `handleOpen`:
```ts
if (id === 'contacts') openContactsList();
else if (id === 'notes') openNotesList();
else openModule(id, label);
```

---

## Ordem de entrega e verificação

| Passo | Critério de aceite |
|---|---|
| 1 | `cargo build` + `pnpm build` sem erros |
| 2 | TypeScript compila sem erros no workspaceStore |
| 3 | i18n não quebra nenhum componente existente |
| 4 | Clicar em Notes na sidebar abre lista; criar nota cria arquivo `.md` no vault |
| 5 | Abrir nota mostra toolbar com modo selector; título é editável |
| 6 | Modo View renderiza markdown corretamente com estilos Catppuccin |
| 7a | Raw mode exibe frontmatter + body editável com highlight |
| 7b | Edit mode: blocos fora do cursor estão renderizados; cursor revela raw |
| 8 | Sidebar e PanelView funcionam sem regressões nos Contacts |

---

## Regras gerais durante a implementação

- Seguir o **padrão de Contacts** em tudo que tiver equivalente (store, tabs, IPC).
- Usar apenas `var(--*)` CSS; nunca hardcode de cor.
- Não criar componentes/abstrações além do necessário para estes passos.
- Confirmar com o usuário após cada passo antes de avançar para o próximo.
- Se um passo revelar necessidade de ajuste no plano, propor a mudança antes de implementar.
