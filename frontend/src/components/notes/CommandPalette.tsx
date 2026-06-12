import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { useI18n } from '../../i18n/context';
import { invoke } from '../../utils/api';
import { paletteOpen, setPaletteOpen } from '../../stores/paletteStore';
import { openNotePermanent } from '../workspace/workspaceStore';

interface NoteMeta { path: string; title: string }

/** Global quick-open palette (Ctrl+P): backend search with debounce. */
export default function CommandPalette() {
  const { t } = useI18n();
  const [query, setQuery] = createSignal('');
  const [results, setResults] = createSignal<NoteMeta[]>([]);
  const [selected, setSelected] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;
  let token = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const close = () => { setPaletteOpen(false); setQuery(''); setResults([]); setSelected(0); };

  // Debounced backend search — 150ms after last keystroke.
  createEffect(() => {
    if (!paletteOpen()) return;
    const q = query();
    clearTimeout(timer);
    const my = ++token;
    setLoading(true);
    timer = setTimeout(() => {
      invoke<NoteMeta[]>('search_notes', { query: q })
        .then(r => { if (my === token) { setResults(r); setSelected(0); setLoading(false); } })
        .catch(() => { if (my === token) { setResults([]); setLoading(false); } });
    }, 150);
  });

  onCleanup(() => clearTimeout(timer));

  // Focus the input on open.
  createEffect(() => {
    if (paletteOpen()) queueMicrotask(() => inputRef?.focus());
  });

  function pick(note: NoteMeta) {
    // Fire-and-forget: track frecency and context.
    invoke('record_access', { path: note.path }).catch(() => {});
    invoke('set_last_selected_entity', { path: note.path }).catch(() => {});
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
