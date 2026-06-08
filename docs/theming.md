# Customização de aparência (temas & snippets)

A aparência do Ruas tem **duas camadas**:

1. **Temas** — trocam os valores das *CSS custom properties* (`:root`), recolorindo o app inteiro.
2. **Snippets** — CSS arbitrário do usuário que mira as **classes estáveis** documentadas aqui.

Tudo é configurado em **Configurações → Aparência**:
- **Tema embutido** (Catppuccin Mocha/Macchiato/Frappé/Latte) + **cor de acento** + **fonte**.
- **Temas do usuário**: arquivos `.css` em `<vault>/.ruas/themes/` aparecem no dropdown de tema (grupo "Do cofre"). Aplicados como camada por cima do embutido.
- **Snippets**: arquivos `.css` em `<vault>/.ruas/snippets/` aparecem com um toggle cada. Botões "Abrir pasta" e "Recarregar".

A seleção (tema do usuário + snippets ativos) é salva em `<vault>/.ruas/appearance.json` (viaja com o cofre). Editar um arquivo `.css` aplica **na hora** (hot-reload via watcher) no app desktop; na web, use "Recarregar".

**Ordem da cascata:** `global.css` → tema embutido (`#ruas-builtin`) → tema do usuário → snippets. Cada camada vence a anterior por ordem no `<head>`.

**Privacidade:** CSS de usuário não consegue "telefonar para casa" — a CSP do webview bloqueia `img-src`/`font-src`/`style-src` remotos, e o backend ainda remove `@import` e `url()` remoto ao ler os arquivos (defesa em profundidade).

---

## 1. Contrato de tema (variáveis)

Um tema redefine estas variáveis. Tudo no app lê `var(--*)`, então mudar aqui propaga para todos os componentes (inclusive estilos inline, que referenciam as variáveis). Aplicar via inline no `<html>` (`document.documentElement.style.setProperty`) vence qualquer regra de stylesheet.

**Paleta:** `--crust` `--mantle` `--base` `--surface0` `--surface1` `--surface2` `--overlay0` `--overlay1` `--text` `--subtext` `--muted` `--accent` `--accent2` `--green` `--red` `--yellow` `--teal` `--pink` `--mauve` `--peach`

**Layout:** `--sidebar-w` (48px) · `--tabbar-h` (36px) · `--radius` (6px) · `--border`

Temas embutidos: Catppuccin **Mocha** (padrão), **Macchiato**, **Frappé**, **Latte** (claro) — ver `frontend/src/styles/themes.ts`.

---

## 2. API de snippets (classes estáveis)

CSS de usuário deve mirar **estas classes** (não a estrutura do DOM, que pode mudar). Onde uma propriedade ainda é definida inline (valores dinâmicos: cor de avatar, indentação da árvore, posição de popup, cor de status), use `!important` para sobrescrever.

### Shell & navegação
- `.app-shell` — container raiz
- `.sidebar`, `.sidebar-btn` — barra de módulos e botões
- `.panel` (`.panel-focused`) — painel do workspace
- `.tabbar`, `.tab-list`, `.tab` (`.tab-active`, `.tab-preview`), `.tab-icon`, `.tab-title`, `.tab-close`
- `.panel-split`, `.panel-split-btn` — botão de dividir painel

### Listas (notas & contatos)
- `.note-list`, `.contact-list` — painéis de lista
- `.list-search` — barra de busca · `.list-new-btn` — botão "+"
- `.note-list-item`, `.note-tree-item`, `.note-tree-folder` — linhas de nota/árvore
- `.contact-list-item` — linha de contato

### Detalhe da nota
- `.note-detail`, `.note-toolbar`, `.note-title-input`
- `.nav-btn` — voltar/avançar · `.mode-btn` (`.mode-active`) — Visualizar/Editar/Raw · `.panel-toggle-btn` (`.active`)
- `.status-bar`, `.status-path`, `.status-label`

### Painel direito (Sumário / Backlinks)
- `.right-panel`, `.right-panel-header`, `.right-panel-title`, `.right-panel-menu-btn`, `.right-panel-menu`, `.right-panel-menu-item` (`.active`)
- `.toc-item` — item do sumário · `.backlink-item` — item de backlink

### Editor de frontmatter
- `.frontmatter-editor`, `.fm-row`, `.fm-label`, `.fm-input`, `.fm-tag`, `.fm-tag-remove`, `.fm-add-btn`

### Detalhe do contato
- `.contact-detail`, `.contact-name`, `.contact-subfield`
- `.props-header`, `.prop-row` (`.top`), `.prop-label`, `.prop-value`, `.type-pill`
- `.field-add`, `.field-remove`, `.adr-card`, `.bday-input`, `.inline-input`
- `.contact-tag`, `.contact-tag-remove`, `.contact-tag-add`, `.contact-notes`

### Corpo da nota (live preview & render)
- `.wiki-link` — `[[link]]` · `.md-link` — `[texto](url)` · `.tag` — `#tag`
- `.katex-block`, `.math-error` — LaTeX · `.mermaid-block`, `.mermaid-error` — diagramas
- `.cm-block-flash` — destaque ao navegar para um bloco
- `.prose` — markdown renderizado (modo Visualizar) · `.embed-note`, `.embed-img`, `.embed-pdf`

### Overlays
- `.fuzzy-popup`, `.fuzzy-item` (`.selected`), `.fuzzy-empty` — popup de wiki/slash
- `.palette-backdrop`, `.palette-dialog`, `.palette-input`, `.palette-results`, `.palette-item` (`.selected`), `.palette-empty` — Ctrl+P
- `.settings-backdrop`, `.settings-dialog`, `.settings-header`, `.settings-title`, `.settings-close`, `.settings-body`, `.settings-categories`, `.settings-cat` (`.active`), `.settings-content`, `.settings-heading`, `.settings-select`

### Utilitárias (pré-existentes)
`.truncate` `.flex` `.flex-col` `.flex-1` `.items-center` `.gap-1` `.gap-2`

---

## 3. Exemplos de snippet

```css
/* Itens da lista de notas mais compactos + hover roxo */
.note-list-item { padding: 4px 14px !important; }   /* !important: padding é inline-dinâmico em alguns casos */
.note-list-item:hover { background: var(--mauve); } /* cor via variável, sem !important */

/* Aba ativa com underline mais grosso */
.tab-active { border-bottom-width: 3px; }

/* Cantos mais arredondados no app todo (via variável) */
:root { --radius: 10px; }
```

---

## 4. Nota técnica

A maioria dos componentes foi migrada de estilo inline para classes (hover/focus agora são `:hover`/`:focus` em CSS), então snippets mirando as classes acima **geralmente não precisam de `!important`**. As exceções são propriedades que continuam inline por serem **dinâmicas** (derivadas de estado/JS) — para essas, `!important` vence o inline.
