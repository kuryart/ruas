import { highlightTree, tagHighlighter, tags } from '@lezer/highlight';

const CODE_HIGHLIGHT = tagHighlighter([
  { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword], class: 'hc-kw' },
  { tag: [tags.definitionKeyword, tags.moduleKeyword],              class: 'hc-defkw' },
  { tag: tags.modifier,                                              class: 'hc-mod' },
  { tag: [tags.string, tags.special(tags.string)],                  class: 'hc-str' },
  { tag: tags.regexp,                                                class: 'hc-re' },
  { tag: [tags.number, tags.integer, tags.float],                   class: 'hc-num' },
  { tag: [tags.bool, tags.null],                                     class: 'hc-lit' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], class: 'hc-cmt' },
  { tag: [tags.function(tags.variableName), tags.function(tags.definition(tags.variableName))], class: 'hc-fn' },
  { tag: tags.definition(tags.variableName),                         class: 'hc-var-def' },
  { tag: tags.variableName,                                          class: 'hc-var' },
  { tag: [tags.typeName, tags.className],                            class: 'hc-type' },
  { tag: tags.namespace,                                             class: 'hc-ns' },
  { tag: tags.self,                                                  class: 'hc-self' },
  { tag: tags.operator,                                              class: 'hc-op' },
  { tag: tags.punctuation,                                           class: 'hc-punct' },
  { tag: [tags.propertyName, tags.special(tags.propertyName)],      class: 'hc-prop' },
  { tag: tags.attributeName,                                         class: 'hc-attr-name' },
  { tag: tags.attributeValue,                                        class: 'hc-attr-val' },
  { tag: tags.tagName,                                               class: 'hc-tag-name' },
  { tag: tags.angleBracket,                                          class: 'hc-bracket' },
]);

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function highlightBlock(code: string, parser: any): string {
  const tree = parser.parse(code);
  let html = '';
  let pos = 0;

  highlightTree(tree, CODE_HIGHLIGHT, (from, to, cls) => {
    if (from > pos) html += escapeHtml(code.slice(pos, from));
    html += `<span class="${cls}">${escapeHtml(code.slice(from, to))}</span>`;
    pos = to;
  });

  if (pos < code.length) html += escapeHtml(code.slice(pos));
  return html;
}
