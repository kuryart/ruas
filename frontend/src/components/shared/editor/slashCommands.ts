import { EditorView, ViewPlugin, keymap, type ViewUpdate } from '@codemirror/view';
import { type EditorState, type Extension } from '@codemirror/state';
import { closeFuzzy, type FuzzyItem, fuzzyState, isFuzzyOpen, openFuzzy, patchFuzzy } from '../../../stores/fuzzyPopupStore';

// `/` at the start of a line opens a formatting-command palette (Notion-style).

interface SlashCmd {
  id: string;
  label: string;
  insert: string;
  /** Caret offset (from the insertion start) after applying. */
  caret: number;
}

const COMMANDS: SlashCmd[] = [
  { id: 'h1', label: 'Heading 1', insert: '# ', caret: 2 },
  { id: 'h2', label: 'Heading 2', insert: '## ', caret: 3 },
  { id: 'h3', label: 'Heading 3', insert: '### ', caret: 4 },
  { id: 'h4', label: 'Heading 4', insert: '#### ', caret: 5 },
  { id: 'h5', label: 'Heading 5', insert: '##### ', caret: 6 },
  { id: 'h6', label: 'Heading 6', insert: '###### ', caret: 7 },
  { id: 'bold', label: 'Bold', insert: '****', caret: 2 },
  { id: 'italic', label: 'Italic', insert: '**', caret: 1 },
  { id: 'strike', label: 'Strikethrough', insert: '~~~~', caret: 2 },
  { id: 'code', label: 'Code block', insert: '```\n\n```', caret: 4 },
  { id: 'quote', label: 'Quote', insert: '> ', caret: 2 },
  { id: 'table', label: 'Table', insert: '| Column | Column |\n| --- | --- |\n|  |  |', caret: 2 },
  { id: 'hr', label: 'Horizontal rule', insert: '---\n', caret: 4 },
  { id: 'link', label: 'Link', insert: '[]()', caret: 1 },
  { id: 'image', label: 'Image', insert: '![]()', caret: 2 },
];

interface SlashCtx { from: number; to: number; query: string }

/** Detect `/query` typed at the very start of an otherwise-empty line. */
function detectSlash(state: EditorState): SlashCtx | null {
  const sel = state.selection.main;
  if (!sel.empty) return null;
  const line = state.doc.lineAt(sel.head);
  const before = line.text.slice(0, sel.head - line.from);
  const m = /^\/([a-zA-Z0-9 ]*)$/.exec(before);
  if (!m) return null;
  if (line.text.slice(sel.head - line.from).trim() !== '') return null; // nothing after caret
  return { from: line.from, to: sel.head, query: m[1] };
}

export function slashCommands(): Extension {
  const items: FuzzyItem[] = COMMANDS.map(c => ({ id: c.id, label: c.label }));

  const plugin = ViewPlugin.fromClass(
    class {
      lastAnchor: { x: number; y: number } | null = null;
      constructor(view: EditorView) { this.run(view); }

      update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet) this.run(u.view);
      }

      run(view: EditorView) {
        const ctx = detectSlash(view.state);
        if (!ctx) {
          if (isFuzzyOpen() && fuzzyState()?.source === 'slash') closeFuzzy();
          return;
        }

        const onSelect = (item: FuzzyItem) => this.apply(view, item);
        const onClose = () => closeFuzzy();

        if (!isFuzzyOpen() || fuzzyState()?.source !== 'slash') {
          openFuzzy({ source: 'slash', items, query: ctx.query, anchor: this.lastAnchor ?? { x: 0, y: 0 }, onSelect, onClose });
        } else {
          patchFuzzy({ query: ctx.query, onSelect, onClose });
        }

        view.requestMeasure({
          key: this,
          read: () => view.coordsAtPos(ctx.from),
          write: coords => {
            if (!coords) return;
            this.lastAnchor = { x: coords.left, y: coords.bottom };
            patchFuzzy({ anchor: this.lastAnchor });
          },
        });
      }

      apply(view: EditorView, item: FuzzyItem) {
        const ctx = detectSlash(view.state);
        const cmd = COMMANDS.find(c => c.id === item.id);
        if (!ctx || !cmd) { closeFuzzy(); return; }
        view.dispatch({
          changes: { from: ctx.from, to: ctx.to, insert: cmd.insert },
          selection: { anchor: ctx.from + cmd.caret },
        });
        closeFuzzy();
        view.focus();
      }

      destroy() {
        if (isFuzzyOpen() && fuzzyState()?.source === 'slash') closeFuzzy();
      }
    },
  );

  const guardKeys = keymap.of(
    ['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].map(key => ({
      key,
      run: () => isFuzzyOpen() && fuzzyState()?.source === 'slash',
    })),
  );

  return [plugin, guardKeys];
}
