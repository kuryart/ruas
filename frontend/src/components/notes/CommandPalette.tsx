import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { useI18n } from '../../i18n/context';
import { invoke } from '../../utils/api';
import { paletteOpen, setPaletteOpen } from '../../stores/paletteStore';
import { openNotePermanent } from '../workspace/workspaceStore';

interface NoteMeta { path: string; title: string }

/** Global quick-open palette (Ctrl+P): fuzzy-search notes by title and open. */
export default function CommandPalette() {
  const { t } = useI18n();
  const [query, setQuery] = createSignal('');
  const [results, setResults] = createSignal<NoteMeta[]>([]);
  const [selected, setSelected] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;
  let token = 0;

  const close = () => { setPaletteOpen(false); setQuery(''); setResults([]); setSelected(0); };

  // Fetch results whenever the palette opens or the query changes.
  createEffect(() => {
    if (!paletteOpen()) return;
    const q = query();
    const my = ++token;
    invoke<NoteMeta[]>('search_notes', { query: q })
      .then(r => { if (my === token) { setResults(r); setSelected(0); } })
      .catch(() => { if (my === token) setResults([]); });
  });

  // Focus the input on open.
  createEffect(() => {
    if (paletteOpen()) queueMicrotask(() => inputRef?.focus());
  });

  function pick(note: NoteMeta) {
    openNotePermanent(note.path, note.title);
    close();
  }

  function onKeyDown(e: KeyboardEvent) {
    const list = results();
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setSelected(i => Math.min(list.length - 1, i + 1)); break;
      case 'ArrowUp':   e.preventDefault(); setSelected(i => Math.max(0, i - 1)); break;
      case 'Enter':     if (list[selected()]) { e.preventDefault(); pick(list[selected()]); } break;
      case 'Escape':    e.preventDefault(); close(); break;
    }
  }

  // Esc handling also when focus is elsewhere inside the modal.
  createEffect(() => {
    if (paletteOpen()) {
      const h = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
      window.addEventListener('keydown', h);
      onCleanup(() => window.removeEventListener('keydown', h));
    }
  });

  return (
    <Show when={paletteOpen()}>
      <Portal>
        <div class="palette-backdrop" onClick={close}>
          <div class="palette-dialog" onClick={e => e.stopPropagation()}>
            <input
              ref={inputRef}
              class="palette-input"
              type="text"
              value={query()}
              placeholder={t('notes-palette-placeholder')}
              onInput={e => setQuery((e.target as HTMLInputElement).value)}
              onKeyDown={onKeyDown}
            />
            <div class="palette-results">
              <Show
                when={results().length}
                fallback={<div class="palette-empty">{t('notes-no-results')}</div>}
              >
                <For each={results()}>
                  {(note, i) => (
                    <div
                      class="palette-item"
                      classList={{ selected: selected() === i() }}
                      onMouseEnter={() => setSelected(i())}
                      onClick={() => pick(note)}
                    >
                      <div class="truncate">{note.title}</div>
                      <div class="truncate" style={{ 'font-size': '11px', color: 'var(--muted)' }}>
                        {note.path.split('/').pop()}
                      </div>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
