import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import Fuse from 'fuse.js';
import { type FuzzyItem, fuzzyState } from '../../stores/fuzzyPopupStore';

interface Ranked {
  item: FuzzyItem;
  indices: ReadonlyArray<readonly [number, number]>;
}

/**
 * Singleton fuzzy-find popup. Driven entirely by `fuzzyPopupStore`; any editor
 * extension can open it. Keyboard (↑↓ / Enter / Tab / Esc) is captured at the
 * window level so it works while focus stays in the CodeMirror editor.
 */
export default function FuzzyPopup() {
  const [selected, setSelected] = createSignal(0);
  let listRef!: HTMLDivElement;

  const ranked = createMemo<Ranked[]>(() => {
    const st = fuzzyState();
    if (!st) return [];
    if (!st.query.trim()) return st.items.map(item => ({ item, indices: [] }));
    const fuse = new Fuse(st.items, {
      keys: ['label', 'sublabel'],
      includeMatches: true,
      threshold: 0.4,
      ignoreLocation: true,
    });
    return fuse.search(st.query).map(r => ({
      item: r.item,
      indices: r.matches?.find(m => m.key === 'label')?.indices ?? [],
    }));
  });

  // Clamp selection when the list changes.
  createEffect(() => {
    const n = ranked().length;
    if (selected() >= n) setSelected(Math.max(0, n - 1));
  });

  // Scroll selected item into view whenever the selection changes.
  createEffect(() => {
    const idx = selected();
    queueMicrotask(() => {
      const el = listRef?.querySelector<HTMLElement>(`[data-idx="${idx}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    });
  });

  function onKeyDown(e: KeyboardEvent) {
    const st = fuzzyState();
    if (!st) return;
    const list = ranked();
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault(); e.stopPropagation();
        setSelected(i => Math.min(list.length - 1, i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault(); e.stopPropagation();
        setSelected(i => Math.max(0, i - 1));
        break;
      case 'Enter':
      case 'Tab':
        if (list.length) {
          e.preventDefault(); e.stopPropagation();
          st.onSelect(list[selected()].item);
        }
        break;
      case 'Escape':
        e.preventDefault(); e.stopPropagation();
        st.onClose();
        break;
    }
  }

  // Capture phase so we intercept before CodeMirror's own keymap.
  createEffect(() => {
    if (fuzzyState()) {
      setSelected(0);
      window.addEventListener('keydown', onKeyDown, true);
      onCleanup(() => window.removeEventListener('keydown', onKeyDown, true));
    }
  });

  function highlight(label: string, indices: ReadonlyArray<readonly [number, number]>): { text: string; match: boolean }[] {
    if (!indices.length) return [{ text: label, match: false }];
    const out: { text: string; match: boolean }[] = [];
    let cursor = 0;
    for (const [s, e] of indices) {
      if (s > cursor) out.push({ text: label.slice(cursor, s), match: false });
      out.push({ text: label.slice(s, e + 1), match: true });
      cursor = e + 1;
    }
    if (cursor < label.length) out.push({ text: label.slice(cursor), match: false });
    return out;
  }

  return (
    <Show when={fuzzyState()}>
      {st => (
        <Portal>
          <div
            ref={listRef}
            class="fuzzy-popup"
            style={{
              left: `${Math.min(st().anchor.x, window.innerWidth - 280)}px`,
              top: `${Math.min(st().anchor.y + 4, window.innerHeight - 240)}px`,
            }}
            onMouseDown={e => e.preventDefault()}
          >
            <Show
              when={ranked().length}
              fallback={<div class="fuzzy-empty">No matches</div>}
            >
              <For each={ranked()}>
                {(r, i) => (
                  <div
                    class="fuzzy-item"
                    classList={{ selected: selected() === i() }}
                    data-idx={i()}
                    onMouseEnter={() => setSelected(i())}
                    onClick={() => st().onSelect(r.item)}
                  >
                    <div class="truncate">
                      <For each={highlight(r.item.label, r.indices)}>
                        {part => part.match
                          ? <span style={{ color: 'var(--accent)', 'font-weight': '600' }}>{part.text}</span>
                          : <span>{part.text}</span>}
                      </For>
                    </div>
                    <Show when={r.item.sublabel}>
                      <div class="truncate" style={{ color: 'var(--muted)', 'font-size': '11px' }}>{r.item.sublabel}</div>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </Portal>
      )}
    </Show>
  );
}
