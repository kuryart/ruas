import { WidgetType } from '@codemirror/view';
import { marked } from 'marked';
import { invoke } from '../../../utils/api';

interface NoteMeta { path: string; title: string }
interface Note { path: string; body: string }

export type EmbedKind = 'image' | 'pdf' | 'note';

const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|avif)$/i;
const PDF_EXT = /\.pdf$/i;

export function embedKind(target: string): EmbedKind {
  if (IMAGE_EXT.test(target)) return 'image';
  if (PDF_EXT.test(target)) return 'pdf';
  return 'note';
}

// Cache resolved note-embed HTML per target for the session (avoids re-fetching
// on every widget rebuild). Keyed by the lowercased target title.
const noteHtmlCache = new Map<string, string>();

/** Resolve a note title → path → body and render its markdown into `el`. */
export async function fillNoteEmbed(el: HTMLElement, target: string) {
  const key = target.toLowerCase();
  const cached = noteHtmlCache.get(key);
  if (cached !== undefined) { el.innerHTML = cached; return; }
  try {
    const results = await invoke<NoteMeta[]>('search_notes', { query: target });
    const note = results.find(r => r.title.toLowerCase() === key) ?? results[0];
    if (!note) { el.innerHTML = '<em style="color:var(--muted)">Note not found</em>'; return; }
    const full = await invoke<Note>('read_note', { path: note.path });
    const html = marked.parse(full.body, { async: false }) as string;
    noteHtmlCache.set(key, html);
    el.innerHTML = html;
  } catch {
    el.innerHTML = '<em style="color:var(--red)">Failed to load embed</em>';
  }
}

/**
 * CM6 widget rendering `![[target]]`. For `.md` (or extension-less) targets it
 * embeds the referenced note's body; images and PDFs render inline.
 */
export class EmbedWidget extends WidgetType {
  constructor(readonly target: string) { super(); }
  eq(o: EmbedWidget) { return o.target === this.target; }

  toDOM() {
    const kind = embedKind(this.target);

    if (kind === 'image') {
      const img = document.createElement('img');
      img.src = this.target;
      img.alt = this.target;
      img.style.maxWidth = '100%';
      img.style.borderRadius = 'var(--radius)';
      return img;
    }

    if (kind === 'pdf') {
      const frame = document.createElement('iframe');
      frame.src = this.target;
      frame.style.width = '100%';
      frame.style.height = '480px';
      frame.style.border = '1px solid var(--surface1)';
      frame.style.borderRadius = 'var(--radius)';
      return frame;
    }

    const el = document.createElement('div');
    el.className = 'embed-note';
    el.dataset.title = this.target;
    el.innerHTML = '<em style="color:var(--muted)">Loading…</em>';
    void fillNoteEmbed(el, this.target);
    return el;
  }

  ignoreEvent() { return false; }
}
