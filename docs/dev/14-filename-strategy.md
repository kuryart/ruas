# Estratégia de nomes de arquivo (`filename.rs`)

Arquivos de entidades (notas, contatos) são nomeados pelo **título/nome da entidade** em vez do UUID. Isso torna o vault legível ao navegar pelo sistema de arquivos diretamente.

A identidade permanente é o `uid` no frontmatter — links internos usam `ruas://entity/UUID`, não o nome do arquivo. O SQLite mapeia UID → path, então renomear arquivos não quebra referências.

---

## Utilitários (`core/src/filename.rs`)

### `sanitize_filename(title: &str) -> String`

Converte um título arbitrário em um stem de arquivo válido para Windows, macOS e Linux.

Regras aplicadas:
- Caracteres proibidos (`/ \ : * ? " < > |`) e caracteres de controle → `_`
- Espaços e pontos no início/fim são removidos (pontos iniciais criariam arquivos ocultos no Unix)
- String vazia após sanitização → `"Untitled"`
- Comprimento máximo: 200 caracteres (deixa margem para o sufixo ` (N)` e a extensão `.md`)

Exemplos:

```
"Minha Nota"       → "Minha Nota"
"file:name/path"   → "file_name_path"
"  .oculto.  "     → "oculto"
""                 → "Untitled"
"João Silva"       → "João Silva"   (Unicode preservado)
```

### `unique_filename(dir: &Path, stem: &str) -> String`

Retorna `"{stem}.md"` se não existe no diretório. Caso contrário, tenta `"{stem} (1).md"`, `"{stem} (2).md"` etc. até encontrar um nome livre.

A verificação usa `Path::exists()`, que respeita a sensibilidade a maiúsculas do sistema de arquivos do host (case-insensitive em macOS/Windows, case-sensitive em Linux).

---

## Rename guard (watcher anti-corruption)

Quando o app renomeia um arquivo no disco (`std::fs::rename`), o file watcher detectaria um `FileDeleted` + `FileCreated` e poderia incorretamente remover e reinserir a entrada do índice — perdendo o mapeamento UID → path durante a janela entre os dois eventos.

O **rename guard** previne isso:

1. Antes de `fs::rename(old, new)`, chamar `ctx.guard_rename(old)` — insere `old` no `Arc<Mutex<HashSet<String>>>` compartilhado com o watcher.
2. O watcher, ao receber `FileDeleted { path }`, verifica se `path` está no guard:
   - **Sim** → remove do guard e ignora o evento (índice já está sendo atualizado via `index.rename`)
   - **Não** → processa normalmente (deleção real pelo usuário)
3. O `FileCreated { new_path }` é sempre processado e reindexa o arquivo com o novo path.

O `index.rename(old, new)` é chamado após `fs::rename`, atualizando `files`, `fts` e `links` numa única transaction SQLite.

### Onde vive o guard

- **`core/src/module.rs`**: `VaultContext` expõe `guard_rename(path)`. `ModuleRegistry` guarda o `Arc` e o injeta via `make_ctx`.
- **`src-tauri/src/lib.rs`**: `RenameGuardState` guarda o mesmo `Arc`. É criado em `run()` e compartilhado com o registry e o watcher.
- **`src-tauri/src/watcher.rs`**: `start()` recebe o `Arc` e o usa no handler de `FileDeleted`.

---

## Fluxo completo de rename ao salvar

```
1. Frontend: save_note({ path, frontmatter: { title: "Novo Título" }, body })
2. Core cmd_save:
   a. Calcula new_stem = sanitize_filename("Novo Título")
   b. Compara com current_stem = Path::new(path).file_stem()
   c. Se diferentes:
      - ctx.guard_rename(old_path)
      - index.rename(old_path, new_path)  ← transaction SQLite
      - fs::rename(old_path, new_path)    ← operação em disco
   d. Escreve conteúdo no new_path
   e. Retorna new_path ao Tauri command
3. Tauri save_note: retorna Option<String> (Some(new_path) ou None)
4. Frontend: se Some(new_path), chama updateNoteTabPath(old, new)
```

---

## Compatibilidade com arquivos legados

Arquivos nomeados com UUID continuam funcionando. O SQLite indexa pelo UID no frontmatter independente do nome do arquivo. O comando de migração (Milestone 5) renomeia arquivos legados em lote, mas é opcional.

A regra de rename na `cmd_save` é universal: se o stem atual não corresponde ao título sanitizado (seja UUID ou título desatualizado), o arquivo é renomeado.
