import { For, Show, createMemo, createSignal } from 'solid-js';
import { useI18n } from '../../i18n/context';

// Frontmatter is an open record: known keys plus arbitrary user properties
// (flattened at the top level by the backend's `#[serde(flatten)] extra`).
export type Frontmatter = {
  uid?: string;
  title?: string;
  tags?: string[];
  created?: string;
  modified?: string;
} & Record<string, unknown>;

const KNOWN = new Set(['uid', 'title', 'tags', 'created', 'modified']);

/** Visual editor for a note's frontmatter: tags and custom key/value
 *  properties. Title stays in the toolbar. Dates are internal metadata. */
export default function FrontmatterEditor(props: { fm: Frontmatter; onChange: (fm: Frontmatter) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = createSignal(true);
  const [tagDraft, setTagDraft] = createSignal('');
  const [newKey, setNewKey] = createSignal('');

  const tags = () => props.fm.tags ?? [];
  const customKeys = createMemo(() => Object.keys(props.fm).filter(k => !KNOWN.has(k)));

  const patch = (changes: Partial<Frontmatter>) => props.onChange({ ...props.fm, ...changes });

  const addTag = () => {
    const v = tagDraft().trim().replace(/^#/, '');
    if (!v || tags().includes(v)) { setTagDraft(''); return; }
    patch({ tags: [...tags(), v] });
    setTagDraft('');
  };
  const removeTag = (tag: string) => patch({ tags: tags().filter(x => x !== tag) });

  const setCustom = (key: string, value: string) => patch({ [key]: value });
  const removeCustom = (key: string) => {
    const next = { ...props.fm };
    delete next[key];
    props.onChange(next);
  };
  const addProperty = () => {
    const k = newKey().trim();
    if (!k || k in props.fm) { setNewKey(''); return; }
    patch({ [k]: '' });
    setNewKey('');
  };

  return (
    <div class="fm-editor">
      {/* ── Collapsible header ─────────────────────────────────────────── */}
      <button class="fm-editor-header" onClick={() => setOpen(v => !v)}>
        <svg
          class="fm-editor-chevron"
          classList={{ 'fm-editor-chevron-open': open() }}
          width="10" height="10" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" stroke-width="2.5"
          stroke-linecap="round" stroke-linejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span class="fm-editor-header-text">{t('notes-fm-header')}</span>
        <span class="fm-editor-header-count">
          {tags().length > 0 || customKeys().length > 0
            ? `${tags().length + customKeys().length}`
            : ''}
        </span>
      </button>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div
        class="fm-editor-body"
        classList={{ 'fm-editor-body-collapsed': !open() }}
      >
        <div class="fm-editor-body-inner">
          {/* ── Tags ──────────────────────────────────────────────────────── */}
          <div class="fm-section">
            <div class="fm-section-label">{t('notes-fm-tags')}</div>
            <div class="fm-section-content">
              <div class="fm-tag-cloud">
                <For each={tags()}>
                  {tag => (
                    <span class="fm-tag">
                      <span class="fm-tag-hash">#</span>
                      {tag}
                      <button
                        class="fm-tag-remove"
                        onClick={() => removeTag(tag)}
                        title={t('notes-fm-remove-tag')}
                        aria-label={`${t('notes-fm-remove-tag')}: ${tag}`}
                      >
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </span>
                  )}
                </For>
                <input
                  type="text"
                  class="fm-tag-input"
                  value={tagDraft()}
                  placeholder={t('notes-fm-add-tag')}
                  onInput={e => setTagDraft((e.target as HTMLInputElement).value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                  onBlur={addTag}
                />
              </div>
            </div>
          </div>

          {/* ── Custom properties ───────────────────────────────────────── */}
          <Show when={customKeys().length > 0}>
            <div class="fm-section">
              <For each={customKeys()}>
                {key => (
                  <div class="fm-field-row">
                    <label class="fm-field-key">{key}</label>
                    <div class="fm-field-value">
                      <input
                        class="fm-field-input"
                        type="text"
                        value={String(props.fm[key] ?? '')}
                        spellcheck={false}
                        onInput={e => setCustom(key, (e.target as HTMLInputElement).value)}
                      />
                      <button
                        class="fm-field-remove"
                        onClick={() => removeCustom(key)}
                        title={t('notes-fm-remove-prop')}
                      >
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          {/* ── Add property ──────────────────────────────────────────────── */}
          <div class="fm-add-row">
            <input
              class="fm-field-input"
              style={{ flex: '1', 'min-width': '100px' }}
              type="text"
              value={newKey()}
              placeholder={t('notes-fm-add-prop')}
              spellcheck={false}
              onInput={e => setNewKey((e.target as HTMLInputElement).value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addProperty(); } }}
            />
            <button class="fm-add-btn" onClick={addProperty} disabled={!newKey().trim()}>
              + {t('notes-fm-add')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
