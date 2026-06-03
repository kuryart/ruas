import { createMemo, createEffect } from 'solid-js';
import { marked } from 'marked';
import 'katex/dist/katex.min.css';
import katex from 'katex';
import { openExternal } from '../../utils/api';
import { embedKind, fillNoteEmbed } from './editor/embedRenderer';
import { openNoteByTitle } from './editor/wikiLink';
import { renderMermaid } from './editor/mermaidLoader';
import { extractHeadings } from './editor/toc';
import { renderTagsHtml } from './editor/tags';

export interface ViewApi {
  scrollToHeading: (slug: string) => void;
}

marked.setOptions({ gfm: true });

const escapeAttr = (s: string) => s.replace(/"/g, '&quot;');

/** Strip internal ` ^blockId` markers so the block code is never rendered. */
function stripBlockIds(body: string): string {
  return body.replace(/ \^[a-zA-Z0-9-]{4,12}(\s*)$/gm, '$1');
}

// Pull `$$…$$` / `$…$` math out of the body *before* marked runs (so it can't
// mangle `_`, `^`, etc.), render with KaTeX, and stash behind placeholder
// tokens that are swapped back into the final HTML.
function extractMath(body: string): { text: string; math: string[] } {
  const math: string[] = [];
  const stash = (expr: string, display: boolean) => {
    const i = math.length;
    try {
      math.push(katex.renderToString(expr.trim(), { throwOnError: false, displayMode: display }));
    } catch {
      math.push(`<code class="math-error">${escapeAttr(expr)}</code>`);
    }
    return `%%RUASMATH${i}%%`;
  };
  let text = body.replace(/\$\$([\s\S]+?)\$\$/g, (_m, e) => stash(e, true));
  text = text.replace(/(^|[^\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$/g, (_m, lead, e) => `${lead}${stash(e, false)}`);
  return { text, math };
}


/** Replace `![[target]]` embeds with placeholders / inline media. */
function renderEmbeds(html: string): string {
  return html.replace(/!\[\[([^\]\n|]+)(?:\|[^\]\n]+)?\]\]/g, (_m, target) => {
    const t = (target as string).trim();
    const a = escapeAttr(t);
    switch (embedKind(t)) {
      case 'image': return `<img class="embed-img" src="${a}" alt="${a}">`;
      case 'pdf':   return `<iframe class="embed-pdf" src="${a}"></iframe>`;
      default:      return `<div class="embed-note" data-embed="${a}" data-title="${a}"></div>`;
    }
  });
}

/** Replace `[[target]]` / `[[target|alias]]` / `[[note^block]]` with clickable
 *  wiki-link anchors. Block refs carry `data-block` so the click can scroll. */
function renderWikiLinks(html: string): string {
  return html.replace(/(^|[^!])\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g, (_m, lead, target, alias) => {
    const raw = (target as string).trim();
    const caret = raw.indexOf('^');
    const note = caret === -1 ? raw : raw.slice(0, caret);
    const block = caret === -1 ? '' : raw.slice(caret + 1);
    const label = (alias ?? note).trim();
    const blockAttr = block ? ` data-block="${escapeAttr(block)}"` : '';
    return `${lead}<a class="wiki-link" data-title="${escapeAttr(note)}"${blockAttr}>${label}</a>`;
  });
}

export default function ViewPane(props: { body: string; onReady?: (api: ViewApi) => void }) {
  let container!: HTMLDivElement;

  props.onReady?.({
    scrollToHeading: slug => {
      const sel = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(slug) : slug;
      container?.querySelector(`#${sel}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
  });

  const html = createMemo(() => {
    const { text, math } = extractMath(stripBlockIds(props.body));
    const out = renderTagsHtml(renderWikiLinks(renderEmbeds(marked.parse(text, { async: false }) as string)));
    return out.replace(/%%RUASMATH(\d+)%%/g, (_m, i) => math[+i] ?? '');
  });

  // After each render, fill note-embed placeholders and render mermaid diagrams.
  createEffect(() => {
    html(); // track
    queueMicrotask(() => {
      // Assign heading anchor ids (same slugs the TOC uses) for scroll-to.
      const headings = extractHeadings(props.body);
      container?.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6').forEach((el, i) => {
        if (headings[i]) el.id = headings[i].slug;
      });

      container?.querySelectorAll<HTMLElement>('.embed-note[data-embed]').forEach(el => {
        if (el.dataset.filled) return;
        el.dataset.filled = '1';
        void fillNoteEmbed(el, el.dataset.embed ?? '');
      });

      container?.querySelectorAll<HTMLElement>('code.language-mermaid').forEach(code => {
        const pre = code.closest('pre');
        if (!pre || pre.dataset.rendered) return;
        pre.dataset.rendered = '1';
        void renderMermaid(code.textContent ?? '')
          .then(svg => {
            const div = document.createElement('div');
            div.className = 'mermaid-block';
            div.innerHTML = svg;
            pre.replaceWith(div);
          })
          .catch((e: unknown) => {
            pre.classList.add('mermaid-error');
            pre.textContent = e instanceof Error ? e.message : String(e);
          });
      });
    });
  });

  function onClick(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest('.wiki-link, .embed-note') as HTMLElement | null;
    if (el?.dataset.title) {
      e.preventDefault();
      void openNoteByTitle(el.dataset.title, e.ctrlKey || e.metaKey, el.dataset.block || undefined);
      return;
    }
    // Plain markdown links: open externally instead of navigating the webview.
    const a = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
    if (a?.href) {
      e.preventDefault();
      void openExternal(a.href);
    }
  }

  return (
    <div style={{ 'overflow-y': 'auto', height: '100%', 'box-sizing': 'border-box' }}>
      <div
        ref={container}
        class="prose"
        style={{ padding: '24px 32px 48px', 'max-width': '760px', margin: '0 auto' }}
        innerHTML={html()}
        onClick={onClick}
      />
    </div>
  );
}
