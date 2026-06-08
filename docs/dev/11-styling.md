# Sistema de Estilos

O Ruas usa CSS custom properties (variáveis) baseadas na paleta **Catppuccin** para todo o sistema de cores. **Nunca hardcode valores de cor** — use sempre variáveis.

**Arquivos:**
- `frontend/src/styles/global.css` — variáveis, reset, classes utilitárias, componentes
- `frontend/src/styles/themes.ts` — definições de temas, accents e fontes
- `frontend/src/stores/appearanceStore.ts` — aplicação reativa das variáveis

---

## Variáveis CSS disponíveis

### Paleta de cores (Catppuccin Mocha como base)

| Variável | Uso típico |
|---|---|
| `--crust` | Fundo mais escuro (barra de título, bordas extremas) |
| `--mantle` | Fundo secundário escuro |
| `--base` | Fundo principal da aplicação |
| `--surface0` | Superfície elevada (cards, inputs) |
| `--surface1` | Superfície mais elevada |
| `--surface2` | Superfície ainda mais elevada (hover states) |
| `--overlay0` | Overlay sutil |
| `--overlay1` | Overlay médio |
| `--text` | Texto principal |
| `--subtext` | Texto secundário / labels |
| `--muted` | Texto desabilitado / placeholders |
| `--accent` | Cor de destaque (botões ativos, links) |
| `--accent2` | Cor de destaque secundária |
| `--green` | Sucesso, status "salvo" |
| `--red` | Erro, exclusão |
| `--yellow` | Aviso, status "não salvo" |
| `--teal` | Informação |
| `--pink` | Destaque alternativo |
| `--mauve` | Roxo suave |
| `--peach` | Laranja suave |

### Constantes de layout

| Variável | Valor | Uso |
|---|---|---|
| `--sidebar-w` | `48px` | Largura da barra lateral de módulos |
| `--tabbar-h` | `36px` | Altura da barra de abas de cada painel |
| `--radius` | `6px` | Border-radius padrão |
| `--border` | `1px solid var(--surface0)` | Borda padrão |

---

## Temas (`styles/themes.ts`)

```typescript
interface ThemeDef {
  id: string
  name: string
  dark: boolean
  palette: Record<string, string>  // variável → valor hex
}

// Temas built-in
const themes: ThemeDef[] = [
  { id: 'mocha',     name: 'Mocha',     dark: true,  palette: { base: '#1e1e2e', ... } },
  { id: 'macchiato', name: 'Macchiato', dark: true,  palette: { base: '#24273a', ... } },
  { id: 'frappe',    name: 'Frappé',    dark: true,  palette: { base: '#303446', ... } },
  { id: 'latte',     name: 'Latte',     dark: false, palette: { base: '#eff1f5', ... } },
]

type AccentId = 'default' | 'mauve' | 'lavender' | 'pink' | 'peach' | 'red' | 'yellow' | 'green' | 'teal'

interface FontDef {
  id: string
  label: string
  stack: string  // CSS font-family value
}
// Fonts: 'system', 'inter', 'serif', 'mono'
```

---

## Cascata de CSS (em ordem de aplicação)

```
1. global.css
      Variáveis Catppuccin Mocha (valores padrão)
      Reset CSS (box-sizing, margin, padding)
      Classes utilitárias e componentes base

2. #ruas-builtin  (tag <style> gerenciada por appearanceStore)
      :root { --base: #...; --accent: #...; ... }
      Override das variáveis pelo tema/accent/font selecionados
      font-family: <stack da fonte selecionada>

3. [data-ruas-css="theme:<name>"]  (tag <style>)
      CSS do tema customizado do usuário (de .ruas/themes/)
      Pode sobrescrever qualquer variável ou adicionar estilos

4. [data-ruas-css="snippet:<name>"]  (uma tag por snippet)
      CSS de snippets habilitados (de .ruas/snippets/)
```

---

## `applyBuiltin()` em `appearanceStore`

Chamado automaticamente via `createEffect` ao mudar `theme`, `accent` ou `font`. Constrói a string CSS:

```css
:root {
  --base: #1e1e2e;
  --accent: #cba6f7;
  /* ... todas as variáveis do tema + accent override ... */
}
body { font-family: system-ui, sans-serif; }
```

E injeta em `document.getElementById('ruas-builtin')` (criado se não existir).

---

## Regra: nunca hardcode cores

```tsx
// ❌ Errado
<div style={{ background: '#1e1e2e', color: '#cdd6f4' }}>

// ✓ Correto
<div style={{ background: 'var(--base)', color: 'var(--text)' }}>

// ✓ Correto (via CSS)
.meu-componente { background: var(--surface0); border: var(--border); }
```

---

## Classes CSS de componentes existentes

Ao criar novos componentes, prefira estender estas classes ao invés de criar novas:

| Classe | Descrição |
|---|---|
| `.sidebar`, `.sidebar-btn` | Barra lateral vertical de ícones |
| `.left-panel`, `.left-panel-body`, `.left-panel-footer` | Drawer esquerdo |
| `.panel`, `.panel-focused` | Área de conteúdo do workspace |
| `.tabbar`, `.tab`, `.tab-active`, `.tab-preview` | Barra de abas |
| `.contact-list`, `.note-list` | Layout de lista de entidades |
| `.list-new-btn` | Botão "novo item" em listas |
| `.inline-input` | Input transparente com borda no foco |
| `.fm-row`, `.fm-label`, `.fm-input`, `.fm-tag` | Linhas de formulário (frontmatter) |
| `.right-panel-header`, `.toc-item`, `.backlink-item` | Painel direito |
| `.fuzzy-popup` | Popup de busca fuzzy |
| `.palette-backdrop`, `.palette-dialog` | Command palette |
| `.settings-backdrop`, `.settings-dialog` | Modal de settings |
| `.wiki-link`, `.tag`, `.katex-block`, `.mermaid-block` | Elementos inline do Markdown |
| `.cm-block-flash` | Animação de highlight de bloco |
| `.prose` | Container de renderização Markdown |

---

## `sanitize_user_css` (segurança)

CSS fornecido pelo usuário (de `.ruas/themes/` ou `.ruas/snippets/`) é processado por `core::appearance::sanitize_user_css` antes de ser injetado:

**Remove:**
- `@import` com URLs remotas (`http://`, `https://`, `//`)
- `url(http://...)` e `url(https://...)` em valores de propriedades

**Mantém:**
- `@import` de arquivos locais (entre aspas simples sem protocolo)
- `url()` com data URIs (`data:image/...`)
- Todo o resto do CSS

Isso é defesa em profundidade. A CSP do Tauri (`capabilities/default.json`) também restringe carregamento de recursos externos.

---

## Hot-reload de aparência

Ao modificar um `.css` em `.ruas/themes/` ou `.ruas/snippets/`, o processo é:

```
file watcher (watcher.rs)
  → emit Tauri event 'appearance-changed' para o webview

appearanceStore.ts
  → ouve o evento via invoke('plugin:event/listen', ...)
  → chama reloadAppearance()
    → limpa cssCache (Map<string, string>)
    → re-fetch de list_appearance + get_appearance_config
    → re-injeta CSS do tema/snippets
```

Alterações em `global.css` e `themes.ts` exigem reinicialização do dev server (`pnpm tauri dev`).
