# Locale - Ruas

## NLP

A aplicação de agenda terá uma função de Natural Language Processing, como no Todoist ou Vikunja. Assim o usuário pode digitar "fazer tal coisa amanhã" e o sistema já cria a tarefa para amanhã, ou "fazer tal coisa próxima semana" e o sistema já cria a tarefa para próxima semana.

Como a aplicação será executada em dispositivos com recursos limitados (smartphones), não podemos carregar modelos de Machine Learning gigantescos para a memória. A abordagem mais eficiente e concisa é criar um analisador léxico (lexer) baseado em Expressões Regulares (Regex) iterativas, que se adapta ao idioma.

### A Arquitetura do Motor NLP em Rust

O design pattern utilizado será o Strategy. O fluxo de processamento deve seguir estas etapas:

- Limpeza: O texto de entrada é normalizado (lowercase, remoção de espaços duplos).
- Deteção de Idioma: Uma biblioteca como a whatlang identifica se o utilizador escreveu em Português ou Inglês.
- Seleção de Estratégia: Com base no idioma, o Core instancia a struct apropriada (ex: PortugueseParser).
- Extração e Redução: O texto passa por filtros (Tags, Projetos, Datas). Cada filtro que encontra um padrão, extrai o dado e remove-o da string original. O que sobrar no final será o título limpo da tarefa.

### Padrão para o comando na Agenda e Notas

Exemplo: Entregar [[nota]] na *próxima semana para @contato referente a +projeto e ao $email #tag-1 #tag-2

### Ideias de bibliotecas

- `whatlang`
- `chrono`
- `chrono-english`

## Frontend

O JSON simples quebra quando se lida com plurals complexos ou gêneros gramaticais (ex: "Você tem 1 nota" vs "Você tem 2 notas"). O estado da arte atual para aplicações FOSS complexas é o Project Fluent, criado pela Mozilla (usado no Firefox). Ele usa arquivos .ftl em vez de JSON.

- Ele permite que os tradutores escrevam lógicas de pluralização e gênero diretamente no arquivo de tradução, tirando o peso de "if/else" do seu código fonte.
- Tanto o Rust (via crate fluent) quanto o ecossistema JS/SolidJS possuem excelente suporte a ele.

### Ideias de bibliotecas

- @solid-primitives/i18n 
- i18next
