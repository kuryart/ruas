// Inline `#tag` support. A tag starts with a letter so `#1` and the heading
// marker `# ` (followed by a space) never match.

const TAG = /(^|\s)#([a-zA-Z][\w/-]*)/g;

/** Unique tag names (without the leading `#`) found in a note body. */
export function extractBodyTags(body: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(TAG.source, 'g');
  while ((m = re.exec(body))) out.add(m[2]);
  return [...out];
}

/** Wrap `#tag` occurrences in rendered HTML with a styled span. */
export function renderTagsHtml(html: string): string {
  return html.replace(/(^|[\s>])#([a-zA-Z][\w/-]*)/g, (_m, lead, tag) => `${lead}<span class="tag">#${tag}</span>`);
}
