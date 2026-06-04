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
  toDOM() {
    const el = document.createElement('div');
    el.className = 'mermaid-block';
    el.style.cursor = 'pointer';
    void renderMermaid(this.code)
      .then(svg => { el.innerHTML = svg; })
      .catch((e: unknown) => {
        el.classList.add('mermaid-error');
        el.textContent = e instanceof Error ? e.message : String(e);
      });
    return el;
  }
  ignoreEvent() { return false; }
}

function build(state: EditorState): DecorationSet {
  const sel = state.selection.main;
  const ranges: Range<Decoration>[] = [];

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'FencedCode') return;
      const firstLine = state.doc.lineAt(node.from);
      const info = firstLine.text.replace(/^[`~]+/, '').trim().toLowerCase();
      if (info !== 'mermaid') return;

      const from = firstLine.from;
      const to = state.doc.lineAt(node.to).to;
      if (sel.from <= to && sel.to >= from) return; // caret inside → show raw

      // Inner code = everything between the opening and closing fence lines.
      const lastLine = state.doc.lineAt(node.to);
      const codeFrom = Math.min(firstLine.to + 1, state.doc.length);
      const codeTo = Math.max(lastLine.from - 1, codeFrom);
      const code = state.doc.sliceString(codeFrom, codeTo);
      if (!code.trim()) return;

      ranges.push(Decoration.replace({ widget: new MermaidWidget(code), block: true }).range(from, to));
    },
  });

  return Decoration.set(ranges, true);
}

export function mermaidDiagram(): Extension {
  return StateField.define<DecorationSet>({
    create: build,
    update: (value, tr) => (tr.docChanged || tr.selection ? build(tr.state) : value),
    provide: f => EditorView.decorations.from(f),
  });
}
