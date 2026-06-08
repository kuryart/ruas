import { EditorView } from '@codemirror/view';
import { EditorSelection, type Extension } from '@codemirror/state';

// Trigger char → wrapping pair.
// On empty selection: insert `open + close`, caret placed just after `open`.
// On a non-empty selection: wrap the selected text with `open … close`.
const PAIRS: Record<string, { open: string; close: string }> = {
  '*': { open: '*', close: '*' },
  // `[` closes with `]` so that typing `[[` naturally yields `[[]]` (wiki links).
  '[': { open: '[', close: ']' },
  '"': { open: '"', close: '"' },
  "'": { open: "'", close: "'" },
  '(': { open: '(', close: ')' },
};

function wrapOrInsert(view: EditorView, ch: string): boolean {
  const pair = PAIRS[ch];
  if (!pair) return false;
  const { state } = view;

  const tr = state.changeByRange(range => {
    if (range.empty) {
      const insert = pair.open + pair.close;
      const caret = range.from + pair.open.length;
      return { changes: { from: range.from, insert }, range: EditorSelection.cursor(caret) };
    }

    const selText = state.sliceDoc(range.from, range.to);
    const insert = pair.open + selText + pair.close;

    // keep the wrapped text selected so it can be wrapped again (e.g. `*` → `**`)
    const anchor = range.from + pair.open.length;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(anchor, anchor + selText.length),
    };
  });

  view.dispatch(tr, { scrollIntoView: true, userEvent: 'input.type' });
  return true;
}

export function autoPairs(): Extension {
  return EditorView.inputHandler.of((view, _from, _to, text) => {
    if (text.length !== 1 || !(text in PAIRS)) return false;
    return wrapOrInsert(view, text);
  });
}
