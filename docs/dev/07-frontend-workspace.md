# Workspace e Sistema de Painéis

O workspace é o núcleo do layout da UI. É uma **árvore binária** de nós de split e painéis (leaves), onde cada painel tem uma barra de abas.

**Arquivo principal:** `frontend/src/components/workspace/workspaceStore.ts`

---

## Tipos TypeScript

```typescript
// Conteúdo possível de uma aba
type TabContent =
  | { type: 'contacts-list' }
  | { type: 'contact-detail'; contactPath: string }
  | { type: 'notes-list' }
  | { type: 'note-detail'; notePath: string }
  | { type: 'placeholder'; module: string }

// Aba individual dentro de um painel
interface Tab {
  id: string
  title: string
  content: TabContent
  preview?: boolean    // true = aba preview (itálico, substituível)
}

// Painel: coleção de abas
interface Panel {
  id: string
  tabs: Tab[]
  activeTabId: string | null
}

// Nó folha: referencia um painel
interface LeafNode {
  kind: 'leaf'
  panelId: string
}

// Nó de split: divide o espaço entre dois filhos
interface SplitNode {
  kind: 'split'
  id: string
  direction: 'row' | 'column'
  ratio: number           // 0.0 a 1.0, primeiro filho ocupa ratio% do espaço
  first: WorkspaceNode
  second: WorkspaceNode
}

type WorkspaceNode = LeafNode | SplitNode
```

---

## Estado exportado pelo store

| Export | Tipo | Descrição |
|---|---|---|
| `panels` | `Record<string, Panel>` (SolidJS store) | Todos os painéis, indexados por ID |
| `tree` | `Signal<WorkspaceNode>` | Raiz da árvore de layout |
| `focusedPanelId` | `Signal<string>` | ID do painel com foco de teclado |
| `navStacks` | `Record<string, NavStack>` (store) | Histórico de navegação por painel |

---

## Ações de aba e painel

```typescript
focusPanel(id: string): void
setActiveTab(panelId: string, tabId: string): void
openTab(panelId: string, tab: Tab): void
closeTab(panelId: string, tabId: string): void
splitPanel(panelId: string, direction: 'row' | 'column'): void
updateSplitRatio(splitId: string, ratio: number): void
firstLeaf(node: WorkspaceNode): string | null
lastLeaf(node: WorkspaceNode): string | null
```

`splitPanel` cria um novo painel vazio e um `SplitNode` 50/50. O ratio é atualizado por drag em `SplitContainer.tsx` e clampado a `[0.15, 0.85]`.

`closeTab`: se o painel ficar sem abas, é removido da árvore (colapsando o split pai). Se for o último painel, um placeholder é restaurado.

---

## Protocolo de preview tab

Este protocolo controla como a navegação single-click vs Ctrl-click se comporta. **É o padrão obrigatório para qualquer novo módulo.**

```
Single-click na lista  →  navigateToNote / navigateToContact
  1. Existe aba permanente com o mesmo path? → ativa ela (sem mudar nada)
  2. Existe aba preview no painel? → substitui o conteúdo in-place (title + content)
  3. Senão → cria nova aba com preview: true

Ctrl/Cmd-click        →  openNotePermanent / openContactPermanent
  1. Existe aba preview com o mesmo path? → promove para permanente
  2. Senão → cria nova aba com preview: false

Ao iniciar edição      →  promoteNotePreviewByPath / promotePreviewByPath
  → Remove preview: true de qualquer aba com aquele path em todos os painéis
```

Abas preview são exibidas em itálico via classe CSS `.tab-preview`.

---

## Navegação de contatos

```typescript
navigateToContact(path: string, displayName: string): void
openContactPermanent(path: string, displayName: string): void
promotePreviewByPath(contactPath: string): void
updateTabTitle(contactPath: string, title: string): void
openContactsList(panelId?: string): void
```

---

## Navegação de notas

```typescript
navigateToNote(path: string, title: string, panelId?: string): void
openNotePermanent(path: string, title: string): void
promoteNotePreviewByPath(notePath: string): void
updateNoteTabTitle(notePath: string, title: string): void
openNotesList(panelId?: string): void
```

---

## Histórico de navegação (back/forward)

Cada painel mantém uma pilha de navegação independente em `navStacks`.

```typescript
goBack(panelId: string): void
goForward(panelId: string): void
canGoBack(panelId: string): boolean
canGoForward(panelId: string): boolean
```

**`suppressNav`** é um flag interno usado para evitar que `goBack`/`goForward` gravem a própria navegação na pilha. Não exponha esse flag em novos código.

---

## `PanelView.tsx` — ponto de registro de novos módulos

`frontend/src/components/workspace/PanelView.tsx` é onde `TabContent.type` é mapeado para componentes React. **Ao criar uma nova view, adicione aqui:**

```tsx
// Função tabIcon() — ícone SVG por tipo de aba
switch (tab.content.type) {
  case 'contacts-list':    return <IconContacts />
  case 'contact-detail':   return <IconContact />
  case 'notes-list':       return <IconDocument />
  case 'note-detail':      return <IconDocument />
  // ← adicione novos casos aqui
}

// Componente TabContent() — renderiza o conteúdo da aba ativa
<Switch>
  <Match when={tab.content.type === 'contacts-list'}>
    <ContactsList />
  </Match>
  <Match when={tab.content.type === 'contact-detail'}>
    <ContactDetail path={tab.content.contactPath} />
  </Match>
  {/* ← adicione novos Match aqui */}
</Switch>
```

---

## `Workspace.tsx` — árvore de renderização

`WorkspaceTree` é recursivo: se o nó é `LeafNode`, renderiza `PanelView`; se é `SplitNode`, renderiza `SplitContainer` com dois filhos recursivos.

`SplitContainer` gerencia o drag da divisória:
- `onMouseDown` no handle → `onMouseMove` no document calcula o novo ratio
- Ratio é clampado para `[0.15, 0.85]` para evitar painéis colapsados demais

---

## `openModule(module, label)`

Para módulos que não têm um browser de lista dedicado (agenda, calendar, projects), use:

```typescript
openModule(module: string, label: string): void
```

Isso cria uma aba `{ type: 'placeholder', module }` que exibe a mensagem "em desenvolvimento".
