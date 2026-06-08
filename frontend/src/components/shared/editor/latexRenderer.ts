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
	toDOM(view: EditorView) {
		const el = document.createElement(this.display ? 'div' : 'span');
		el.className = this.display ? 'katex-block' : 'katex-inline';
		el.style.cursor = 'pointer';
		try {
			katex.render(this.expr, el, { throwOnError: false, displayMode: this.display });
		} catch (e) {
			el.classList.add('math-error');
			el.textContent = this.display ? `$$${this.expr}$$` : `$${this.expr}$`;
		}
		// KaTeX fonts load asynchronously — the widget height may change once they
		// arrive. Notify CM6 to re-measure so the height map stays accurate.
		document.fonts.ready.then(() => view.requestMeasure());
		return el;
	}
	ignoreEvent() { return false; }
}

// Source shown (highlighted) while the caret sits inside a math region.
const rawMark = Decoration.mark({ attributes: { style: 'color:var(--yellow)' } });

// Placeholder used only as atomic-range markers; never rendered visually.
const atomicMark = Decoration.mark({});

// Placeholder used only to track math region boundaries for rebuild decisions.
const mathMark = Decoration.mark({});

interface LatexState {
	decos: DecorationSet;
	// Widget ranges only (no rawMark) — used to make them atomic for keyboard
	// navigation. Kept separate so the cursor can still move freely inside the
	// revealed raw source when it touches the boundary.
	atomic: DecorationSet;
	// All math regions (widget or raw). Used to detect cursor crossing a math
	// boundary so we only call build() when necessary — rebuilding on every
	// cursor move forces CM6 to re-reconcile block decorations each keystroke,
	// which corrupts the height map during the async measurement cycle and
	// breaks vertical navigation for lines below the block.
	mathRanges: DecorationSet;
}

function build(state: EditorState): LatexState {
	const text = state.doc.toString();
	const sel = state.selection.main;
	const touches = (from: number, to: number) => sel.from <= to && sel.to >= from;
	const decoRanges: Range<Decoration>[] = [];
	const atomicRanges: Range<Decoration>[] = [];
	const mathRangesList: Range<Decoration>[] = [];
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
		const toLine = state.doc.lineAt(rawTo);
		const to = multiline ? Math.min(toLine.to, state.doc.length) : rawTo;
		taken.push([from, to]);
		mathRangesList.push(mathMark.range(from, to));
		if (touches(from, to)) {
			decoRanges.push(rawMark.range(rawFrom, rawTo));
		} else {
			decoRanges.push(Decoration.replace({ widget: new LatexWidget(expr, true), block: multiline }).range(from, to));
			atomicRanges.push(atomicMark.range(from, to));
		}
	}

	// Inline math: $ … $ — guard against `$5 and $10` style currency by forbidding
	// whitespace immediately inside the delimiters.
	const inline = /\$(?!\s)([^$\n]+?)(?<!\s)\$/g;
	while ((m = inline.exec(text))) {
		if (text[m.index - 1] === '\\') continue;
		const from = m.index, to = m.index + m[0].length;
		if (inCode(from, to)) continue;
		if (overlaps(from, to)) continue;
		mathRangesList.push(mathMark.range(from, to));
		if (touches(from, to)) {
			decoRanges.push(rawMark.range(from, to));
		} else {
			decoRanges.push(Decoration.replace({ widget: new LatexWidget(m[1].trim(), false) }).range(from, to));
			atomicRanges.push(atomicMark.range(from, to));
		}
	}

	return {
		decos: Decoration.set(decoRanges, true),
		atomic: Decoration.set(atomicRanges, true),
		mathRanges: Decoration.set(mathRangesList, true),
	};
}

export function latex(): Extension {
	console.log('[latex] extension loaded — build v4');
	const field = StateField.define<LatexState>({
		create: (state) => { console.log('[latex] create called'); return build(state); },
		update: (value, tr) => {
			if (!tr.docChanged && !tr.selection) return value;
			if (tr.docChanged) return build(tr.state);
			// Only rebuild when cursor crosses a math region boundary. Rebuilding on
			// every cursor move corrupts the height map for block decorations.
			const sel = tr.state.selection.main;
			const prev = tr.startState.selection.main;
			let rebuild = false;
			value.mathRanges.between(sel.from, sel.to, () => { rebuild = true; return false; });
			if (!rebuild) value.mathRanges.between(prev.from, prev.to, () => { rebuild = true; return false; });
			return rebuild ? build(tr.state) : value;
		},
		provide: f => EditorView.decorations.from(f, s => s.decos),
	});
	return [
		field,
		EditorView.atomicRanges.of(view => view.state.field(field, false)?.atomic ?? Decoration.none),
	];
}
