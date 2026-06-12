# Arquitetura de Busca Inteligente

O Ruas implementa um sistema de busca em três camadas, combinando busca textual (Tantivy BM25), rastreamento de uso (Frecency) e contexto hierárquico de diretórios.

---

## 1. Arquitetura CQRS

```
┌──────────┐     ┌───────────┐     ┌──────────────────┐
│ Frontend │ ←→  │ Rust Core │ ←→  │ Tantivy (FTS)    │
└──────────┘     └───────────┘     └──────────────────┘
                      ↕
                 ┌──────────────────────────┐
                 │ libSQL (Metadados+Outbox) │
                 └──────────────────────────┘
                      ↕
                 ┌──────────────────┐
                 │ Disco (Arquivos) │
                 └──────────────────┘
```

- **libSQL**: write-side. Persistência ACID de metadados (`files`, `links`), tracking de frecency (`times_opened`, `last_access`), e fila de indexação assíncrona (`outbox`).
- **Tantivy**: read-side. Índice FTS otimizado para busca com BM25, field boosting, stemming, e fuzzy finding.
- **IndexWorker**: worker assíncrono que consome a `outbox` e atualiza o Tantivy em background.

---

## 2. Fluxo de indexação assíncrona

### 2.1 Salvamento

1. Módulo (ex.: Notes) chama `IndexManager::upsert()`.
2. libSQL executa transação ACID: `files` + `fts` + `outbox`.
3. Após commit, dispara `tx.send(())` no canal MPSC (fire-and-forget, não bloqueia a UI).
4. Frontend recebe resposta instantaneamente.

### 2.2 Worker (background)

1. **Crash recovery**: na inicialização, drena toda a `outbox` (processa pendências de encerramento abrupto).
2. **Loop reativo**: bloqueia em `rx.recv().await` → drena `outbox` em batches de 256 → processa cada entrada → ack.
3. **Processamento**: para `upsert`, lê o arquivo do disco, aplica **Pop & Mutate** (§4.2), indexa no Tantivy. Para `delete`, remove do Tantivy.
4. **Shutdown**: ao dropar o sender (`on_vault_close`), worker drena o batch final e encerra.

### 2.3 Pop & Mutate (§4.2)

Antes de indexar no Tantivy, o worker faz parse do YAML frontmatter:

1. Extrai `tags` e `aliases` para seus campos dedicados no schema do Tantivy.
2. Remove essas chaves do objeto YAML.
3. Serializa o restante como JSON para o campo `fm`.

Isso evita **double-dipping**: o mesmo dado nunca pontua duas vezes no BM25.

---

## 3. Schema do Tantivy

| Campo    | Tipo                          | Peso BM25 |
|----------|-------------------------------|-----------|
| `uid`    | STORED + STRING               | —         |
| `path`   | STORED + STRING               | —         |
| `entity` | STORED + STRING               | —         |
| `title`  | STORED + TEXT (stemming)      | 3.0       |
| `aliases`| STORED + TEXT (stemming)      | 3.0       |
| `tags`   | STORED + TEXT (raw tokenizer) | 2.0       |
| `fm`     | STORED + TEXT (stemming)      | 1.5       |
| `body`   | STORED + TEXT (stemming)      | 1.0       |

- Tokenizer padrão: `SimpleTokenizer → LowerCaser → Stemmer(English)`.
- `tags` usa `RawTokenizer` (sem stemming/splitting) para matching exato.

---

## 4. Busca inteligente — Fórmula de scoring

```
Score_Final = BM25_Score × times_opened × time_multiplier × context_multiplier
```

### 4.1 Passo A — BM25 (Tantivy)

O Tantivy executa a busca com field boosting configurado no schema. Retorna os top 50 hits com scores brutos.

### 4.2 Passo B — Frecency (libSQL)

O Rust Core carrega `times_opened` e `last_access` em batch da tabela `files`.

### 4.3 Passo C — Scoring final

O scorer calcula o `Score_Final` combinando BM25 com os multiplicadores.

---

## 5. Multiplicador de Tempo (Frecency)

Inspirado no Zoxide, baseado no tempo decorrido desde `last_access`:

| Tempo desde último acesso | Multiplicador |
|---------------------------|---------------|
| < 1 hora                  | 8x            |
| < 1 dia                   | 4x            |
| < 1 semana                | 2x            |
| < 1 mês                   | 1x (neutro)   |
| > 1 mês                   | 0.5x          |
| Nunca acessado            | 0.5x          |

### Aging (Envelhecimento)

Quando `SUM(times_opened)` atinge 10.000, todos os valores são divididos por 2. Valores < 1 são zerados. Isso evita que notas muito acessadas criem pontuações intocáveis.

---

## 6. Multiplicador de Contexto Hierárquico

Baseado na distância entre o diretório do resultado e o diretório da **última entidade selecionada** pelo usuário:

| Distância                      | Fórmula      | Multiplicador |
|--------------------------------|--------------|---------------|
| Nível 0 (mesmo diretório)      | `16 >> 0`    | 16x           |
| Nível 1 (pai/filho direto)     | `16 >> 1`    | 8x            |
| Nível 2 (avô/neto)             | `16 >> 2`    | 4x            |
| Nível 3                        | `16 >> 3`    | 2x            |
| Nível 4+ (sem relação)         | `16 >> 4`    | 1x (neutro)   |
| Nenhuma entidade selecionada   | —            | 1x (neutro)   |

A "última entidade selecionada" é rastreada em memória (`Arc<RwLock<Option<String>>>` no `ModuleRegistry`). O frontend chama `set_last_selected_entity(path)` sempre que o usuário clica em qualquer entidade (nota, contato, etc.). O path é usado para derivar o diretório de contexto.

---

## 7. Rastreamento de acesso (Frecency)

Quando o usuário abre uma entidade, o frontend chama `record_access(path)` (fire-and-forget). O backend:

1. Incrementa `times_opened` em 1.
2. Atualiza `last_access` para `now()`.
3. Verifica o threshold de aging (`SUM(times_opened) >= 10.000`). Se atingido, executa o aging.

---

## 8. Tauri Commands

| Comando | Descrição |
|---|---|
| `search_index(query, limit)` | Busca completa: Tantivy → scorer → resultado |
| `record_access(path)` | Incrementa frecency da entidade acessada |
| `set_last_selected_entity(path)` | Define o contexto hierárquico para busca |

---

## 9. Testes

- **Unitários**: Tantivy schema/tokenizer, Pop & Mutate, scorer (tempo, contexto, aging).
- **Integração**: pipeline completo — criar nota → libSQL + outbox → worker → Tantivy → busca com scoring.
- **FTS5 fallback**: testes in-memory continuam usando FTS5 (Tantivy requer diretório em disco).

---

## 10. Busca semântica (futuro)

A busca semântica (vetores + ONNX) será implementada na fase de integração com IA. O libSQL já possui suporte a vetores (`libsql` >= 0.9 com resource limitations), e o modelo de embedding será carregado via ONNX/Candle.
