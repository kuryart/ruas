import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import { type EditorState, type Extension, type Range, StateField } from '@codemirror/state';

// Block-id markers (` ^abc123`) are internal addressing details appended by
// the backend. They are rendered as small, muted text so the user is aware of
// them (copy-paste works correctly) but they don't distract from content.

const blockIdMark = Decoration.mark({
  attributes: {
    style: 'color:var(--overlay1);font-size:0.72em;letter-spacing:0.02em;font-style:normal',
  },
});

// ` ^id` at end of line — id is 4–12 chars of [a-zA-Z0-9-].
const BLOCK_ID = / \^[a-zA-Z0-9-]{4,12}\s*$/;

function build(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (let ln = 1; ln <= state.doc.lines; ln++) {
    const line = state.doc.line(ln);
    const m = BLOCK_ID.exec(line.text);
    if (m) ranges.push(blockIdMark.range(line.from + m.index, line.to));
  }
  return Decoration.set(ranges, true);
}

const field = StateField.define<DecorationSet>({
  create: build,
  update: (value, tr) => (tr.docChanged ? build(tr.state) : value),
  provide: f => EditorView.decorations.from(f),
});

/** Renders block-id markers as small muted text. The cursor can land inside
 *  them — they are visible and editable, just visually de-emphasised. */
export function blockIdConceal(): Extension {
  return field;
}
