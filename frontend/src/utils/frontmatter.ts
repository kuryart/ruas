import yaml from 'js-yaml';

export function dumpYaml(obj: Record<string, unknown>): string {
  return yaml.dump(obj, {
    noRefs: true,
    lineWidth: -1,
    skipInvalid: true,
    quotingType: '"',
    forceQuotes: false,
  });
}

export function loadYaml(str: string): Record<string, unknown> | null {
  try {
    const result = yaml.load(str);
    if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
      return result as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** Split a markdown document into frontmatter YAML and body.
 *  Returns null if the opening `---` delimiters are absent or malformed. */
export function splitFrontmatter(content: string): { fmYaml: string; body: string } | null {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!m) return null;
  return { fmYaml: m[1], body: m[2].replace(/^\r?\n/, '') };
}

/** Join a YAML string (already ending with \n) and a body into a full document. */
export function joinFrontmatter(fmYaml: string, body: string): string {
  return `---\n${fmYaml}---\n\n${body}`;
}

/** Build a full markdown document from a frontmatter object and body. */
export function buildDocument(fm: Record<string, unknown>, body: string): string {
  // Strip undefined/null/empty-string top-level values so the YAML stays clean.
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fm)) {
    if (v !== undefined && v !== null && v !== '') clean[k] = v;
  }
  return joinFrontmatter(dumpYaml(clean), body);
}
