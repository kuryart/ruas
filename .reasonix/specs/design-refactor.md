# Refatoração de design do Ruas

O Ruas precisa de uma refatoração severa de design.

## Como está

Analisar o diretório frontend/ a partir da raiz. Analisar as imagens no diretório docs/screenshots/ruas-old-design/.

## Como deve ficar

Analisar o diretório packages/ruas-design/ a partir da raiz. Analisar as imagens no diretório docs/screenshots/ruas-new-design/.

## Módulos

### Contatos

As informações de contatos ainda serão armazenadas num frontmatter, mas o frontmatter só será visível como texto no modo raw. No modo editar, serão cards com campos editáveis (conforme imagem e código apresentados), e no modo visualizar não serão editáveis. É importante manter o sistema de pastas, categorizando um filetree completo.

### Notas

O frontmatter das notas deve seguir o design do obsidian (ver docs/examples/obsidian-frontmatter-example.png a partir da raiz), isso inclui as tags, portanto ignore o design das tags no novo design. Não é necessário o campo "atualizada há 2h" presente no design novo. Remover os campos "criado" e "modificado" também (mas manter no banco de dados por baixo dos panos para controle interno). As notas exibidas no painel lateral esquerdo não precisam de descrição, manter como já está. Não é necessário os campos mostrando há quanto tempo o arquivo foi editado. É importante manter o sistema de pastas, categorizando um filetree completo.

## Observações

Deve haver uma barra de navegação com:
- Botões avançar/voltar.
- Nome do arquivo sendo editado/visualizado, seja de contato, tarefa (agenda), evento (calendário), nota, assunto (email), nome da conta ou transação (finanças) ou nome do projeto.
- Botões editar/visualizar/raw.

No Ruas atualmente já temos esta barra, seguir a mesma ideia.

Todos os arquivos, com exceção de emails que são arquivos .eml, são arquivos markdown com informações úteis no frontmatter, isso inclui contatos, tarefas, eventos, notas, transações, contas, cards kanban edetalhes do projeto.

Os ícones na barra lateral vertical esquerda podem continuar como estão.

O objetivo é refatorar apenas o design, sem implementar funcionalidades ainda, porém as funcionalidades que já temos **NÃO PODEM QUEBRAR**.

Não é necessário implementar o design de todos os módulos por enquanto. A prioridade são os módulos que já temos (Contatos e Notas).

Utilizar as fontes do novo design como padrão da aplicação.

Manter o tema catppuccin como padrão do sistema.

Manter os botões para retrair/expandir os painéis.

Retirar o botão de dividir painel.
