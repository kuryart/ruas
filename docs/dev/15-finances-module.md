# Módulo de Finanças (`finances.rs`)

O módulo de Finanças gerencia **contas** (accounts) e **transações** (transactions), ambas armazenadas como arquivos Markdown no vault.

---

## Modelo de dados

### Account (conta)

Arquivo `.md` no diretório `finances/accounts/`. Frontmatter:

```yaml
uid: "<uuid>"
name: "Banco X"           # nome da conta
type: "checking"           # checking | savings | credit | cash | investment
currency: "BRL"            # ISO 4217
balance: 150000            # saldo em centavos (1500.00)
opening: "2024-01-01"      # data de abertura
contact_uid: "<uuid>"      # UID do contato vinculado (opcional)
created: "<rfc3339>"
modified: "<rfc3339>"
---
```

Regras:
- `balance` é armazenado em **centavos** (inteiro), evitando problemas de ponto flutuante
- `contact_uid` faz referência a um contato existente via `ruas://entity/<uuid>` — o índice SQLite resolve o link
- O corpo Markdown é livre para anotações sobre a conta

### Transaction (transação)

Arquivo `.md` no diretório `finances/transactions/`. Frontmatter:

```yaml
uid: "<uuid>"
description: "Supermercado"
amount: 8950               # valor em centavos (89.50)
currency: "BRL"
date: "2024-03-15"
from_account: "<account-uid>"   # UID da conta de origem
to_account: "<account-uid>"     # UID da conta de destino
status: "confirmed"             # pending | confirmed | void
tags: ["alimentação"]
created: "<rfc3339>"
modified: "<rfc3339>"
---
```

Regras:
- `amount` é sempre **positivo** (o sentido é dado por `from_account` → `to_account`)
- `from_account` pode ser vazio (entrada externa, ex: salário) — nesse caso é uma transação de **entrada** (income)
- `to_account` pode ser vazio (saída externa, ex: despesa) — nesse caso é uma transação de **saída** (expense)
- Ambos preenchidos = **transferência** entre contas
- `status`: `pending` → transação ainda não confirmada; `confirmed` → transação validada e contabilizada; `void` → transação anulada

### Metadata (listagem leve)

Para listagem no frontend sem enviar o corpo Markdown:

```rust
pub struct AccountMeta {
    pub path: String,
    pub name: String,
    pub balance: i64,
    pub currency: String,
}

pub struct TransactionMeta {
    pub path: String,
    pub description: String,
    pub amount: i64,
    pub date: String,
    pub from_account: Option<String>,
    pub to_account: Option<String>,
    pub status: String,
}
```

---

## Validação de transações

### No momento da criação/edição

Ao criar ou editar uma transação, o backend deve validar:

1. **Contas existem**: `from_account` e `to_account` (se preenchidos) devem referenciar UIDs de contas existentes no vault
2. **Saldo suficiente**: se `from_account` está preenchido, `balance - amount >= 0` (contas de crédito podem ter saldo negativo conforme o limite configurado)
3. **Contas diferentes**: `from_account != to_account` (uma transferência para a mesma conta é inválida)
4. **Consistência de moeda**: se ambas as contas existem, devem usar a mesma `currency`

### Estado inconsistente (raw mode ou edição externa)

Se um arquivo é editado externamente (ou via raw mode) e quebra as validações:

- O **índice** marca a transação como `status = "invalid"` ou adiciona um campo `validation_error: String` nos metadados indexados
- O **frontend** exibe um indicador visual (ícone de ⚠️) na transação com tooltip explicando o erro
- O **saldo** da conta não é recalculado para transações inválidas
- O arquivo em disco **não é alterado** pelo módulo — a correção é responsabilidade do usuário

### Revalidação em lote

No `on_vault_open`, o módulo varre todas as transações e revalida. Transações que antes eram válidas podem se tornar inválidas se a conta referenciada foi deletada ou renomeada. O índice é atualizado com o status corrente.

---

## Cálculo de saldo

O saldo de uma conta (`balance` no frontmatter) é o **saldo confirmado pelo usuário** — não é calculado automaticamente a partir das transações. Isso evita dessincronização com extratos bancários reais e permite reconciliação manual.

Opcionalmente, o sistema pode exibir um **saldo calculado** (soma de todas as transações confirmadas) ao lado do saldo declarado, com um indicador de divergência (⚠️) se os valores não batem.

---

## Linking com contatos

O campo `contact_uid` no frontmatter da conta referencia um contato pelo UID. Isso permite:

- Exibir o nome do contato vinculado na lista de contas
- No detalhe do contato, listar as contas associadas
- Filtrar transações por contato (via conta vinculada)

O link usa `ruas://entity/<uid>` — o índice SQLite resolve UID → path. Se o contato for deletado, o campo `contact_uid` permanece no arquivo (como dangling reference) e o frontend exibe "Contato não encontrado".

---

## Estrutura de diretórios

```
<vault>/finances/
├── accounts/
│   ├── Banco X.md
│   └── Carteira.md
└── transactions/
    ├── 2024-03-15-supermercado.md
    └── 2024-03-20-salario.md
```

Os nomes de arquivo seguem a mesma estratégia do restante do projeto (`sanitize_filename` + `unique_filename`), usando `name` (para contas) e `description` (para transações) como base do nome. Ver `docs/dev/14-filename-strategy.md`.

---

## Checklist de implementação

Seguindo o guia `12-howto-new-module.md`:

1. **Core**: `core/src/finances.rs` — structs (`Account`, `Transaction`, `AccountMeta`, `TransactionMeta`), parse/serialize, `FinancesModule` implementando `Module`
2. **Tauri**: `frontend/src-tauri/src/finances.rs` — comandos tipados
3. **Registro**: adicionar `FinancesModule::default()` ao `ModuleRegistry` em `src-tauri/src/lib.rs`
4. **Workspace**: `TabContent` variants (`finances-accounts-list`, `finances-account-detail`, `finances-transactions-list`, `finances-transaction-detail`)
5. **UI**: `components/finances/` com `AccountsList.tsx`, `AccountDetail.tsx`, `TransactionsList.tsx`, `TransactionDetail.tsx`
6. **Sidebar**: botão "Finanças" em `Sidebar.tsx`
7. **i18n**: `locales/en-US/finances.ftl` e `locales/pt-BR/finances.ftl`
8. **Testes**: unitários em `finances.rs`, integração em `core/tests/integration.rs`
