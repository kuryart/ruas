import { createEffect, on, onCleanup, onMount } from 'solid-js';
import { Decoration, type DecorationSet, EditorView, drawSelection, keymap, lineNumbers } from '@codemirror/view';
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { GFM, Subscript, Superscript } from '@lezer/markdown';
import { catppuccinHighlight, catppuccinTheme } from './catppuccinTheme';
import { tableInteraction } from './editor/tableInteraction';
import { autoPairs } from './editor/autoPairs';
import { blockIdConceal } from './editor/blockIdConceal';
import { latex } from './editor/latexRenderer';
import { mermaidDiagram } from './editor/mermaidRenderer';
import { folding } from './editor/folding';
import { slashCommands } from './editor/slashCommands';
import { codeLanguages } from './editor/languageSupport';
import { codeBlockBg } from './editor/codeBlockBg';
import { vim } from '@replit/codemirror-vim';
import { vimMode } from '../../stores/prefsStore';

// ── Block flash (transient highlight when scrolling to a block) ──────────────

const setFlash = StateEffect.define<number | null>(); // doc position, or null to clear
const flashDeco = Decoration.line({ attributes: { class: 'cm-block-flash' } });

const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setFlash)) {
        value = e.value == null
          ? Decoration.none
          : Decoration.set([flashDeco.range(tr.state.doc.lineAt(e.value).from)]);
      }
    }
    return value;
  },
  provide: f => EditorView.decorations.from(f),
});

export interface EditorApi {
  scrollToLine: (line: number) => void;
}

export default function EditorPane(props: {
  content: string;
  mode: 'edit' | 'raw';
  onChange: (v: string) => void;
  scrollTarget?: string | null;
  onReady?: (api: EditorApi) => void;
  // Module-specific extensions (e.g. wiki-links, block-refs, live preview).
  // Appended after the generic edit-mode extensions when mode === 'edit'.
  extraExtensions?: Extension[];
  // When true the editor grows with content instead of filling its container.
  // Use in forms/detail views where the outer page handles scrolling.
  autoGrow?: boolean;
}) {
  let container!: HTMLDivElement;
  let view: EditorView | undefined;
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  // Override the theme's height:100% so the editor grows with its content.
  const autoGrowTheme = EditorView.theme({
    '&': { height: 'auto' },
    '.cm-scroller': { overflow: 'visible' },
  });

  const buildExtensions = (mode: 'edit' | 'raw') => [
    // Vim must come first so its keymap takes precedence over the defaults.
    ...(vimMode() ? [vim()] : []),
    catppuccinTheme,
    ...(props.autoGrow ? [autoGrowTheme] : []),
    catppuccinHighlight,
    drawSelection(),
    ...codeBlockBg,
    markdown({ extensions: [GFM, Superscript, Subscript], codeLanguages }),
    autoPairs(),
    history(),
    folding(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    EditorView.lineWrapping,
    flashField,
    EditorView.updateListener.of(u => {
      if (u.docChanged) props.onChange(u.state.doc.toString());
    }),
    // Block-id markers are internal — conceal them in every mode, raw included.
    blockIdConceal(),
    ...(mode === 'raw'  ? [lineNumbers()]                                                      : []),
    ...(mode === 'edit' ? [tableInteraction(), slashCommands(), latex(), mermaidDiagram(),
                           ...(props.extraExtensions ?? [])]                                   : []),
  ];

  /** Locate the line carrying ` ^blockId`, scroll it into view and flash it. */
  function scrollToBlock(id: string) {
    if (!view) return;
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(` \\^${esc}(?:\\s|$)`);
    const doc = view.state.doc;
    for (let ln = 1; ln <= doc.lines; ln++) {
      const line = doc.line(ln);
      if (!re.test(line.text)) continue;
      view.dispatch({
        selection: { anchor: line.from },
        effects: [EditorView.scrollIntoView(line.from, { y: 'center' }), setFlash.of(line.from)],
      });
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => view?.dispatch({ effects: setFlash.of(null) }), 1400);
      return;
    }
  }

  /** Scroll a 1-based line to the top of the viewport and place the caret. */
  function scrollToLine(line: number) {
    if (!view) return;
    const ln = Math.min(Math.max(1, line), view.state.doc.lines);
    const pos = view.state.doc.line(ln).from;
    view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'start' }) });
    view.focus();
  }

  onMount(() => {
    view = new EditorView({
      state: EditorState.create({ doc: props.content, extensions: buildExtensions(props.mode) }),
      parent: container,
    });
    props.onReady?.({ scrollToLine });
    if (props.scrollTarget) scrollToBlock(props.scrollTarget);
  });

  onCleanup(() => { clearTimeout(flashTimer); view?.destroy(); });

  // Sync content from outside (new note loaded, path changed)
  createEffect(on(() => props.content, content => {
    if (!view) return;
    const cur = view.state.doc.toString();
    if (cur !== content) view.dispatch({ changes: { from: 0, to: cur.length, insert: content } });
  }, { defer: true }));

  // Scroll to a requested block (block-ref navigation). Runs after content sync.
  createEffect(on(() => props.scrollTarget, target => {
    if (target) queueMicrotask(() => scrollToBlock(target));
  }, { defer: true }));

  // Rebuild extensions when the mode or the vim-mode preference changes.
  createEffect(on([() => props.mode, vimMode], ([mode]) => {
    if (!view) return;
    const doc = view.state.doc.toString();
    view.setState(EditorState.create({ doc, extensions: buildExtensions(mode as 'edit' | 'raw') }));
  }, { defer: true }));

  return (
    <div
      ref={container}
      style={{
        height: props.autoGrow ? 'auto' : '100%',
        'min-height': props.autoGrow ? '120px' : undefined,
        'box-sizing': 'border-box',
      }}
    />
  );
}
