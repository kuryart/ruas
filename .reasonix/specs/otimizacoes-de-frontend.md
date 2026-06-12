---
contexto: Documentação referente à implementação de otimizações no frontend
---
# Documentação de Arquitetura: Otimização de Frontend (Filetree e Renderização)

Este documento descreve as estratégias de otimização para a camada de visualização de arquivos do projeto **Ruas**, focadas em garantir performance sob alta carga e manter a fluidez da interface em dispositivos com hardware limitado.

## 1. Princípios Fundamentais

* **Desacoplamento:** A árvore de diretórios (Filetree) e o sistema de busca (Tantivy) possuem papéis distintos. A `Filetree` lida com navegação hierárquica, enquanto o `Tantivy` lida com localização rápida de conteúdo.
* **Virtualização:** A renderização de DOM deve ser estritamente limitada ao que é visível.
* **Latência Zero:** O frontend nunca deve realizar cálculos pesados; ele é um cliente passivo de um Rust Core reativo.

## 2. Estratégia de Navegação (Filetree)

### A. Virtualização de Lista

* **Diretriz:** É proibido renderizar mais de 30-40 itens no DOM simultaneamente.
* **Implementação:** Utilizar bibliotecas de virtualização (*Windowing*) no SolidJS. Os itens da lista devem ser reciclados à medida que o usuário faz o *scroll*.

### B. Lazy Loading Hierárquico

* **Diretriz:** A estrutura completa de diretórios nunca é enviada ao frontend de uma só vez.
* O carregamento é feito sob demanda. O frontend solicita o conteúdo de um diretório apenas quando o usuário expande a pasta.
* O estado da árvore deve ser mantido como uma *flat list* (lista achatada) simples, onde o `indentation_level` é calculado com base na profundidade do `path`.

### C. Abstração de Dados no Backend

* **Diretriz:** Evitar o uso intensivo de I/O (`std::fs`) durante a navegação.
* **Implementação:** O Rust Core deve manter um índice da estrutura de pastas na tabela `folder_structure` dentro do `libSQL`.
```sql
CREATE TABLE folder_structure (
    path TEXT PRIMARY KEY,
    parent_path TEXT,
    folder_name TEXT
);

```

Isso permite que a abertura de pastas seja uma consulta relacional instantânea, em vez de uma varredura de disco.

## 3. Resumo de Responsabilidades

| Função | Frontend (SolidJS) | Rust Core |
| --- | --- | --- |
| **Navegação** | Renderiza itens visíveis (Virtualização) | Consulta `libSQL` para estrutura |
| **Busca (FTS)** | Envia `query` e recebe IDs/Paths | Interroga `Tantivy` |
| **Expansão de Pasta** | Notifica clique, aguarda resposta | `Lazy load` via `libSQL` |
| **Integridade** | Apenas exibe o estado entregue | Monitora mudanças no disco (`notify`) |

## 4. Conclusão para Implementação

A performance da aplicação não reside na capacidade de renderizar o *vault* inteiro, mas na capacidade de **esconder o volume de dados do usuário com eficiência**, expondo apenas o necessário. Ao seguir o padrão de *Lazy Loading* + *Virtualização* + *Índice no libSQL*, a escalabilidade para 100k+ arquivos é garantida sem consumo excessivo de memória, mantendo a responsividade do `SolidJS` sempre na casa dos 60FPS.