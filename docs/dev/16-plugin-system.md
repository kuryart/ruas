# Sistema de Plugins do Ruas — Análise e Roadmap

> **Status:** Fases A, A.2, B, C, D e E concluídas. O pipeline de plugins está completo: descoberta, registro, UI de gerenciamento, WASM runtime (Extism, feature-gated), hooks de extensão no frontend, marketplace store, API HTTP com rotas de plugins, diálogo de permissão, e PDK documentado.

---

## 1. Visão geral

O Ruas foi projetado para suportar dois tipos de extensões:

| Tipo | Exemplos | Status |
|---|---|---|
| **Módulos built-in** (`TrustLevel::Core`) | Contacts, Notes, Agenda, Calendar, Projects, Email, Finances | Contacts e Notes implementados; os demais são stubs planejados |
| **Plugins de terceiros** (`TrustLevel::Plugin`) | Integrações (CardDAV, CalDAV, JMAP), temas avançados, novos tipos de entidade, comandos de automação | **Arquitetura pronta, implementação ausente** |

A fundação é o `Module` trait em `ruas_core`, que define um contrato uniforme de 9 métodos. Todo módulo — built-in ou plugin — implementa esse mesmo trait.

---

## 2. O que já existe (fundação pronta)

### 2.1 `Module` trait (`core/src/module.rs`)

```rust
pub trait Module: Send + Sync {
    fn info(&self) -> &ModuleInfo;                              // identidade (obrigatório)
    fn capabilities(&self) -> &[Capability] { &[] }            // recursos que precisa
    fn settings_schema(&self) -> &[SettingField] { &[] }       // campos configuráveis
    fn commands(&self) -> &[CommandDescriptor] { &[] }         // manifesto de comandos
    fn dispatch(&self, cmd: &str, args: Value, ctx: &VaultContext) -> DispatchResult;
    fn on_vault_open(&self, ctx: &VaultContext) -> Result<(), String> { Ok(()) }
    fn on_vault_close(&self, ctx: &VaultContext) {}
    fn on_event(&self, event: &ModuleEvent, ctx: &VaultContext) {}
}
```

O trait é **intencionalmente minimalista** para que plugins WASM possam implementá-lo sem dependências pesadas.

### 2.2 `ModuleRegistry` — despacho genérico com enforcement de capabilities

- `register(module)` — registra módulos built-in (`TrustLevel::Core`, todas as capabilities pré-aprovadas)
- `dispatch(module_id, command, args, vault_path)` — despacha comandos; **plugins** passam por verificação de capabilities antes do dispatch
- `on_vault_open` / `on_vault_close` — broadcasting de lifecycle para todos os módulos
- Eventos emitidos durante o dispatch são coletados via `BufferedSink` e re-despachados após o comando original terminar (evita re-entrância)

### 2.3 Sistema de capabilities (`core/src/module/capability.rs`)

```rust
pub enum Capability { VaultRead, VaultWrite, IndexRead, IndexWrite, CrossModuleRead, Network }
pub enum TrustLevel { Core, Plugin }
```

- **Core**: todas as capabilities são implicitamente aprovadas
- **Plugin**: cada capability deve ser aprovada individualmente pelo usuário; o registry bloqueia dispatch que use capability não aprovada

### 2.4 Persistência de configurações por módulo (`core/src/module/settings.rs`)

```
<vault>/.ruas/modules/<sanitized-module-id>/config.json
```

API: `get_all()`, `get(key)`, `set(key, value)`, `set_all(values)`. Schema de settings declarado via `settings_schema()`.

### 2.5 Sistema de eventos (`core/src/module/event.rs`)

```rust
#[non_exhaustive]
pub enum ModuleEvent {
    VaultOpened, VaultClosed,
    FileCreated { path }, FileModified { path }, FileDeleted { path },
    ContactSaved { uid }, ContactDeleted { uid },
    NoteSaved { uid }, NoteDeleted { uid },
}
```

### 2.6 Comandos Tauri genéricos para módulos (`frontend/src-tauri/src/lib.rs`)

| Comando Tauri | Propósito |
|---|---|
| `invoke_module(module_id, command, args)` | Dispatch genérico — entrada principal para plugins |
| `list_modules()` | Lista todos os módulos registrados com metadados (id, nome, versão, trust, capabilities, comandos, schema de settings) |
| `get_module_settings(module_id)` | Lê configuração persistida de um módulo |
| `set_module_settings(module_id, settings)` | Salva configuração de um módulo |

**Importante:** Nenhum desses comandos é chamado pelo frontend hoje. O frontend usa comandos tipados (`list_contacts`, `create_note`, etc.) que são thin adapters sobre `ModuleRegistry::dispatch`. Plugins usariam `invoke_module` e `list_modules` diretamente.

### 2.7 UI de Plugins no Settings (`frontend/src/components/settings/SettingsModal.tsx`)

A categoria "Plugins" existe com duas sub-abas:

- **Plugins nativos** — barra de pesquisa + área de lista vazia
- **Plugins da comunidade** — toggle "Ativado", botões "Procurar" / "Atualizar", toggle "Atualizar automaticamente", barra de pesquisa, área de lista vazia

Toda a UI é um **shell estilizado sem backend**. Os botões têm handlers vazios (`{ /* placeholder */ }`) e a lista de plugins é um placeholder hardcoded.

### 2.8 Único hook de extensão no editor (`languageSupport.ts`)

```ts
export function registerLanguage(name: string, factory: Loader, alias: string[] = [])
```

Permite que plugins registrem syntax highlighting para linguagens de código adicionais em fenced code blocks. É o **único ponto de extensão runtime funcional** no frontend hoje.

---

## 3. O que falta (gap analysis)

**Atualização:** Fases A e A.2 concluídas. Fase C (hooks de extensão) parcialmente concluída.

### 3.1 Plugin Loader — carregamento e instalação — ✅ Parcialmente implementado

- **Descoberta**: ✅ `discover_plugins()` em `core/src/plugin.rs` escaneia `<vault>/.ruas/plugins/`
- **Carregamento**: ❌ Falta runtime WASM (Extism — Fase B)
- **Instalação**: ❌ Falta download de marketplace (Fase D)
- **Desinstalação**: ✅ `uninstall_plugin` comando Tauri remove diretório do plugin
- **Atualização**: ❌ Falta verificação de versão contra marketplace (Fase D)

### 3.2 WASM runtime — ❌ Não implementado

### 3.3 Plugin Store / Marketplace — ❌ Não implementado

### 3.4 Sandbox e segurança — ✅ Capability enforcement existe; ❌ Sandbox WASM não

### 3.5 Frontend Plugin Store — ✅ Implementado

- ✅ `frontend/src/stores/pluginsStore.ts` — resource com `createResource` buscando `list_plugins`
- ✅ `PluginsPanel` atualizado com cards reais (busca, filtro, enable/disable, uninstall)
- ✅ `PluginCard` component com capabilities, trust badge, toggle

### 3.6 Hooks de extensão no frontend — ✅ Parcialmente implementado

- ✅ `extensionsStore.ts` com `registerTabRenderer`, `registerSidebarButton`, `registerSlashCommand`, `registerMarkdownRenderer`
- ✅ `TabContent` agora tem variante `{ type: 'plugin', pluginId, viewId, payload }`
- ✅ `PanelView` renderiza plugins via `getTabRenderer()`
- ✅ `openPluginView()` no workspaceStore

### 3.7 API HTTP para plugins — ❌ Não implementado

### 3.8 Gerenciamento de ciclo de vida — ❌ Não implementado

### 3.1 Plugin Loader — carregamento e instalação

**Não existe.** Falta todo o pipeline:

- **Descoberta**: como o Ruas descobre plugins instalados? (scan de diretório? manifesto?)
- **Carregamento**: como um plugin WASM (ou JS) é carregado em runtime?
- **Instalação**: como o usuário instala um plugin? (arrastar arquivo? marketplace? git clone?)
- **Desinstalação**: como remover um plugin com segurança?
- **Atualização**: como detectar e aplicar updates?

**Diretório escolhido** (seguindo o padrão do sistema): `<vault>/.ruas/plugins/<plugin-id>/`

### 3.2 WASM runtime

**Não existe.** Nenhuma dependência de runtime WASM (`wasmtime`, `wasmer`, `wasi`) está presente em qualquer `Cargo.toml`. O `Module` trait foi projetado para ser implementável por plugins WASM, mas o executor não existe.

Alternativas a considerar:
- **Wasmtime** — runtime WASM embedado em Rust, com suporte a WASI para I/O sandboxado
- **Extism** — framework de plugins com SDK para múltiplas linguagens, já lida com sandbox e bindings
- **RLua/mlua** — Lua embutido como alternativa mais simples (sem sandbox de memória, mas com I/O controlável)

Alternativa escolhida: Extism.

### 3.3 Plugin Store / Marketplace

**Não existe.** O botão "Procurar" na UI de Plugins da Comunidade não tem backend. Seria necessário:

- Um repositório central (GitHub repo? API própria?) com índices de plugins
- Metadados: nome, id, versão, descrição, autor, capabilities requeridas, hash de integridade
- API de busca e download
- Verificação de compatibilidade de versão (`Version` já existe no core)

Proposta: arquivo de manifest.json; código em um repositório público do github; enviar pull request para o repositório ruas-plugins; estrutura semelhante ao obsidian.

### 3.4 Sandbox e segurança

**Parcialmente implementado.** O enforcement de capabilities via `ModuleRegistry::check_capabilities` existe, mas só é relevante quando há um `TrustLevel::Plugin` — e hoje nenhum plugin é registrado.

O que falta:
- **Sandbox de I/O**: plugins WASM não devem acessar o filesystem diretamente — devem passar pelo `VaultContext`
- **Limite de recursos**: CPU, memória, e tempo de execução por dispatch
- **Assinatura/verificação**: plugins distribuídos devem ter assinatura criptográfica verificável
- **Reviewed/Trusted**: mecanismo de curadoria (manual ou comunidade) para plugins verificados

### 3.5 Frontend Plugin Store

**Não existe.** O frontend não tem:

- Nenhum store JavaScript para estado de plugins (lista, enabled/disabled, config)
- Nenhuma chamada a `list_modules` ou `invoke_module`
- Nenhum componente de UI para gerenciar plugins além do shell estático no Settings
- Nenhum mecanismo de permissão (diálogo "Plugin X quer acessar Y. Permitir?")

### 3.6 Hooks de extensão no frontend

**Quase inexistente.** Só `registerLanguage()` para CodeMirror. Faltam hooks para:

- Registrar novos tipos de `TabContent` (para que plugins possam abrir views customizadas no workspace)
- Registrar sidebar buttons (para novos módulos)
- Registrar menu items de contexto
- Registrar comandos de slash (`/`)
- Registrar renderers de markdown (blocos customizados)
- Registrar formatos de embed (`![[...]]`)

### 3.7 API HTTP para plugins

**Não existe.** `api/src/main.rs` não tem rotas para `list_modules`, `invoke_module`, etc. O servidor HTTP expõe apenas os comandos tipados de contacts e notes. Para consistência com o Tauri, seria necessário adicionar rotas equivalentes.

### 3.8 Gerenciamento de ciclo de vida

**Não existe.** Faltam:

- Ativação/desativação de plugins em runtime (sem reiniciar o app)
- Dependências entre plugins
- Ordem de carregamento
- Isolamento de falhas (um plugin com erro não pode derrubar o app)

---

## 4. Caminho recomendado (fases)

### Fase A — Frontend Plugin Store (sem WASM, só UI + backend Rust)

1. Criar `frontend/src/stores/pluginsStore.ts` com signals para `plugins()`, `enabledPlugins()`, `pluginSettings()`
2. Conectar a UI do Settings `PluginsPanel` ao store — popular a lista de plugins nativos chamando `list_modules()`, adicionar toggle enable/disable
3. Criar componente `PluginCard` para exibir cada plugin com nome, versão, descrição, capabilities, toggle enable, botão settings
4. Adicionar seletor de permissões (quando um plugin novo é habilitado, mostrar diálogo de capabilities)

### Fase B — Instalação baseada em diretório (sem WASM)

1. Definir diretório `<vault>/.ruas/plugins/` como local de plugins
2. Implementar `PluginManifest` (JSON com id, nome, versão, capabilities, entry point)
3. Criar `PluginLoader` em Rust que escaneia o diretório e registra plugins como `TrustLevel::Plugin` no registry
4. Implementar carregamento de plugins Rust nativos via `libloading` (dlopen) como prova de conceito
5. Adicionar comandos Tauri: `install_plugin`, `uninstall_plugin`, `enable_plugin`, `disable_plugin`

### Fase C — WASM runtime

1. Adicionar `wasmtime` como dependência
2. Implementar `WasmPlugin` que carrega um `.wasm`, instancia com imports controlados (só `VaultContext`), e implementa `Module` trait
3. Sandbox: sem acesso a filesystem, network, ou threads próprias; toda I/O passa por imports WASI controlados
4. Definir ABI estável para plugins (funções exportadas: `info`, `capabilities`, `dispatch`, etc.)

### Fase D — Marketplace

1. API de catálogo (repositório Git público com index JSON)
2. UI de busca/browse/download no settings de plugins da comunidade
3. Verificação de integridade (hash) e compatibilidade de versão
4. Auto-update baseado em polling do repositório

---

## 5. Arquivos e caminhos relevantes

| Arquivo | Papel no sistema de plugins |
|---|---|
| `core/src/module.rs` | `Module` trait, `ModuleInfo`, `VaultContext`, `ModuleRegistry`, `Version`, `register_plugin`, `unregister`, `set_plugin_approved` |
| `core/src/module/capability.rs` | `Capability`, `TrustLevel` |
| `core/src/module/command.rs` | `CommandDescriptor`, `ParamDescriptor`, `ParamKind` |
| `core/src/module/event.rs` | `ModuleEvent`, `EventSink`, `BufferedSink`, `NoopSink` |
| `core/src/module/settings.rs` | `ModuleSettings`, `SettingField`, `SettingKind`, `SelectOption` |
| `core/src/plugin.rs` | `PluginManifest`, `discover_plugins`, `load_manifest`, directory helpers, testes |
| `frontend/src-tauri/src/lib.rs` | `build_registry()`, `invoke_module`, `list_modules`, `get/set_module_settings`, plugin commands registration |
| `frontend/src-tauri/src/plugins.rs` | `list_plugins`, `enable_plugin`, `disable_plugin`, `uninstall_plugin` — comandos Tauri |
| `frontend/src/stores/pluginsStore.ts` | `plugins()` resource, `enablePlugin`, `disablePlugin`, `uninstallPlugin`, `refreshPlugins`, `capabilityLabel` |
| `frontend/src/stores/extensionsStore.ts` | `registerTabRenderer`, `registerSidebarButton`, `registerSlashCommand`, `registerMarkdownRenderer`, `getTabRenderer`, `openPluginView` |
| `frontend/src/components/settings/SettingsModal.tsx` | `PluginsPanel` — UI conectada ao store, `PluginCard` component |
| `frontend/src/components/workspace/PanelView.tsx` | Suporte a tabs de plugins via `getTabRenderer()` |
| `frontend/src/components/workspace/workspaceStore.ts` | `TabContent` com variante `plugin`, `openPluginView()` |
| `frontend/src/components/shared/editor/languageSupport.ts` | `registerLanguage()` — único hook extensível |
| `frontend/src/locales/en-US/settings.ftl` | i18n: `settings-plugins-*` |
| `frontend/src/locales/pt-BR/settings.ftl` | i18n: `settings-plugins-*` |
| `docs/dev/02-core-module-system.md` | Documentação existente do sistema de módulos |
