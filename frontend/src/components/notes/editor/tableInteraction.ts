import { Decoration, type DecorationSet, EditorView, keymap, showTooltip, type Tooltip } from '@codemirror/view';
import { type Extension, StateEffect, StateField } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

// ── Table model ──────────────────────────────────────────────────────────────

interface TLine {
  from: number;   // line start (doc pos)
  to: number;     // line end (doc pos)
  pipes: number[]; // absolute doc positions of unescaped '|'
  isDelim: boolean;
}
interface TModel {
  from: number;
  to: number;
  lines: TLine[];
  cols: number; // logical column count (header)
}

function parsePipes(text: string, lineFrom: number): number[] {
  const pipes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '|' && (i === 0 || text[i - 1] !== '\\')) pipes.push(lineFrom + i);
  }
  return pipes;
}

function parseTable(state: EditorView['state'], from: number, to: number): TModel {
  const startLine = state.doc.lineAt(from).number;
  const endLine = state.doc.lineAt(Math.max(from, to - 1)).number;
  const lines: TLine[] = [];
  for (let ln = startLine; ln <= endLine; ln++) {
    const line = state.doc.line(ln);
    const pipes = parsePipes(line.text, line.from);
    const isDelim = /^[\s|:-]+$/.test(line.text) && line.text.includes('-');
    lines.push({ from: line.from, to: line.to, pipes, isDelim });
  }
  const header = lines.find(l => !l.isDelim);
  const cols = header ? Math.max(0, header.pipes.length - 1) : 0;
  return { from, to, lines, cols };
}

/** Column c occupies the span between pipes[c] and pipes[c+1]. */
function cellSpan(line: TLine, c: number): { from: number; to: number } | null {
  if (c < 0 || c + 1 >= line.pipes.length) return null;
  return { from: line.pipes[c] + 1, to: line.pipes[c + 1] };
}

function locateCell(model: TModel, pos: number): { r: number; c: number } | null {
  for (let r = 0; r < model.lines.length; r++) {
    const line = model.lines[r];
    if (line.isDelim) continue;
    if (pos < line.from || pos > line.to) continue;
    for (let c = 0; c + 1 < line.pipes.length; c++) {
      if (pos > line.pipes[c] && pos <= line.pipes[c + 1]) return { r, c };
    }
    // cursor before first pipe / after last → clamp to nearest cell
    if (line.pipes.length >= 2) return { r, c: pos <= line.pipes[0] ? 0 : line.pipes.length - 2 };
  }
  return null;
}

function findTableAt(state: EditorView['state'], pos: number): { from: number; to: number } | null {
  let node: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(state).resolveInner(pos, 0);
  while (node && node.name !== 'Table') node = node.parent;
  return node ? { from: node.from, to: node.to } : null;
}

// ── Selection state ──────────────────────────────────────────────────────────

interface TableSel {
  tableFrom: number;
  tableTo: number;
  anchor: { r: number; c: number };
  focus: { r: number; c: number };
}

const setTableSel = StateEffect.define<TableSel | null>();

const tableSelField = StateField.define<TableSel | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setTableSel)) return e.value;
    if (tr.docChanged || tr.selection) return null;
    return value;
  },
});

const selMark = Decoration.mark({ attributes: { style: 'background:rgba(137,180,250,0.28)' } });

const selDecorations = EditorView.decorations.compute([tableSelField], state => {
  const sel = state.field(tableSelField);
  if (!sel) return Decoration.none;
  const model = parseTable(state, sel.tableFrom, sel.tableTo);
  const rMin = Math.min(sel.anchor.r, sel.focus.r), rMax = Math.max(sel.anchor.r, sel.focus.r);
  const cMin = Math.min(sel.anchor.c, sel.focus.c), cMax = Math.max(sel.anchor.c, sel.focus.c);
  const ranges = [];
  for (let r = rMin; r <= rMax; r++) {
    const line = model.lines[r];
    if (!line || line.isDelim) continue;
    for (let c = cMin; c <= cMax; c++) {
      const span = cellSpan(line, c);
      if (span && span.to > span.from) ranges.push(selMark.range(span.from, span.to));
    }
  }
  return Decoration.set(ranges, true);
});

// ── Delete handling ──────────────────────────────────────────────────────────

function handleDelete(view: EditorView): boolean {
  const sel = view.state.field(tableSelField, false);
  if (!sel) return false;
  const model = parseTable(view.state, sel.tableFrom, sel.tableTo);

  const rMin = Math.min(sel.anchor.r, sel.focus.r), rMax = Math.max(sel.anchor.r, sel.focus.r);
  const cMin = Math.min(sel.anchor.c, sel.focus.c), cMax = Math.max(sel.anchor.c, sel.focus.c);

  const lastLineIdx = model.lines.length - 1;
  const allRows = rMin === 0 && rMax === lastLineIdx;
  const allCols = cMin === 0 && cMax === model.cols - 1;

  const changes: { from: number; to: number; insert?: string }[] = [];

  if (allRows && allCols) {
    // Delete entire table block (incl. trailing newline if any)
    const start = model.lines[0].from;
    const endLineTo = model.lines[lastLineIdx].to;
    const end = Math.min(view.state.doc.length, endLineTo + 1);
    changes.push({ from: start, to: end });
  } else if (allRows && !allCols) {
    // Delete columns cMin..cMax from every line (incl. delimiter)
    for (const line of model.lines) {
      if (cMin >= line.pipes.length - 1) continue;
      const left = line.pipes[cMin];
      const right = line.pipes[Math.min(cMax + 1, line.pipes.length - 1)];
      if (right > left) changes.push({ from: left, to: right });
    }
  } else if (allCols && !allRows) {
    // Delete selected content rows (keep header at index 0 and the delimiter)
    for (let r = rMin; r <= rMax; r++) {
      const line = model.lines[r];
      if (!line || line.isDelim || r === 0) continue;
      changes.push({ from: line.from, to: Math.min(view.state.doc.length, line.to + 1) });
    }
  } else {
    // Clear content of selected cells
    for (let r = rMin; r <= rMax; r++) {
      const line = model.lines[r];
      if (!line || line.isDelim) continue;
      for (let c = cMin; c <= cMax; c++) {
        const span = cellSpan(line, c);
        if (span && span.to > span.from) changes.push({ from: span.from, to: span.to, insert: '  ' });
      }
    }
  }

  if (changes.length === 0) return false;
  view.dispatch({ changes, effects: setTableSel.of(null) });
  return true;
}

// ── Insert row / column ──────────────────────────────────────────────────────

function insertRow(view: EditorView, table: { from: number; to: number }, pos: number) {
  const model = parseTable(view.state, table.from, table.to);
  const cur = view.state.doc.lineAt(pos).number;
  const line = model.lines.find(l => view.state.doc.lineAt(l.from).number === cur) ?? model.lines[model.lines.length - 1];
  const newRow = '\n|' + '   |'.repeat(Math.max(1, model.cols));
  view.dispatch({ changes: { from: line.to, insert: newRow } });
}

function insertCol(view: EditorView, table: { from: number; to: number }, pos: number) {
  const model = parseTable(view.state, table.from, table.to);
  const cell = locateCell(model, pos);
  const c = cell ? cell.c : Math.max(0, model.cols - 1);
  const changes: { from: number; insert: string }[] = [];
  for (const line of model.lines) {
    const rightPipe = line.pipes[Math.min(c + 1, line.pipes.length - 1)];
    if (rightPipe === undefined) continue;
    changes.push({ from: rightPipe + 1, insert: line.isDelim ? '---|' : '   |' });
  }
  if (changes.length) view.dispatch({ changes });
}

// ── Floating +row / +col buttons (tooltip) ───────────────────────────────────

function tableTooltip(state: EditorView['state']): Tooltip | null {
  // Don't show while a multi-cell selection is active
  if (state.field(tableSelField, false)) return null;
  const pos = state.selection.main.head;
  const table = findTableAt(state, pos);
  if (!table) return null;

  return {
    pos,
    above: true,
    strictSide: false,
    arrow: false,
    create: (view) => {
      const dom = document.createElement('div');
      Object.assign(dom.style, {
        display: 'flex', gap: '4px', padding: '3px',
        background: 'var(--surface0)', border: '1px solid var(--surface1)',
        borderRadius: 'var(--radius)',
      });
      const mkBtn = (label: string, onClick: () => void) => {
        const b = document.createElement('button');
        b.textContent = label;
        Object.assign(b.style, {
          fontSize: '11px', padding: '2px 8px', borderRadius: '4px',
          color: 'var(--text)', background: 'var(--surface1)', cursor: 'pointer',
        });
        b.onmousedown = (e) => { e.preventDefault(); };
        b.onclick = () => onClick();
        return b;
      };
      dom.appendChild(mkBtn('+ row', () => insertRow(view, table, view.state.selection.main.head)));
      dom.appendChild(mkBtn('+ col', () => insertCol(view, table, view.state.selection.main.head)));
      return { dom };
    },
  };
}

const tableTooltipField = StateField.define<Tooltip | null>({
  create: tableTooltip,
  update(value, tr) {
    if (!tr.docChanged && !tr.selection && !tr.effects.some(e => e.is(setTableSel))) return value;
    return tableTooltip(tr.state);
  },
  provide: f => showTooltip.from(f),
});

// ── Mouse handling ────────────────────────────────────────────────────────────

export function tableInteraction(): Extension {
  let dragging: { tableFrom: number; tableTo: number; anchor: { r: number; c: number } } | null = null;

  const mouse = EditorView.domEventHandlers({
    mousedown(e, view) {
      if (e.button !== 0) return false;
      // Reset any prior table selection on a fresh click
      if (view.state.field(tableSelField, false)) view.dispatch({ effects: setTableSel.of(null) });
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos == null) return false;
      const table = findTableAt(view.state, pos);
      if (!table) { dragging = null; return false; }
      const model = parseTable(view.state, table.from, table.to);
      const cell = locateCell(model, pos);
      if (!cell) { dragging = null; return false; }
      dragging = { tableFrom: table.from, tableTo: table.to, anchor: cell };
      return false; // allow normal cursor placement
    },
    mousemove(e, view) {
      if (!dragging) return false;
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos == null) return false;
      const model = parseTable(view.state, dragging.tableFrom, dragging.tableTo);
      const cell = locateCell(model, pos);
      if (!cell) return false;
      if (cell.r !== dragging.anchor.r || cell.c !== dragging.anchor.c) {
        view.contentDOM.style.userSelect = 'none';
        view.dispatch({ effects: setTableSel.of({ ...dragging, focus: cell }) });
      }
      return false;
    },
    mouseup(_e, view) {
      dragging = null;
      view.contentDOM.style.userSelect = '';
      return false;
    },
  });

  return [
    tableSelField,
    selDecorations,
    tableTooltipField,
    mouse,
    keymap.of([
      { key: 'Backspace', run: handleDelete },
      { key: 'Delete', run: handleDelete },
    ]),
  ];
}
