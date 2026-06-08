/**
 * Shared table utilities used by the live preview (TableWidget).
 *
 * The interactive table editing is now handled by codemirror-markdown-tables,
 * but the live-preview StateField still renders tables as inline HTML widgets
 * in edit mode, and those need to split cells correctly — especially when
 * wiki-links ([[note|alias]]) contain pipe characters that must not be treated
 * as column separators.
 */

/**
 * Map every unescaped pipe that is NOT inside `[[…]]`.
 * Returns absolute document positions (lineFrom + column index).
 */
export function parsePipes(text: string, lineFrom: number): number[] {
  const pipes: number[] = [];
  let inWikiLink = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '[' && text[i + 1] === '[') { inWikiLink = true; }
    if (text[i] === ']' && text[i + 1] === ']') { inWikiLink = false; }
    if (text[i] === '|') {
      if (i > 0 && text[i - 1] === '\\') continue; // escaped \|
      if (inWikiLink) continue;                      // alias pipe in [[...]]
      pipes.push(lineFrom + i);
    }
  }
  return pipes;
}

/**
 * Split a table row string by '|' into cells, respecting:
 * - `\|` escaped pipes (treated as literal `|` in cell content)
 * - `|` inside `[[...]]` wiki links (not a column separator)
 */
export function splitTableCells(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inWiki = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '[' && line[i + 1] === '[') { inWiki = true; }
    if (ch === ']' && line[i + 1] === ']') { inWiki = false; }
    if (ch === '\\' && line[i + 1] === '|') {
      current += '|';
      i++;
      continue;
    }
    if (ch === '|' && !inWiki) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  // Trim leading/trailing empty cells from the full line
  if (cells.length > 1) {
    // Remove leading empty if line starts with |
    if (cells[0] === '' && (line.trimStart()[0] === '|')) cells.shift();
    // Remove trailing empty if line ends with |
    if (cells.length > 0 && cells[cells.length - 1] === '' && line.trimEnd().endsWith('|')) cells.pop();
  }
  return cells;
}
