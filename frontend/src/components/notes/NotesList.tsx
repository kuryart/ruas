import { For, Show, createResource, createSignal } from 'solid-js';
import { useI18n } from '../../i18n/context';
import { invoke } from '../../utils/api';
import { pushHistory } from '../../stores/historyStore';
import { navigateToNote, openNotePermanent } from '../workspace/workspaceStore';

interface NoteMeta {
  path: string;
  title: string;
  tags: string[] | null;
  modified: string | null;
}

interface Note {
  path: string;
  frontmatter: { title?: string };
  body: string;
}

interface TreeNode {
  name: string;
  path: string;
  is_dir: boolean;
  children: TreeNode[];
}

function formatRelative(isoDate: string, locale: string): string {
  const diffMs = new Date(isoDate).getTime() - Date.now();
  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHr = Math.round(diffMin / 60);
  const diffDay = Math.round(diffHr / 24);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (Math.abs(diffSec) < 60) return rtf.format(diffSec, 'second');
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute');
  if (Math.abs(diffHr) < 24) return rtf.format(diffHr, 'hour');
  if (Math.abs(diffDay) < 30) return rtf.format(diffDay, 'day');
  const diffMonth = Math.round(diffDay / 30);
  if (Math.abs(diffMonth) < 12) return rtf.format(diffMonth, 'month');
  return rtf.format(Math.round(diffMonth / 12), 'year');
}

// ── Folder collapse state (persisted) ───────────────────────────────────────

const COLLAPSE_KEY = 'ruas.notes.tree.collapsed';
function loadCollapsed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]') as string[]); }
  catch { return new Set(); }
}

function openNote(path: string, title: string, permanent: boolean) {
  if (permanent) openNotePermanent(path, title);
  else navigateToNote(path, title);
}

export default function NotesList() {
  const { t, locale } = useI18n();
  const [query, setQuery] = createSignal('');
  const [creating, setCreating] = createSignal(false);
  const [collapsed, setCollapsed] = createSignal<Set<string>>(loadCollapsed());

  const [notes, { refetch: refetchNotes }] = createResource<NoteMeta[]>(() => invoke<NoteMeta[]>('list_notes'));
  const [tree, { refetch: refetchTree }] = createResource<TreeNode[]>(() => invoke<TreeNode[]>('list_notes_tree'));

  const refetch = async () => { await Promise.all([refetchNotes(), refetchTree()]); };

  function toggleDir(path: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  async function createNote() {
    if (creating()) return;
    setCreating(true);
    try {
      const note = await invoke<Note>('create_note', { title: '' });
      await refetch();
      const title = note.frontmatter.title ?? t('notes-untitled');
      openNotePermanent(note.path, title);
      pushHistory({
        description: t('notes-history-create'),
        undo: async () => { await invoke('delete_note', { path: note.path }); await refetch(); },
        redo: async () => { await invoke('save_note', { note }); await refetch(); openNotePermanent(note.path, title); },
      });
    } finally {
      setCreating(false);
    }
  }

  const filtered = () => {
    const q = query().toLowerCase();
    return (notes() ?? []).filter(n =>
      !q || n.title.toLowerCase().includes(q) || (n.tags ?? []).some(tag => tag.toLowerCase().includes(q)),
    );
  };

  // ── Tree row (recursive) ───────────────────────────────────────────────
  const TreeRow = (p: { node: TreeNode; depth: number }) => {
    const pad = () => `${10 + p.depth * 12}px`;
    return (
      <Show
        when={p.node.is_dir}
        fallback={
          <div
            class="note-tree-item"
            style={{ 'padding-left': pad() }}
            onClick={e => openNote(p.node.path, p.node.name, e.ctrlKey || e.metaKey)}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" style={{ 'flex-shrink': '0' }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
            </svg>
            <span class="truncate" style={{ 'font-size': '13px', color: 'var(--text)' }}>{p.node.name}</span>
          </div>
        }
      >
        <div
          class="note-tree-folder"
          style={{ 'padding-left': pad() }}
          onClick={() => toggleDir(p.node.path)}
        >
          <span style={{ 'font-size': '9px', color: 'var(--muted)', width: '10px', 'flex-shrink': '0' }}>
            {collapsed().has(p.node.path) ? '▸' : '▾'}
          </span>
          <span class="truncate" style={{ 'font-size': '13px', 'font-weight': '500', color: 'var(--subtext)' }}>{p.node.name}</span>
        </div>
        <Show when={!collapsed().has(p.node.path)}>
          <For each={p.node.children}>{child => <TreeRow node={child} depth={p.depth + 1} />}</For>
        </Show>
      </Show>
    );
  };

  return (
    <div class="note-list">
      {/* Header */}
      <div style={{ padding: '12px 14px 8px', 'flex-shrink': '0', 'border-bottom': '1px solid var(--surface0)' }}>
        <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', 'margin-bottom': '8px' }}>
          <span style={{ 'font-size': '13px', 'font-weight': '600', color: 'var(--text)' }}>{t('notes-title')}</span>
          <button class="list-new-btn" title={t('notes-new')} onClick={createNote} disabled={creating()}>
            +
          </button>
        </div>

        {/* Search */}
        <div class="list-search">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2.5">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            type="text"
            placeholder={t('notes-search-placeholder')}
            value={query()}
            onInput={e => setQuery((e.target as HTMLInputElement).value)}
          />
          <Show when={query()}>
            <button onClick={() => setQuery('')} style={{ color: 'var(--muted)', 'font-size': '12px' }}>✕</button>
          </Show>
        </div>
      </div>

      {/* Body: tree when browsing, flat results when searching */}
      <div style={{ flex: '1 1 0', 'overflow-y': 'auto', padding: '4px 0' }}>
        <Show when={query()} fallback={
          <Show
            when={!tree.loading}
            fallback={<div style={{ padding: '20px', 'text-align': 'center', color: 'var(--muted)', 'font-size': '12px' }}>{t('notes-loading')}</div>}
          >
            <Show
              when={(tree() ?? []).length > 0}
              fallback={<div style={{ padding: '20px', 'text-align': 'center', color: 'var(--muted)', 'font-size': '12px' }}>{t('notes-empty')}</div>}
            >
              <For each={tree()}>{node => <TreeRow node={node} depth={0} />}</For>
            </Show>
          </Show>
        }>
          <Show
            when={filtered().length > 0}
            fallback={<div style={{ padding: '20px', 'text-align': 'center', color: 'var(--muted)', 'font-size': '12px' }}>{t('notes-no-results')}</div>}
          >
            <For each={filtered()}>
              {note => (
                <div
                  class="note-list-item"
                  onClick={e => openNote(note.path, note.title, e.ctrlKey || e.metaKey)}
                >
                  <div style={{ display: 'flex', 'align-items': 'baseline', gap: '6px', 'justify-content': 'space-between' }}>
                    <span class="truncate" style={{ 'font-size': '13px', 'font-weight': '500', color: 'var(--text)', flex: '1', 'min-width': '0' }}>
                      {note.title}
                    </span>
                    <Show when={note.modified}>
                      <span style={{ 'font-size': '10px', color: 'var(--muted)', 'flex-shrink': '0', 'white-space': 'nowrap' }}>
                        {formatRelative(note.modified!, locale())}
                      </span>
                    </Show>
                  </div>
                  <Show when={(note.tags ?? []).length > 0}>
                    <div style={{ display: 'flex', gap: '4px', 'flex-wrap': 'wrap', 'margin-top': '4px' }}>
                      <For each={note.tags!}>
                        {tag => (
                          <span style={{ 'font-size': '10px', padding: '1px 6px', background: 'var(--surface1)', color: 'var(--subtext)', 'border-radius': '10px' }}>
                            #{tag}
                          </span>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </div>
  );
}
