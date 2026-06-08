// Lazily loads Mermaid (a large dependency, ~2MB with cytoscape) only when a
// diagram is actually rendered, keeping it out of the initial app bundle.

type MermaidApi = typeof import('mermaid')['default'];

let modPromise: Promise<MermaidApi> | null = null;
let counter = 0;

function load(): Promise<MermaidApi> {
  if (!modPromise) {
    modPromise = import('mermaid').then(m => {
      m.default.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
      return m.default;
    });
  }
  return modPromise;
}

/** Render mermaid source to an SVG string. Rejects on syntax errors. */
export async function renderMermaid(code: string): Promise<string> {
  const mermaid = await load();
  const { svg } = await mermaid.render(`mmd-${++counter}`, code);
  return svg;
}
