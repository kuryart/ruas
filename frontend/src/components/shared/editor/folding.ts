import { codeFolding, foldGutter, foldKeymap, foldService } from '@codemirror/language';
import { keymap } from '@codemirror/view';
import { type Extension } from '@codemirror/state';

// Folding for markdown headings: a heading folds everything down to the next
// heading of the same or higher level (or end of document).
const headingFold = foldService.of((state, lineStart, lineEnd) => {
  const line = state.doc.lineAt(lineStart);
  const m = /^(#{1,6})\s/.exec(line.text);
  if (!m) return null;
  const level = m[1].length;

  let end = state.doc.line(state.doc.lines).to;
  for (let n = line.number + 1; n <= state.doc.lines; n++) {
    const text = state.doc.line(n).text;
    const hm = /^(#{1,6})\s/.exec(text);
    if (hm && hm[1].length <= level) {
      end = state.doc.line(n - 1).to;
      break;
    }
  }
  return end > lineEnd ? { from: lineEnd, to: end } : null;
});

/** Heading folding plus the standard fold gutter and keymap (Ctrl+Shift+[ / ]). */
export function folding(): Extension {
  return [codeFolding(), headingFold, foldGutter(), keymap.of(foldKeymap)];
}
