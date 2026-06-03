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

function formatDate(iso: string | undefined, locale: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Visual editor for a note's frontmatter: tags, read-only dates, and custom
 *  key/value properties. Title stays in the toolbar. */
export default function FrontmatterEditor(props: { fm: Frontmatter; onChange: (fm: Frontmatter) => void }) {
  const { t, locale } = useI18n();
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

  const Row = (rp: { label: string; children: any }) => (
    <div class="fm-row">
      <span class="fm-label">{rp.label}</span>
      <div style={{ flex: '1', 'min-width': '0' }}>{rp.children}</div>
    </div>
  );

  return (
    <div class="frontmatter-editor" style={{
      'flex-shrink': '0', padding: '10px 14px', display: 'flex', 'flex-direction': 'column', gap: '6px',
      'border-bottom': '1px solid var(--surface0)', background: 'var(--base)',
    }}>
      {/* Tags */}
      <Row label={t('notes-fm-tags')}>
        <div style={{ display: 'flex', 'flex-wrap': 'wrap', gap: '4px', 'align-items': 'center' }}>
          <For each={tags()}>
            {tag => (
              <span class="fm-tag">
                #{tag}
                <button class="fm-tag-remove" onClick={() => removeTag(tag)} title={t('notes-fm-remove-tag')}>×</button>
              </span>
            )}
          </For>
          <input
            type="text"
            value={tagDraft()}
            placeholder={t('notes-fm-add-tag')}
            onInput={e => setTagDraft((e.target as HTMLInputElement).value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
            onBlur={addTag}
            style={{ flex: '1', 'min-width': '80px', 'font-size': '11px', color: 'var(--text)', background: 'transparent' }}
          />
        </div>
      </Row>

      {/* Custom properties */}
      <For each={customKeys()}>
        {key => (
          <Row label={key}>
            <div style={{ display: 'flex', gap: '6px', 'align-items': 'center' }}>
              <input
                class="fm-input"
                type="text"
                value={String(props.fm[key] ?? '')}
                onInput={e => setCustom(key, (e.target as HTMLInputElement).value)}
              />
              <button class="fm-tag-remove" onClick={() => removeCustom(key)} title={t('notes-fm-remove-prop')}>×</button>
            </div>
          </Row>
        )}
      </For>

      {/* Dates (read-only) */}
      <Row label={t('notes-fm-created')}>
        <span style={{ 'font-size': '11px', color: 'var(--subtext)' }}>{formatDate(props.fm.created, locale())}</span>
      </Row>
      <Row label={t('notes-fm-modified')}>
        <span style={{ 'font-size': '11px', color: 'var(--subtext)' }}>{formatDate(props.fm.modified, locale())}</span>
      </Row>

      {/* Add property */}
      <Row label="">
        <div style={{ display: 'flex', gap: '6px', 'align-items': 'center' }}>
          <input
            class="fm-input"
            type="text"
            value={newKey()}
            placeholder={t('notes-fm-add-prop')}
            onInput={e => setNewKey((e.target as HTMLInputElement).value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addProperty(); } }}
            style={{ flex: '1' }}
          />
          <button class="fm-add-btn" onClick={addProperty}>
            + {t('notes-fm-add')}
          </button>
        </div>
      </Row>
    </div>
  );
}
