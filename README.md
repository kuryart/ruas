# Ruas

Ruas é um cross-platform, privacy-first, self-hosted, all-in-one app de produtividade. 
O nome Ruas é a junção de Rust + Astro, pois o sistema é feito usando Rust (Tauri) e Astro.
Ruas também significa Rapid Universal Annotation System.
Em português, "ruas" significa "streets", o que remete às conexões (grafos) feitas pelo app.

A ideia é reunir as principais funções de um app de produtividade: Contatos, Agenda, Calendário, Projetos, Notas e Email, tudo orientado a markdown, no estilo Obsidian, Notion, Logseq ou AnyType. O app oferecerá integrações com outros apps, plugins e integração com IA.

## Modelo de negócio

- Plano self-hosted free
- Plano pro com sync dos dispositivos em nuvem
- Plano pro+ com sync dos dispositivos em nuvem e IA

## Stack

- Tauri
- Astro
- SQLite (como indexador)
- Axum.

## Plataformas

- Desktop
- Mobile
- Web (apenas do plano pro para cima)

## Estrutura

ruas/
├── core/           # core do sistema
├── api/             # api web
└── frontend/
   ├── src           # frontend web
   └── src-tauri/ # desktop/mobile

## Protocolo próprio

ruas://[módulo]/[evento]

## Email

O email client utiliza JMAP ou IMAP.

### Cache (SQLite) vs. Arquivamento (.eml / .md)

Para manter o sistema de arquivos limpo e o app rápido:

1. O Ruas usa o JMAP para sincronizar os e-mails para o **SQLite local**. O SQLite é o banco de busca e leitura rápida.
2. Quando o usuário quer "vincular" um e-mail a uma nota ou projeto:
    - O Ruas gera um arquivo `.eml` em uma pasta específica (ex: `~/ruas/attachments/emails/`).
    - Na nota Markdown, o link fica: `[Assunto do Email](ruas://email/id_do_arquivo)`.

### Sanitização de HTML e Segurança

- Usar uma biblioteca de sanitização no Rust (como a `ammonia`) antes de passar o corpo do e-mail para o frontend.
- **Isolamento:** Renderizar o corpo do e-mail em um `<iframe>` com o atributo `sandbox` ativado. Isso impede que qualquer rastreador de e-mail ou script acesse os cookies locais ou o sistema de arquivos através da ponte do Tauri.

### Busca (FTS5)

- O SQLite permite criar tabelas virtuais de busca rápida. O Rust vai indexar o _texto puro_ (convertendo o HTML do e-mail em Markdown/Text simplificado) no banco.
- **Multilingual:** Usar `whatlang` para detectar a língua do e-mail e aplicar o _stemmer_ correto (português ou inglês) na indexação.

## Plugins 

- WASM para lógica
- JS para UI

## Contatos

- Integração com cardDAV
- Buscar contato utilizando @ e criar link
- Contatos serão notas markdown com dados no frontmatter

## Agenda

- Integração com cardDAV
- Tarefas serão notas markdown com dados no frontmatter
- Para adicionar tarefa, pressionar ctrl+P para abrir a command palette, selecionar "Adicionar nota", digitar em linguagem natural, e o sistema identifica os wildcards e palavras-chave, semelhante ao Todoist ou ao Vikunja. Exemplo: "fazer tal coisa amanhã +projeto \*tag1 \*tag2", e o sistema cria uma entrada "- [ ] fazer tal coisa amanhã +projeto \*tag1 \*tag2", mas o sistema renderiza uma checkbox, "fazer tal coisa amanhã", um badge com "07/02", um badge com "tag1" e um badge com "tag2".
- O sistema deve ser multilingual, e reconhecer termos em várias línguas.

## Calendário

- Integração com calDAV
- Entradas no calendário serão notas markdown com dados no frontmatter
- Opções na command palette para mover tarefas para o calendário e vice-versa
- Criar múltiplos calendários, com opção de mesclar calendários em um só

## Notas

- Sistema semelhante ao Obsidian, Notion, AnyType, Logseq.

## Projetos

- Projetos contém tasks, contatos, calendários, notas, e um dashboard.

## Sync

- State-based (estilo Obsidian)
- Criptografia E2EE.

## Arquitetura

### File System Watcher

O Core precisa monitorar a pasta de notas. Sempre que um arquivo `.md` mudar externamente, o Core deve re-indexar os metadados (Frontmatter, tags, links) no SQLite de forma transparente.

### Versionamento e Conflitos

Sistema last-write-wins (o último a escrever ganha), mas criar um `nota.conflicted.md`.

### Gerenciamento de Anexos

Definir uma pasta `_resources` ou `_assets`. O SQLite precisa indexar esses arquivos para que a busca por "Partitura" retorne o PDF, não apenas a nota que o cita.

### Abstração do Protocolo `ruas://`

Em vez de `ruas://nota/caminho/para/arquivo.md`, usar `ruas://entity/[UUID]`. O SQLite resolve onde esse UUID está no disco. Isso permite que o usuário renomeie pastas no SO sem quebrar os links dentro do app.

### Plugin Host Context

Como o frontend e o WASM se comunicam? Os plugins WASM devem rodar no Core para ter acesso a performance e segurança. O Frontend apenas solicita ao Core: "Execute a função X do plugin Y e me dê o resultado para eu renderizar".

### Tipos de Conexão

Os nós dos grafos gerados podem ter um tipo específico (Contato, Tarefa, Entrada no Calendário, Nota, Email, Projeto), e as conexões entre os nós também, exemplos:

- Mentions: Uma nota cita um @contato.
- DependsOn: Uma task precisa de outra.
- Origin: Um e-mail que gerou uma nota.
- BelongsTo: Uma nota que faz parte de um +projeto

### Architecture

![Architecture](docs/architecture.png)
