// Shared heading extraction for the Table of Contents and for assigning anchor
// ids in the rendered view. Both consume this so their slugs stay in sync.

export interface Heading {
  level: number;
  text: string;
  line: number; // 1-based line number in the body
  slug: string;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'heading';
}

/** Parse ATX headings (`#`…`######`) from a note body, skipping fenced code. */
export function extractHeadings(body: string): Heading[] {
  const out: Heading[] = [];
  const seen = new Map<string, number>();
  let inFence = false;

  body.split('\n').forEach((raw, i) => {
    const trimmed = raw.trim();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) { inFence = !inFence; return; }
    if (inFence) return;

    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(raw);
    if (!m) return;

    const text = m[2].replace(/ \^[a-zA-Z0-9-]{4,12}$/, '').trim(); // drop block-id marker
    let slug = slugify(text);
    const n = seen.get(slug) ?? 0;
    seen.set(slug, n + 1);
    if (n > 0) slug = `${slug}-${n}`;

    out.push({ level: m[1].length, text, line: i + 1, slug });
  });

  return out;
}
