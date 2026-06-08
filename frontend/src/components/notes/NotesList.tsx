import { For, Show, createEffect, createResource, createSignal, on } from 'solid-js';
import { useI18n } from '../../i18n/context';
import { invoke } from '../../utils/api';
import { pushHistory } from '../../stores/historyStore';
import { notesVersion } from '../../stores/layoutStore';
import { navigateToNote, openNotePermanent } from '../workspace/workspaceStore';
import ContextMenu, { type ContextMenuItem } from '../shared/ContextMenu';
import ConfirmDialog from '../shared/ConfirmDialog';

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

type CtxTarget =
  | { kind: 'empty' }
  | { kind: 'note'; path: string; title: string }
  | { kind: 'folder'; path: string };

export default function NotesList() {
  const { t, locale } = useI18n();
  const [query, setQuery] = createSignal('');
  const [creating, setCreating] = createSignal(false);
  const [collapsed, setCollapsed] = createSignal<Set<string>>(loadCollapsed());
  const [ctxMenu, setCtxMenu] = createSignal<{ x: number; y: number; target: CtxTarget } | null>(null);
  const [confirmState, setConfirmState] = createSignal<{ message: string; onConfirm: () => void } | null>(null);
  const [dragOverFolder, setDragOverFolder] = createSignal<string | null>(null);
  const [moving, setMoving] = createSignal(false);

  const [notes, { refetch: refetchNotes }] = createResource<NoteMeta[]>(() => invoke<NoteMeta[]>('list_notes'));
  const [tree, { refetch: refetchTree }] = createResource<TreeNode[]>(() => invoke<TreeNode[]>('list_notes_tree'));
  const [rootDir] = createResource(() => invoke<string>('get_notes_dir'));

  const refetch = async () => { await Promise.all([refetchNotes(), refetchTree()]); };

  createEffect(on(notesVersion, () => {
    void Promise.all([refetchNotes(), refetchTree()]);
  }, { defer: true }));

  function toggleDir(path: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  async function createNote(folder?: string) {
    if (creating()) return;
    setCreating(true);
    try {
      const note = await invoke<Note>('create_note', { title: t('notes-untitled'), folder: folder ?? null });
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

  async function createFolder() {
    const name = window.prompt(t('notes-ctx-folder-name-prompt'), t('notes-ctx-folder-default-name'));
    if (!name?.trim()) return;
    try {
      await invoke('create_folder', { name: name.trim() });
      await refetch();
    } catch (e) {
      window.alert(String(e));
    }
  }

  function deleteNote(path: string) {
    setCtxMenu(null);
    setConfirmState({
      message: t('notes-delete-confirm'),
      onConfirm: async () => {
        setConfirmState(null);
        await invoke('delete_note', { path });
        await refetch();
      },
    });
  }

  async function renameNote(path: string, currentTitle: string) {
    setCtxMenu(null);
    const name = window.prompt(t('notes-ctx-rename-prompt'), currentTitle);
    if (!name?.trim() || name.trim() === currentTitle) return;
    try {
      const note = await invoke<Note>('read_note', { path });
      note.frontmatter.title = name.trim();
      await invoke('save_note', { note });
      await refetch();
    } catch (e) { window.alert(String(e)); }
  }

  function deleteFolder(path: string) {
    setCtxMenu(null);
    setConfirmState({
      message: t('notes-ctx-delete-folder-confirm'),
      onConfirm: async () => {
        setConfirmState(null);
        try {
          await invoke('delete_folder', { path });
          await refetch();
        } catch (e) {
          window.alert(String(e));
        }
      },
    });
  }

  async function renameFolder(path: string, currentName: string) {
    setCtxMenu(null);
    const name = window.prompt(t('notes-ctx-rename-prompt'), currentName);
    if (!name?.trim() || name.trim() === currentName) return;
    try {
      await invoke('rename_note_folder', { path, name: name.trim() });
      await refetch();
    } catch (e) { window.alert(String(e)); }
  }

  async function moveNote(notePath: string, destFolder: string) {
    if (moving()) return;
    // Skip if dropping into the same parent folder.
    const parentPath = notePath.split('/').slice(0, -1).join('/') || rootDir() || '';
    if (destFolder === parentPath) return;
    setMoving(true);
    try {
      await invoke('move_note', { path: notePath, folder: destFolder });
      await refetch();
    } catch (e) {
      window.alert(String(e));
    } finally {
      setMoving(false);
    }
  }

  // ── Drag-and-drop ─────────────────────────────────────────────────────
  function onDragStartNote(e: DragEvent, path: string) {
    if (moving()) { e.preventDefault(); return; }
    e.dataTransfer!.setData('text/plain', path);
    e.dataTransfer!.effectAllowed = 'move';
  }
  function onDragStartFolder(e: DragEvent, path: string) {
    if (moving()) { e.preventDefault(); return; }
    e.dataTransfer!.setData('text/plain', path);
    e.dataTransfer!.effectAllowed = 'move';
  }
  function onDragOverFolder(e: DragEvent, folderPath: string) {
    e.preventDefault();
    if (!moving()) { e.dataTransfer!.dropEffect = 'move'; setDragOverFolder(folderPath); }
  }
  function onDragLeaveFolder() { setDragOverFolder(null); }
  function onDropFolder(e: DragEvent, folderPath: string) {
    e.preventDefault();
    setDragOverFolder(null);
    if (moving()) return;
    const sourcePath = e.dataTransfer!.getData('text/plain');
    if (sourcePath && folderPath) void moveNote(sourcePath, folderPath);
  }
  function onDropRoot(e: DragEvent) {
    e.preventDefault();
    setDragOverFolder(null);
    if (moving()) return;
    const r = rootDir();
    if (!r) return;
    const sourcePath = e.dataTransfer!.getData('text/plain');
    if (sourcePath) void moveNote(sourcePath, r);
  }

  function openCtxMenu(e: MouseEvent, target: CtxTarget) {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, target });
  }

  function ctxItems(): ContextMenuItem[] {
    const ctx = ctxMenu();
    if (!ctx) return [];
    switch (ctx.target.kind) {
      case 'empty': return [
        { label: t('notes-ctx-new-note'), action: createNote },
        { label: t('notes-ctx-new-folder'), action: createFolder },
      ];
      case 'folder': return [
        { label: t('notes-ctx-new-note'), action: () => createNote((ctx.target as { kind: 'folder'; path: string }).path) },
        { label: t('notes-ctx-rename'), action: () => renameFolder((ctx.target as { kind: 'folder'; path: string }).path, (ctx.target as { kind: 'folder'; path: string; name?: string }).name || '') },
        { label: t('notes-ctx-delete'), action: () => deleteFolder((ctx.target as { kind: 'folder'; path: string }).path), danger: true },
      ];
      case 'note': return [
        { label: t('notes-ctx-open'), action: () => { const n = ctx.target as { kind: 'note'; path: string; title: string }; navigateToNote(n.path, n.title); } },
        { label: t('notes-ctx-open-new-tab'), action: () => { const n = ctx.target as { kind: 'note'; path: string; title: string }; openNotePermanent(n.path, n.title); } },
        { label: t('notes-ctx-rename'), action: () => renameNote((ctx.target as { kind: 'note'; path: string; title: string }).path, (ctx.target as { kind: 'note'; path: string; title: string }).title) },
        { label: t('notes-ctx-delete'), action: () => deleteNote((ctx.target as { kind: 'note'; path: string; title: string }).path), danger: true },
      ];
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
            draggable="true"
            onDragStart={e => onDragStartNote(e, p.node.path)}
            onClick={e => openNote(p.node.path, p.node.name, e.ctrlKey || e.metaKey)}
            onContextMenu={e => openCtxMenu(e, { kind: 'note', path: p.node.path, title: p.node.name })}
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
          classList={{ 'drag-over': dragOverFolder() === p.node.path }}
          style={{ 'padding-left': pad() }}
          draggable="true"
          onDragStart={e => onDragStartFolder(e, p.node.path)}
          onClick={() => toggleDir(p.node.path)}
          onContextMenu={e => openCtxMenu(e, { kind: 'folder', path: p.node.path })}
          onDragOver={e => onDragOverFolder(e, p.node.path)}
          onDragEnter={e => { e.preventDefault(); onDragOverFolder(e, p.node.path); }}
          onDragLeave={e => { e.preventDefault(); onDragLeaveFolder(); }}
          onDrop={e => onDropFolder(e, p.node.path)}
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
    <div class="note-list" onContextMenu={e => openCtxMenu(e, { kind: 'empty' })}>
      <Show when={ctxMenu()}>
        <ContextMenu
          x={ctxMenu()!.x}
          y={ctxMenu()!.y}
          items={ctxItems()}
          onClose={() => setCtxMenu(null)}
        />
      </Show>
      <Show when={confirmState()}>
        <ConfirmDialog
          message={confirmState()!.message}
          onConfirm={confirmState()!.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      </Show>
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
      <div
        style={{ flex: '1 1 0', 'overflow-y': 'auto', padding: '4px 0' }}
        classList={{ 'drag-over': dragOverFolder() === (rootDir() ?? '__root__') }}
        onDragOver={e => { e.preventDefault(); if (!moving()) { e.dataTransfer!.dropEffect = 'move'; const r = rootDir(); if (r) setDragOverFolder(r); } }}
        onDragLeave={e => { e.preventDefault(); onDragLeaveFolder(); }}
        onDrop={e => { const r = rootDir(); if (r) onDropRoot(e); }}
      >
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
                  onContextMenu={e => openCtxMenu(e, { kind: 'note', path: note.path, title: note.title })}
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
