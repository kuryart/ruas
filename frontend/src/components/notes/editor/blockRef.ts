import { EditorView, ViewPlugin, keymap, type ViewUpdate } from '@codemirror/view';
import { type Extension, type EditorState } from '@codemirror/state';
import { invoke } from '../../../utils/api';
import { closeFuzzy, type FuzzyItem, fuzzyState, isFuzzyOpen, openFuzzy, patchFuzzy } from '../../../stores/fuzzyPopupStore';

interface BlockMeta { id: string; preview: string }
interface NoteMeta  { path: string; title: string }

interface BlockRefCtx {
  noteTitle: string;
  query: string;
  queryFrom: number;
  queryTo: number;
}

function detectBlockRef(state: EditorState): BlockRefCtx | null {
  const sel = state.selection.main;
  if (!sel.empty) return null;
  const pos = sel.head;
  const line = state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  const idx = before.lastIndexOf('[[');
  if (idx === -1) return null;
  const between = before.slice(idx + 2);
  if (between.includes(']]') || between.includes('[')) return null;
  const caretIdx = between.indexOf('^');
  if (caretIdx === -1) return null;
  const noteTitle = between.slice(0, caretIdx).split('|')[0].trim();
  if (!noteTitle) return null;
  const query = between.slice(caretIdx + 1);
  const queryFrom = line.from + idx + 2 + caretIdx + 1;
  return { noteTitle, query, queryFrom, queryTo: pos };
}

export function blockRef(): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      token = 0;
      lastAnchor: { x: number; y: number } | null = null;
      cachedTitle = '';
      cachedPath  = '';
      cachedItems: FuzzyItem[] = [];

      constructor(view: EditorView) { this.run(view); }

      update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet) this.run(u.view);
      }

      run(view: EditorView) {
        const ctx = detectBlockRef(view.state);
        if (!ctx) {
          this.token++;
          if (isFuzzyOpen() && fuzzyState()?.source === 'blockRef') closeFuzzy();
          return;
        }

        const onSelect = (item: FuzzyItem) => this.applySelect(view, item);
        const onClose = () => closeFuzzy();

        if (!isFuzzyOpen() || fuzzyState()?.source !== 'blockRef') {
          openFuzzy({ source: 'blockRef', items: [], query: ctx.query, anchor: this.lastAnchor ?? { x: 0, y: 0 }, onSelect, onClose });
        } else {
          patchFuzzy({ query: ctx.query, onSelect, onClose });
        }

        view.requestMeasure({
          key: this,
          read: () => view.coordsAtPos(ctx.queryFrom),
          write: coords => {
            if (!coords) return;
            this.lastAnchor = { x: coords.left, y: coords.bottom };
            patchFuzzy({ anchor: this.lastAnchor });
          },
        });

        if (ctx.noteTitle === this.cachedTitle && this.cachedPath) {
          if (this.cachedItems.length) patchFuzzy({ items: this.cachedItems });
          return;
        }

        const my = ++this.token;
        this.cachedTitle = ctx.noteTitle;

        invoke<NoteMeta[]>('search_notes', { query: ctx.noteTitle })
          .then(results => {
            if (my !== this.token || fuzzyState()?.source !== 'blockRef') return;
            const note = results.find(r =>
              r.title.toLowerCase() === ctx.noteTitle.toLowerCase(),
            ) ?? results[0];
            if (!note) { patchFuzzy({ items: [] }); return null; }
            this.cachedPath = note.path;
            return invoke<BlockMeta[]>('list_blocks', { path: note.path });
          })
          .then(blocks => {
            if (!blocks || my !== this.token || fuzzyState()?.source !== 'blockRef') return;
            const items: FuzzyItem[] = blocks.map(b => ({
              id: b.id,
              label: b.preview,
              sublabel: `^${b.id}`,
            }));
            this.cachedItems = items;
            patchFuzzy({ items });
          })
          .catch(err => console.error('[blockRef] failed:', err));
      }

      applySelect(view: EditorView, item: FuzzyItem) {
        const ctx = detectBlockRef(view.state);
        if (!ctx) { closeFuzzy(); return; }
        const line = view.state.doc.lineAt(ctx.queryFrom);
        const openIdx = line.text.lastIndexOf('[[', ctx.queryFrom - line.from - 1);
        const from = line.from + openIdx;
        const hasClose = view.state.sliceDoc(ctx.queryTo, ctx.queryTo + 2) === ']]';
        const to = hasClose ? ctx.queryTo + 2 : ctx.queryTo;
        const insert = `[[${ctx.noteTitle}^${item.id}]]`;
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: from + insert.length },
        });
        closeFuzzy();
        view.focus();
      }

      destroy() {
        this.token++;
        if (isFuzzyOpen() && fuzzyState()?.source === 'blockRef') closeFuzzy();
      }
    },
  );

  const guardKeys = keymap.of(
    ['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].map(key => ({
      key,
      run: () => isFuzzyOpen() && fuzzyState()?.source === 'blockRef',
    })),
  );

  return [plugin, guardKeys];
}
