import 'katex/dist/katex.min.css';
import katex from 'katex';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { type EditorState, type Extension, type Range, StateField } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

// Live KaTeX rendering for `$inline$` and `$$block$$` math. A region renders to
// a widget unless the selection touches it, in which case the raw source is
// shown (highlighted) so it can be edited — the standard reveal-on-cursor rule.

class LatexWidget extends WidgetType {
  constructor(readonly expr: string, readonly display: boolean) { super(); }
  eq(o: LatexWidget) { return o.expr === this.expr && o.display === this.display; }
  toDOM() {
    const el = document.createElement(this.display ? 'div' : 'span');
    el.className = this.display ? 'katex-block' : 'katex-inline';
    el.style.cursor = 'pointer';
    try {
      katex.render(this.expr, el, { throwOnError: false, displayMode: this.display });
    } catch (e) {
      el.classList.add('math-error');
      el.textContent = this.display ? `$$${this.expr}$$` : `$${this.expr}$`;
    }
    return el;
  }
  // false = a click lands the caret here, revealing the raw source for editing.
  ignoreEvent() { return false; }
}

// Source shown (highlighted) while the caret sits inside a math region.
const rawMark = Decoration.mark({ attributes: { style: 'color:var(--yellow)' } });

function build(state: EditorState): DecorationSet {
  const text = state.doc.toString();
  const sel = state.selection.main;
  const touches = (from: number, to: number) => sel.from <= to && sel.to >= from;
  const ranges: Range<Decoration>[] = [];
  const taken: Array<[number, number]> = [];
  const overlaps = (f: number, t: number) => taken.some(([a, b]) => f < b && t > a);

  // Collect code node ranges so $ inside inline/fenced code is never parsed as math.
  const codeRanges: Array<[number, number]> = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === 'InlineCode' || node.name === 'FencedCode' || node.name === 'CodeBlock') {
        codeRanges.push([node.from, node.to]);
        return false;
      }
    },
  });
  const inCode = (f: number, t: number) => codeRanges.some(([a, b]) => f < b && t > a);

  // Block math: $$ … $$ (may span multiple lines).
  const block = /\$\$([\s\S]+?)\$\$/g;
  let m: RegExpExecArray | null;
  while ((m = block.exec(text))) {
    if (text[m.index - 1] === '\\') continue; // escaped \$$
    if (inCode(m.index, m.index + m[0].length)) continue;
    // Strip ` ^blockId` markers (appended by the backend) before handing to KaTeX.
    const expr = m[1].replace(/ \^[a-zA-Z0-9-]{4,12}\s*$/gm, '').trim();
    if (!expr) continue;
    const rawFrom = m.index;
    const rawTo = m.index + m[0].length;
    // A replace decoration crossing a line break must be a block decoration and
    // cover whole lines.
    const multiline = m[0].includes('\n');
    const from = multiline ? state.doc.lineAt(rawFrom).from : rawFrom;
    const to = multiline ? state.doc.lineAt(rawTo).to : rawTo;
    taken.push([from, to]);
    if (touches(from, to)) { ranges.push(rawMark.range(rawFrom, rawTo)); continue; }
    ranges.push(Decoration.replace({ widget: new LatexWidget(expr, true), block: multiline }).range(from, to));
  }

  // Inline math: $ … $ — guard against `$5 and $10` style currency by forbidding
  // whitespace immediately inside the delimiters.
  const inline = /\$(?!\s)([^$\n]+?)(?<!\s)\$/g;
  while ((m = inline.exec(text))) {
    if (text[m.index - 1] === '\\') continue;
    const from = m.index, to = m.index + m[0].length;
    if (inCode(from, to)) continue;
    if (overlaps(from, to)) continue;
    if (touches(from, to)) { ranges.push(rawMark.range(from, to)); continue; }
    ranges.push(Decoration.replace({ widget: new LatexWidget(m[1].trim(), false) }).range(from, to));
  }

  return Decoration.set(ranges, true);
}

export function latex(): Extension {
  return StateField.define<DecorationSet>({
    create: build,
    update: (value, tr) => (tr.docChanged || tr.selection ? build(tr.state) : value),
    provide: f => EditorView.decorations.from(f),
  });
}
