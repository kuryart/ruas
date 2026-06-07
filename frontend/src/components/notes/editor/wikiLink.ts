import { Decoration, type DecorationSet, EditorView, ViewPlugin, keymap, type ViewUpdate } from '@codemirror/view';
import { type Extension, type EditorState, Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { invoke, openExternal } from '../../../utils/api';
import { navigateToNote, openNotePermanent } from '../../workspace/workspaceStore';
import { setPendingBlock } from '../../../stores/blockTargetStore';
import { closeFuzzy, type FuzzyItem, fuzzyState, isFuzzyOpen, openFuzzy, patchFuzzy } from '../../../stores/fuzzyPopupStore';

interface NoteMeta { path: string; title: string }

/** Resolve a note title and open it in the focused panel.
 * @param permanent - true (Ctrl/Meta+click) opens a new permanent tab; false reuses the preview tab. */
export async function openNoteByTitle(title: string, permanent = false, blockId?: string) {
	if (!title) return;
	try {
		const results = await invoke<NoteMeta[]>('search_notes', { query: title });
		const note = results.find(r => r.title.toLowerCase() === title.toLowerCase()) ?? results[0];
		if (note) {
			// Queue the scroll target *before* opening so the detail view picks it up
			// as soon as its content is ready.
			if (blockId) setPendingBlock({ path: note.path, blockId });
			if (permanent) openNotePermanent(note.path, note.title);
			else navigateToNote(note.path, note.title);
		}
	} catch { /* ignore */ }
}

/** Editor click handler: open the target note when a wiki-link is clicked, or
 * the URL when a markdown link is clicked.
 * Ctrl/Meta+click opens a permanent tab; plain click reuses the preview tab. */
const wikiClick: Extension = EditorView.domEventHandlers({
	mousedown(e) {
		const target = e.target as HTMLElement;

		const link = target.closest('.md-link') as HTMLElement | null;
		if (link?.dataset.href) {
			e.preventDefault();
			void openExternal(link.dataset.href);
			return true;
		}

		const el = target.closest('.wiki-link') as HTMLElement | null;
		if (!el || !el.dataset.title) return false;
		e.preventDefault();
		void openNoteByTitle(el.dataset.title, e.ctrlKey || e.metaKey, el.dataset.block || undefined);
		return true;
	},
});

interface WikiCtx { queryFrom: number; queryTo: number; query: string }

/**
 * Detect whether the (collapsed) cursor sits inside an unclosed `[[ … `.
 * Bails out when a `^` appears in the query (block-ref territory — handled by blockRef.ts).
 */
function detectWiki(state: EditorState): WikiCtx | null {
	const sel = state.selection.main;
	if (!sel.empty) return null;
	const pos = sel.head;
	const line = state.doc.lineAt(pos);
	const before = line.text.slice(0, pos - line.from);
	const idx = before.lastIndexOf('[[');
	if (idx === -1) return null;
	const between = before.slice(idx + 2);
	if (between.includes(']]') || between.includes('[')) return null;
	const query = between.split('|')[0];
	if (query.includes('^')) return null; // block-ref territory
	return { queryFrom: line.from + idx + 2, queryTo: pos, query };
}

export function wikiLinks(): Extension {
	const plugin = ViewPlugin.fromClass(
		class {
			token = 0;
			lastAnchor: { x: number; y: number } | null = null;
			constructor(view: EditorView) { this.run(view); }

			update(u: ViewUpdate) {
				if (u.docChanged || u.selectionSet) this.run(u.view);
			}

			run(view: EditorView) {
				const ctx = detectWiki(view.state);
				if (!ctx) {
					this.token++; // cancel any pending async
					if (isFuzzyOpen() && fuzzyState()?.source === 'wiki') closeFuzzy();
					return;
				}

				const onSelect = (item: FuzzyItem) => this.applySelect(view, item);
				const onClose = () => closeFuzzy();

				// Take over the popup regardless of which plugin currently owns it.
				if (!isFuzzyOpen() || fuzzyState()?.source !== 'wiki') {
					openFuzzy({ source: 'wiki', items: [], query: ctx.query, anchor: this.lastAnchor ?? { x: 0, y: 0 }, onSelect, onClose });
				} else {
					patchFuzzy({ query: ctx.query, onSelect, onClose });
				}

				view.requestMeasure({
					key: this,
					read: () => view.coordsAtPos(ctx.queryFrom),
					write: coords => {
						if (!coords) return;
						this.lastAnchor = { x: coords.left, y: coords.bottom };
						patchFuzzy({ anchor: this.lastAnchor });
					},
				});

				const my = ++this.token;
				invoke<NoteMeta[]>('search_notes', { query: ctx.query })
					.then(results => {
						if (my !== this.token || fuzzyState()?.source !== 'wiki') return;
						const items: FuzzyItem[] = results.map(r => ({
							id: r.path,
							label: r.title,
							sublabel: r.path.split('/').pop(),
						}));
						patchFuzzy({ items });
					})
					.catch(err => console.error('[wiki] search_notes failed:', err));
			}

			applySelect(view: EditorView, item: FuzzyItem) {
				const ctx = detectWiki(view.state);
				if (!ctx) { closeFuzzy(); return; }
				const hasClose = view.state.sliceDoc(ctx.queryTo, ctx.queryTo + 2) === ']]';
				const insert = item.label + (hasClose ? '' : ']]');
				const caret = ctx.queryFrom + item.label.length + 2;
				view.dispatch({
					changes: { from: ctx.queryFrom, to: ctx.queryTo, insert },
					selection: { anchor: caret },
				});
				closeFuzzy();
				view.focus();
			}

			destroy() {
				this.token++;
				if (isFuzzyOpen() && fuzzyState()?.source === 'wiki') closeFuzzy();
			}
		},
	);

	const guardKeys = keymap.of(
		['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].map(key => ({
			key,
			run: () => isFuzzyOpen() && fuzzyState()?.source === 'wiki',
		})),
	);

	return [plugin, wikiClick, guardKeys];
}

// ── Link rendering decorations (edit mode) ──────────────────────────────────
// ── Link rendering decorations (edit mode) ──────────────────────────────────

const wikiDeco = Decoration.mark({
  attributes: {
    class: 'wiki-link',
    style: 'color:var(--accent) !important;cursor:pointer;text-decoration:none;border-bottom:1px dashed var(--accent)',
  },
});
const mdLinkDeco = Decoration.mark({
  attributes: {
    class: 'md-link',
    style: 'color:var(--accent) !important;text-decoration:underline;text-decoration-style:dashed;cursor:pointer',
  },
});

function buildLinkDecos(view: EditorView): DecorationSet {
  const marks: Range<Decoration>[] = [];
  syntaxTree(view.state).iterate({
    enter: (node) => {
      if (node.name === 'WikiLink') marks.push(wikiDeco.range(node.from, node.to));
      if (node.name === 'Link') {
        if (view.state.sliceDoc(node.from, node.to).includes('](')) marks.push(mdLinkDeco.range(node.from, node.to));
      }
      if (node.name === 'URL') marks.push(mdLinkDeco.range(node.from, node.to));
    },
  });
  return Decoration.set(marks, true);
}

const linkRenderPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) {
    try {
      this.decorations = buildLinkDecos(view);
      console.log('linkRenderPlugin OK, decos:', this.decorations.size);
    } catch (e) {
      console.error('linkRenderPlugin failed:', e);
      this.decorations = Decoration.none;
    }
  }
  update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged) this.decorations = buildLinkDecos(u.view); }
}, { decorations: v => v.decorations });

export function linkRenderer(): Extension { return linkRenderPlugin; }
