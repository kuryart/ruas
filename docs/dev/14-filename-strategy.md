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
- Comprimento máximo: 200 caracteres (deixa margem para o sufixo ` N` e a extensão `.md`)

Exemplos:

```
"Minha Nota"       → "Minha Nota"
"file:name/path"   → "file_name_path"
"  .oculto.  "     → "oculto"
""                 → "Untitled"
"João Silva"       → "João Silva"   (Unicode preservado)
```

### `unique_filename(dir: &Path, stem: &str) -> String`

Retorna `"{stem}.md"` se não existe no diretório. Caso contrário, tenta `"{stem} 1.md"`, `"{stem} 2.md"` etc. até encontrar um nome livre.

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
   a. Calcula desired_stem = sanitize_filename(title.unwrap_or("Untitled"))
   b. Compara com current_stem = Path::new(note.path).file_stem()
   c. Se diferentes, calcula candidate_path = dir.join(desired_stem + ".md")
      - Lê o arquivo em candidate_path (se existir) para verificar o UID
      - Se o UID for diferente → **conflito**: NÃO renomeia, mantém o path antigo
      - Se o UID for igual (mesma entidade já renomeada) → prossegue
      - Se candidate_path não existe → prossegue
      - ctx.guard_rename(old_path)
      - fs::rename(old_path, candidate_path)
      - index.rename(old_path, candidate_path)
   d. Escreve conteúdo no note.path (atualizado se houve rename, ou mantido se houve conflito)
   e. Emite ModuleEvent::NoteSaved { uid }
   f. Retorna o Note completo (com path potencialmente atualizado)
3. Frontend: captura o Note retornado; se result.path !== oldPath:
   - updateNoteTabPath(oldPath, result.path)
   - setActivePath(result.path) (NoteDetail)
```


---

## Compatibilidade com arquivos legados

Arquivos nomeados com UUID continuam funcionando. O SQLite indexa pelo UID no frontmatter independente do nome do arquivo. A regra de rename na `cmd_save` é universal: se o stem atual não corresponde ao título sanitizado (seja UUID ou título desatualizado), o arquivo é renomeado — então arquivos legados com nome UUID são automaticamente renomeados na primeira edição.

## Criação de arquivos

`cmd_create` usa `sanitize_filename` + `unique_filename` para gerar o nome do arquivo no momento da criação:

- Título `"My Note"` → `My Note.md`
- Título `""` → `Untitled.md` (backend fallback; frontend envia título i18n)
- Título `"A/B"` → `A_B.md`
- Título `"Dup"` (já existe `Dup.md`) → `Dup 1.md`
- UID sempre presente no frontmatter como identificador estável para links `ruas://`

## Timing de save do título

O título/nome **não** é salvo automaticamente enquanto o usuário digita. O save dispara apenas:
- **Enter** — faz blur no campo de título, que dispara o save
- **Blur** — quando o campo de título perde o foco
- **Ctrl+S** — atalho manual (salva tudo, incluindo título)

Isso evita renomear o arquivo a cada keystroke e permite que o backend detecte
conflitos de nome de forma determinística.

## Resolução de conflitos

Ao renomear (via `cmd_save`), se o nome desejado já existe no diretório e pertence
a uma entidade **diferente** (UID diferente), o rename é **rejeitado** — o arquivo
mantém o nome antigo. O título no frontmatter é atualizado normalmente.

`unique_filename` é usado apenas na **criação** (`cmd_create`), nunca no `cmd_save`.
Isso garante que o usuário não tenha o arquivo renomeado com sufixos automáticos
inesperados.
