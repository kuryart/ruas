import { EditorView, RectangleMarker, layer } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';

// Renders fenced-code-block backgrounds in a layer that sits BELOW the
// selection layer. Decoration.line backgrounds live in the content layer
// (z-index: 2) and hide the selection layer (z-index: -1). By using a
// CM6 layer here the stacking order becomes:
//   content (2) > selection (-1) > this layer (-2)
// so visual-mode highlights remain visible inside code blocks.
export const codeBlockBg = [
  layer({
    above: false,
    class: 'cm-code-bg-layer',
    markers(view) {
      const result: RectangleMarker[] = [];
      const doc = view.state.doc;

      syntaxTree(view.state).iterate({
        enter(node) {
          if (node.name !== 'FencedCode') return;

          const infoText = doc.lineAt(node.from).text
            .replace(/^[`~]+/, '').trim().toLowerCase();
          if (infoText === 'mermaid') return false;

          const firstLn = doc.lineAt(node.from).number;
          const lastLn = doc.lineAt(node.to).number;

          for (let ln = firstLn; ln <= lastLn; ln++) {
            const block = view.lineBlockAt(doc.line(ln).from);
            result.push(new RectangleMarker('cm-code-bg', 0, block.top, null, block.height));
          }

          return false;
        },
      });

      return result;
    },
    update(update) {
      return update.docChanged || update.viewportChanged || update.geometryChanged;
    },
  }),

  EditorView.baseTheme({
    '.cm-code-bg': {
      background: 'var(--mantle)',
      display: 'block',
    },
  }),
];
