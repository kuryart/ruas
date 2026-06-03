import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import { type EditorState, type Extension, type Range, StateField } from '@codemirror/state';

// Block-id markers (` ^abc123`) are an internal addressing detail appended by
// `ensure_block_ids` on the backend. The user must never see or manage them, so
// we always conceal them — on every line, including the one the cursor sits on,
// and in both `edit` and `raw` modes.

const hide = Decoration.replace({});

// ` ^id` at end of line — id is 4–12 chars of [a-zA-Z0-9-].
const BLOCK_ID = / \^[a-zA-Z0-9-]{4,12}\s*$/;

function build(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (let ln = 1; ln <= state.doc.lines; ln++) {
    const line = state.doc.line(ln);
    const m = BLOCK_ID.exec(line.text);
    if (m) ranges.push(hide.range(line.from + m.index, line.to));
  }
  return Decoration.set(ranges, true);
}

const field = StateField.define<DecorationSet>({
  create: build,
  update: (value, tr) => (tr.docChanged ? build(tr.state) : value),
  provide: f => EditorView.decorations.from(f),
});

/** Conceals block-id markers and treats them as atomic so the caret skips over
 *  the hidden region instead of landing inside it. */
export function blockIdConceal(): Extension {
  return [field, EditorView.atomicRanges.of(view => view.state.field(field))];
}
