import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { type EditorState, type Range, StateField } from '@codemirror/state';
import { EmbedWidget } from './editor/embedRenderer';

// ── Heading widget ───────────────────────────────────────────────────────────

const HEADING_SIZES: Record<number, string> = {
  1: '1.6em', 2: '1.35em', 3: '1.15em', 4: '1.05em', 5: '0.95em', 6: '0.875em',
};

class HeadingWidget extends WidgetType {
  constructor(readonly level: number, readonly text: string) { super(); }
  eq(o: HeadingWidget) { return o.level === this.level && o.text === this.text; }
  toDOM() {
    const el = document.createElement(`h${this.level}`);
    el.textContent = this.text;
    Object.assign(el.style, {
      color: 'var(--text)',
      fontWeight: this.level <= 2 ? '700' : '600',
      fontSize: HEADING_SIZES[this.level] ?? '1em',
      lineHeight: '1.3', margin: '0.1em 0', fontFamily: 'inherit',
    });
    return el;
  }
  ignoreEvent() { return false; }
}

// ── Block widgets ────────────────────────────────────────────────────────────

class HrWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const el = document.createElement('hr');
    Object.assign(el.style, {
      border: 'none', borderTop: '1px solid var(--surface1)', margin: '0.6em 0',
    });
    return el;
  }
}

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const el = document.createElement('span');
    el.textContent = '•';
    Object.assign(el.style, { color: 'var(--overlay1)', display: 'inline-block' });
    return el;
  }
}

class ImageWidget extends WidgetType {
  constructor(readonly alt: string, readonly src: string) { super(); }
  eq(o: ImageWidget) { return o.alt === this.alt && o.src === this.src; }
  toDOM() {
    const el = document.createElement('img');
    el.src = this.src;
    el.alt = this.alt;
    Object.assign(el.style, { maxWidth: '100%', borderRadius: 'var(--radius)', margin: '0.3em 0', display: 'block' });
    return el;
  }
  ignoreEvent() { return false; }
}

class InlineTagWidget extends WidgetType {
  constructor(readonly tag: 'sup' | 'sub', readonly text: string) { super(); }
  eq(o: InlineTagWidget) { return o.tag === this.tag && o.text === this.text; }
  toDOM() {
    const el = document.createElement(this.tag);
    el.textContent = this.text;
    return el;
  }
  ignoreEvent() { return false; }
}

class WikiLinkWidget extends WidgetType {
  constructor(readonly target: string, readonly label: string) { super(); }
  eq(o: WikiLinkWidget) { return o.target === this.target && o.label === this.label; }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'wiki-link';
    el.dataset.title = this.target;
    el.textContent = this.label;
    el.style.color = 'var(--accent)';
    el.style.cursor = 'pointer';
    return el;
  }
  // false = CM6 lets the event propagate to domEventHandlers (wikiClick).
  ignoreEvent() { return false; }
}

class MdLinkWidget extends WidgetType {
  constructor(readonly label: string, readonly href: string) { super(); }
  eq(o: MdLinkWidget) { return o.label === this.label && o.href === this.href; }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'md-link';
    el.dataset.href = this.href;
    el.textContent = this.label;
    el.style.cssText = 'color:var(--accent);text-decoration:underline;text-underline-offset:2px;cursor:pointer';
    return el;
  }
  // false = CM6 lets the event propagate to domEventHandlers (wikiClick).
  ignoreEvent() { return false; }
}

class BlockRefWidget extends WidgetType {
  constructor(readonly noteTitle: string, readonly blockId: string, readonly label: string) { super(); }
  eq(o: BlockRefWidget) {
    return o.noteTitle === this.noteTitle && o.blockId === this.blockId && o.label === this.label;
  }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'wiki-link block-ref';
    el.dataset.title = this.noteTitle;
    el.dataset.block = this.blockId;
    el.style.color = 'var(--accent)';
    el.style.cursor = 'pointer';
    // No `^id` badge — the block code is internal and must stay hidden.
    el.textContent = this.label;
    return el;
  }
  // false = CM6 lets the event propagate to domEventHandlers (wikiClick).
  ignoreEvent() { return false; }
}

class TableWidget extends WidgetType {
  constructor(readonly source: string) { super(); }
  eq(o: TableWidget) { return o.source === this.source; }
  toDOM() {
    const wrap = document.createElement('div');
    wrap.style.margin = '0.4em 0';
    const table = document.createElement('table');
    Object.assign(table.style, {
      borderCollapse: 'collapse', width: '100%', fontSize: '0.95em', fontFamily: 'inherit',
    });

    const rows = this.source.split('\n').filter(l => l.trim().length > 0);
    if (rows.length === 0) return wrap;

    const splitCells = (line: string) =>
      line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

    const aligns = rows.length > 1
      ? splitCells(rows[1]).map(c => {
          const l = c.startsWith(':'), r = c.endsWith(':');
          return l && r ? 'center' : r ? 'right' : l ? 'left' : 'left';
        })
      : [];

    const isDelim = (line: string) => /^[\s|:-]+$/.test(line) && line.includes('-');

    rows.forEach((line, i) => {
      if (i === 1 && isDelim(line)) return; // delimiter row
      const cells = splitCells(line);
      const tr = document.createElement('tr');
      const header = i === 0;
      cells.forEach((c, ci) => {
        const cell = document.createElement(header ? 'th' : 'td');
        cell.textContent = c;
        Object.assign(cell.style, {
          textAlign: aligns[ci] ?? 'left',
          padding: '5px 10px',
          border: '1px solid var(--surface1)',
          color: header ? 'var(--text)' : 'var(--subtext)',
          background: header ? 'var(--surface0)' : 'transparent',
          fontWeight: header ? '600' : '400',
        });
        tr.appendChild(cell);
      });
      table.appendChild(tr);
    });

    wrap.appendChild(table);
    return wrap;
  }
  ignoreEvent() { return false; }
}

// ── Reusable mark decorations ────────────────────────────────────────────────

const mark = (style: string) => Decoration.mark({ attributes: { style } });

const DECO = {
  bold:      mark('font-weight:700;color:var(--text)'),
  italic:    mark('font-style:italic'),
  strike:    mark('text-decoration:line-through;color:var(--muted)'),
  code:      mark('background:var(--surface0);color:var(--peach);border-radius:4px;padding:0.05em 0.3em'),
  highlight: mark('background:var(--yellow);color:var(--crust);border-radius:2px;padding:0 1px'),
  footnote:  mark('color:var(--accent);font-size:0.75em;vertical-align:super'),
  tag:       mark('color:var(--accent);font-weight:500'),
  quoteLine: Decoration.line({ attributes: { style: 'border-left:3px solid var(--accent);padding-left:10px;color:var(--muted);font-style:italic' } }),
};

const hide = Decoration.replace({});

// ── Build ────────────────────────────────────────────────────────────────────

function buildDecorations(state: EditorState): DecorationSet {
  const cursorLine = state.doc.lineAt(state.selection.main.head).number;

  const onCursor = (from: number, to: number) => {
    const a = state.doc.lineAt(from).number;
    const b = state.doc.lineAt(to).number;
    return cursorLine >= a && cursorLine <= b;
  };

  const ranges: Range<Decoration>[] = [];
  const replaced: Array<[number, number]> = []; // track replace ranges to avoid overlap

  const overlapsReplaced = (from: number, to: number) =>
    replaced.some(([f, t]) => from < t && to > f);

  const pushReplace = (from: number, to: number, deco: Decoration) => {
    if (to <= from || overlapsReplaced(from, to)) return;
    replaced.push([from, to]);
    ranges.push(deco.range(from, to));
  };
  const pushMark = (from: number, to: number, deco: Decoration) => {
    if (to <= from) return;
    ranges.push(deco.range(from, to));
  };
  const pushLine = (pos: number, deco: Decoration) => {
    ranges.push(deco.range(pos));
  };
  const pushWidget = (from: number, to: number, deco: Decoration) => {
    if (overlapsReplaced(from, to)) return;
    if (to > from) replaced.push([from, to]);
    ranges.push(deco.range(from, to));
  };

  const slice = (from: number, to: number) => state.doc.sliceString(from, to);

  syntaxTree(state).iterate({
    enter(node) {
      const name = node.name;

      // Headings ────────────────────────────────────────────────────────────
      const hm = name.match(/^ATXHeading(\d)$/);
      if (hm) {
        if (onCursor(node.from, node.to)) return false;
        const level = parseInt(hm[1]);
        const line = state.doc.lineAt(node.from);
        // Strip the `# ` prefix and the ` ^id` marker — the heading widget
        // replaces the whole line so the blockId mark decoration is eclipsed.
        const text = line.text.replace(/^#+\s*/, '').replace(/ \^[a-zA-Z0-9-]{4,12}\s*$/, '');
        pushWidget(line.from, line.to, Decoration.replace({ widget: new HeadingWidget(level, text) }));
        return false;
      }

      // Horizontal rule ──────────────────────────────────────────────────────
      if (name === 'HorizontalRule') {
        if (onCursor(node.from, node.to)) return false;
        const line = state.doc.lineAt(node.from);
        pushWidget(line.from, line.to, Decoration.replace({ widget: new HrWidget() }));
        return false;
      }

      // Tables ─────────────────────────────────────────────────────────────────
      if (name === 'Table') {
        if (onCursor(node.from, node.to)) return false;
        const startLine = state.doc.lineAt(node.from);
        const endLine = state.doc.lineAt(node.to);
        const src = slice(node.from, node.to).replace(/ \^[a-zA-Z0-9-]{4,12}(\s*)$/gm, '$1');
        pushWidget(startLine.from, endLine.to,
          Decoration.replace({ widget: new TableWidget(src), block: true }));
        return false;
      }

      // Blockquote ─────────────────────────────────────────────────────────────
      if (name === 'Blockquote') {
        const first = state.doc.lineAt(node.from).number;
        const last = state.doc.lineAt(node.to).number;
        for (let ln = first; ln <= last; ln++) pushLine(state.doc.line(ln).from, DECO.quoteLine);
        return; // descend to hide QuoteMark
      }
      if (name === 'QuoteMark' && !onCursor(node.from, node.to)) {
        // hide '> ' including the following space if present
        const to = slice(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
        pushReplace(node.from, to, hide);
        return false;
      }

      // List markers → bullet ──────────────────────────────────────────────────
      if (name === 'ListMark') {
        if (onCursor(node.from, node.to)) return false;
        const txt = slice(node.from, node.to);
        if (/^[-*+]$/.test(txt)) {
          pushWidget(node.from, node.to, Decoration.replace({ widget: new BulletWidget() }));
        }
        return false;
      }

      // Images ─────────────────────────────────────────────────────────────────
      if (name === 'Image') {
        if (onCursor(node.from, node.to)) return false;
        const m = slice(node.from, node.to).match(/^!\[([^\]]*)\]\(([^)\s]+)/);
        if (m) pushWidget(node.from, node.to, Decoration.replace({ widget: new ImageWidget(m[1], m[2]) }));
        return false;
      }

      // Links → render the label as a clickable widget so a click opens the URL
      // (a plain mark would just place the caret and reveal the raw markdown).
      if (name === 'Link') {
        if (onCursor(node.from, node.to)) return false;
        const txt = slice(node.from, node.to);
        const m = txt.match(/^\[([^\]]*)\]\(([^)]*)\)$/);
        if (m) {
          const href = m[2].trim().split(/\s+/)[0]; // drop optional ("title")
          pushWidget(node.from, node.to, Decoration.replace({ widget: new MdLinkWidget(m[1], href) }));
        }
        return false;
      }

      // Inline code ─────────────────────────────────────────────────────────────
      if (name === 'InlineCode') {
        if (onCursor(node.from, node.to)) return false;
        pushMark(node.from, node.to, DECO.code);
        // hide the surrounding backticks
        pushReplace(node.from, node.from + 1, hide);
        pushReplace(node.to - 1, node.to, hide);
        return false;
      }

      // Emphasis families ───────────────────────────────────────────────────────
      if (name === 'StrongEmphasis' || name === 'Emphasis' || name === 'Strikethrough') {
        if (onCursor(node.from, node.to)) return false;
        const deco = name === 'StrongEmphasis' ? DECO.bold : name === 'Emphasis' ? DECO.italic : DECO.strike;
        pushMark(node.from, node.to, deco);
        // hide the delimiter marks (children)
        const cur = node.node.cursor();
        if (cur.firstChild()) {
          do {
            if (/Mark$/.test(cur.name)) pushReplace(cur.from, cur.to, hide);
          } while (cur.nextSibling());
        }
        return false;
      }

      // Superscript / Subscript ─────────────────────────────────────────────────
      if (name === 'Superscript' || name === 'Subscript') {
        if (onCursor(node.from, node.to)) return false;
        const inner = slice(node.from, node.to).replace(/^[\^~]/, '').replace(/[\^~]$/, '');
        pushWidget(node.from, node.to,
          Decoration.replace({ widget: new InlineTagWidget(name === 'Superscript' ? 'sup' : 'sub', inner) }));
        return false;
      }
    },
  });

  // ── Regex passes for syntax the parser doesn't expose ──────────────────────
  // (highlight ==x==, footnote refs [^id]) — line-by-line, skip cursor line.
  for (let ln = 1; ln <= state.doc.lines; ln++) {
    const line = state.doc.line(ln);
    if (ln === cursorLine) continue;
    let m: RegExpExecArray | null;

    // Embeds ![[target]] — rendered inline (note body / image / pdf)
    const em = /!\[\[([^\]\n|]+)(?:\|[^\]\n]+)?\]\]/g;
    while ((m = em.exec(line.text))) {
      const from = line.from + m.index;
      const to = line.from + m.index + m[0].length;
      if (overlapsReplaced(from, to)) continue;
      pushWidget(from, to, Decoration.replace({ widget: new EmbedWidget(m[1].trim()) }));
    }

    // Wiki links [[target]] / [[target|alias]] and block refs [[note^id]] (skip embeds ![[ )
    const wl = /(^|[^!])\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g;
    while ((m = wl.exec(line.text))) {
      const lead = m[1].length;
      const from = line.from + m.index + lead;
      const to = line.from + m.index + m[0].length;
      if (overlapsReplaced(from, to)) continue;
      const raw = m[2].trim();
      const alias = m[3]?.trim();
      const caretIdx = raw.indexOf('^');
      if (caretIdx !== -1) {
        // Block reference: [[noteTitle^blockId]]
        const noteTitle = raw.slice(0, caretIdx);
        const blockId = raw.slice(caretIdx + 1);
        const label = alias ?? noteTitle;
        pushWidget(from, to, Decoration.replace({ widget: new BlockRefWidget(noteTitle, blockId, label) }));
      } else {
        const label = alias ?? raw;
        pushWidget(from, to, Decoration.replace({ widget: new WikiLinkWidget(raw, label) }));
      }
    }

    // Block-id markers (` ^abc123`) are styled as small muted text by the
    // `blockIdConceal` extension — see editor/blockIdConceal.ts.

    const hl = /==([^=\n]+)==/g;
    while ((m = hl.exec(line.text))) {
      const from = line.from + m.index;
      const to = from + m[0].length;
      if (overlapsReplaced(from, to)) continue;
      pushReplace(from, from + 2, hide);
      pushReplace(to - 2, to, hide);
      pushMark(from + 2, to - 2, DECO.highlight);
    }

    const fn = /\[\^([^\]\s]+)\]/g;
    while ((m = fn.exec(line.text))) {
      const from = line.from + m.index;
      const to = from + m[0].length;
      if (overlapsReplaced(from, to)) continue;
      pushMark(from, to, DECO.footnote);
    }

    // Inline #tags (tag must start with a letter, so `# heading` never matches).
    const tg = /(^|\s)#([a-zA-Z][\w/-]*)/g;
    while ((m = tg.exec(line.text))) {
      const from = line.from + m.index + m[1].length;
      const to = from + 1 + m[2].length;
      if (overlapsReplaced(from, to)) continue;
      pushMark(from, to, DECO.tag);
    }
  }

  return Decoration.set(ranges, true);
}

// A StateField (not a ViewPlugin) because the table renderer emits a *block*
// decoration, which CodeMirror only accepts from state-provided sources.
export const markdownLivePreview = StateField.define<DecorationSet>({
  create: state => buildDecorations(state),
  update(value, tr) {
    if (tr.docChanged || tr.selection) return buildDecorations(tr.state);
    return value;
  },
  provide: f => EditorView.decorations.from(f),
});
