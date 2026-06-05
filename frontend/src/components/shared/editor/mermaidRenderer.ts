import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { type EditorState, type Extension, type Range, StateField } from '@codemirror/state';
import { renderMermaid } from './mermaidLoader';

// Renders ```mermaid fenced blocks to SVG diagrams. The block reveals its raw
// source while the caret is inside it (reveal-on-cursor), like every other
// live-preview element.

class MermaidWidget extends WidgetType {
  constructor(readonly code: string) { super(); }
  eq(o: MermaidWidget) { return o.code === this.code; }
  toDOM(view: EditorView) {
    const el = document.createElement('div');
    el.className = 'mermaid-block';
    el.style.cursor = 'pointer';
    void renderMermaid(this.code)
      .then(svg => {
        el.innerHTML = svg;
        // SVG loaded asynchronously — height changed, notify CM6 to re-measure.
        view.requestMeasure();
      })
      .catch((e: unknown) => {
        el.classList.add('mermaid-error');
        el.textContent = e instanceof Error ? e.message : String(e);
        view.requestMeasure();
      });
    return el;
  }
  ignoreEvent() { return false; }
}

interface MermaidState {
  decos: DecorationSet;
  // All mermaid regions — used to detect boundary crossings so we only
  // call build() when necessary (same pattern as latexRenderer).
  blockRanges: DecorationSet;
}

const blockMark = Decoration.mark({});

function build(state: EditorState): MermaidState {
  const sel = state.selection.main;
  const ranges: Range<Decoration>[] = [];
  const blockRangesList: Range<Decoration>[] = [];

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'FencedCode') return;
      const firstLine = state.doc.lineAt(node.from);
      const info = firstLine.text.replace(/^[`~]+/, '').trim().toLowerCase();
      if (info !== 'mermaid') return;

      const from = firstLine.from;
      const to = state.doc.lineAt(node.to).to;
      blockRangesList.push(blockMark.range(from, to));
      if (sel.from <= to && sel.to >= from) return; // caret inside → show raw

      // Inner code = everything between the opening and closing fence lines.
      const lastLine = state.doc.lineAt(node.to);
      const codeFrom = Math.min(firstLine.to, state.doc.length);
      const codeTo = Math.max(lastLine.from, codeFrom);
      const code = state.doc.sliceString(codeFrom, codeTo);
      if (!code.trim()) return;

      ranges.push(Decoration.replace({ widget: new MermaidWidget(code), block: true }).range(from, to));
    },
  });

  return {
    decos: Decoration.set(ranges, true),
    blockRanges: Decoration.set(blockRangesList, true),
  };
}

export function mermaidDiagram(): Extension {
  return StateField.define<MermaidState>({
    create: build,
    update: (value, tr) => {
      if (!tr.docChanged && !tr.selection) return value;
      if (tr.docChanged) return build(tr.state);
      // Only rebuild when cursor crosses a mermaid block boundary.
      const sel = tr.state.selection.main;
      const prev = tr.startState.selection.main;
      let rebuild = false;
      value.blockRanges.between(sel.from, sel.to, () => { rebuild = true; return false; });
      if (!rebuild) value.blockRanges.between(prev.from, prev.to, () => { rebuild = true; return false; });
      return rebuild ? build(tr.state) : value;
    },
    provide: f => EditorView.decorations.from(f, s => s.decos),
  });
}
