import { For, Show, createEffect, createResource, createSignal } from 'solid-js';
import { useI18n } from '../../i18n/context';
import { invoke } from '../../utils/api';
import { pushHistory } from '../../stores/historyStore';
import { contactsVersion } from '../../stores/contactsStore';
import { navigateToContact, openContactPermanent } from '../workspace/workspaceStore';
import ContextMenu, { type ContextMenuItem } from '../shared/ContextMenu';
import ConfirmDialog from '../shared/ConfirmDialog';

interface ContactMeta {
  path: string;
  display_name: string;
  initials: string;
  org: string | null;
  primary_email: string | null;
  tags: string[] | null;
}

interface Contact {
  path: string;
  frontmatter: { fn?: string; [k: string]: unknown };
  body: string;
}

function avatarColor(initials: string): string {
  const palette = ['#89b4fa', '#a6e3a1', '#fab387', '#f5c2e7', '#94e2d5', '#cba6f7', '#f9e2af', '#f38ba8'];
  let h = 0;
  for (const c of initials) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return palette[h % palette.length];
}

// ── Context menu types ──────────────────────────────────────────────────────

type CtxTarget =
  | { kind: 'empty' }
  | { kind: 'contact'; path: string; display_name: string }
  | { kind: 'folder'; path: string };

// ── Folder collapse state (persisted) ──────────────────────────────────────

const COLLAPSE_KEY = 'ruas.contacts.tree.collapsed';
function loadCollapsed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]') as string[]); }
  catch { return new Set(); }
}

interface TreeNode {
  name: string;
  path: string;
  is_dir: boolean;
  children: TreeNode[];
}

export default function ContactsList() {
  const { t } = useI18n();

  const [query, setQuery] = createSignal('');
  // Re-fetch whenever any contact is mutated (ContactDetail calls invalidateContacts).
  const [contacts, { refetch }] = createResource<ContactMeta[], number>(
    contactsVersion,
    () => invoke<ContactMeta[]>('list_contacts'),
  );
  const [tree, { refetch: refetchTree }] = createResource<TreeNode[]>(() => invoke<TreeNode[]>('list_contacts_tree'));
  const [rootDir] = createResource(() => invoke<string>('get_contacts_dir'));

  const refetchAll = async () => { await Promise.all([refetch(), refetchTree()]); };

  const [collapsed, setCollapsed] = createSignal<Set<string>>(loadCollapsed());

  function toggleDir(path: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  // ── New contact form state ─────────────────────────────────────────────
  const [showForm, setShowForm] = createSignal(false);
  const [newGiven, setNewGiven] = createSignal('');
  const [newFamily, setNewFamily] = createSignal('');
  const [creating, setCreating] = createSignal(false);
  let givenRef: HTMLInputElement | undefined;

  createEffect(() => {
    if (showForm()) setTimeout(() => givenRef?.focus(), 0);
  });

  function openForm() {
    setNewGiven('');
    setNewFamily('');
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
  }

  // ── Context menu ───────────────────────────────────────────────────────

  const [ctxMenu, setCtxMenu] = createSignal<{ x: number; y: number; target: CtxTarget } | null>(null);
  const [confirmState, setConfirmState] = createSignal<{ message: string; onConfirm: () => void } | null>(null);
  const [dragOverFolder, setDragOverFolder] = createSignal<string | null>(null);
  const [moving, setMoving] = createSignal(false);

  async function createFolder() {
    const name = window.prompt(t('contacts-ctx-folder-name-prompt'), t('contacts-ctx-folder-default-name'));
    if (!name?.trim()) return;
    try {
      await invoke('create_contact_folder', { name: name.trim() });
      await refetchAll();
    } catch (e) {
      window.alert(String(e));
    }
  }

  function deleteContact(path: string) {
    setCtxMenu(null);
    setConfirmState({
      message: t('contacts-ctx-delete-confirm'),
      onConfirm: async () => {
        setConfirmState(null);
        await invoke('delete_contact', { path });
        await refetchAll();
      },
    });
  }

  async function renameContact(path: string, currentName: string) {
    setCtxMenu(null);
    const name = window.prompt(t('contacts-ctx-rename-prompt'), currentName);
    if (!name?.trim() || name.trim() === currentName) return;
    try {
      const contact = await invoke<Contact>('read_contact', { path });
      contact.frontmatter.fn = name.trim();
      await invoke('save_contact', { contact });
      await refetchAll();
    } catch (e) { window.alert(String(e)); }
  }

  async function deleteFolder(path: string) {
    setCtxMenu(null); setConfirmState({ message: t('contacts-ctx-delete-folder-confirm'), onConfirm: async () => { setConfirmState(null); try { await invoke('delete_contact_folder', { path }); await refetchAll(); } catch (e) { window.alert(String(e)); } }, });
  }

  async function renameFolder(path: string, currentName: string) {
    setCtxMenu(null); const name = window.prompt(t('contacts-ctx-rename-prompt'), currentName);
    if (!name?.trim() || name.trim() === currentName) return;
    try { await invoke('rename_contact_folder', { path, name: name.trim() }); await refetchAll(); } catch (e) { window.alert(String(e)); }
  }

  async function moveContact(contactPath: string, destFolder: string) {
    if (moving()) return; const parentPath = contactPath.split('/').slice(0, -1).join('/') || rootDir() || '';
    if (destFolder === parentPath) return; setMoving(true);
    try { await invoke('move_contact', { path: contactPath, folder: destFolder }); await refetchAll(); } catch (e) { window.alert(String(e)); } finally { setMoving(false); }
  }
  function onDragStartContact(e: DragEvent, path: string) { if (moving()) { e.preventDefault(); return; } e.dataTransfer!.setData('text/plain', path); e.dataTransfer!.effectAllowed = 'move'; }
  function onDragStartFolder(e: DragEvent, path: string) { if (moving()) { e.preventDefault(); return; } e.dataTransfer!.setData('text/plain', path); e.dataTransfer!.effectAllowed = 'move'; }
  function onDragOverFolder(e: DragEvent, folderPath: string) { e.preventDefault(); if (!moving()) { e.dataTransfer!.dropEffect = 'move'; setDragOverFolder(folderPath); } }
  function onDragLeaveFolder() { setDragOverFolder(null); }
  function onDropFolder(e: DragEvent, folderPath: string) { e.preventDefault(); setDragOverFolder(null); if (moving()) return; const sourcePath = e.dataTransfer!.getData('text/plain'); if (sourcePath && folderPath) void moveContact(sourcePath, folderPath); }
  function onDropRoot(e: DragEvent) { e.preventDefault(); setDragOverFolder(null); if (moving()) return; const r = rootDir(); if (!r) return; const sourcePath = e.dataTransfer!.getData('text/plain'); if (sourcePath) void moveContact(sourcePath, r); }
  function openCtxMenu(e: MouseEvent, target: CtxTarget) { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, target }); }
  function ctxItems(): ContextMenuItem[] {
    const ctx = ctxMenu(); if (!ctx) return [];
    switch (ctx.target.kind) {
      case 'empty': return [{ label: t('contacts-ctx-new-contact'), action: openForm }, { label: t('contacts-ctx-new-folder'), action: createFolder }];
      case 'folder': return [{ label: t('contacts-ctx-new-contact'), action: () => createContactInFolder((ctx.target as { kind: 'folder'; path: string }).path) }, { label: t('contacts-ctx-rename'), action: () => renameFolder((ctx.target as { kind: 'folder'; path: string }).path, (ctx.target as { kind: 'folder'; path: string; name?: string }).name || '') }, { label: t('contacts-ctx-delete'), action: () => deleteFolder((ctx.target as { kind: 'folder'; path: string }).path), danger: true }];
      case 'contact': return [{ label: t('contacts-ctx-rename'), action: () => renameContact((ctx.target as { kind: 'contact'; path: string; display_name: string }).path, (ctx.target as { kind: 'contact'; path: string; display_name: string }).display_name) }, { label: t('contacts-ctx-delete'), action: () => deleteContact((ctx.target as { kind: 'contact'; path: string }).path), danger: true }];
    }
  }
  async function submitCreate(e: Event, folder?: string) {
    e.preventDefault(); const given = newGiven().trim(); if (!given || creating()) return; setCreating(true);
    try {
      const contact = await invoke<Contact>('create_contact', { givenName: given, familyName: newFamily().trim(), folder: folder ?? null });
      setShowForm(false); await refetchAll();
      const displayName = (contact.frontmatter['fn'] as string | undefined) ?? `${given} ${newFamily()}`.trim();
      openContactPermanent(contact.path, displayName);
      pushHistory({ description: t('contacts-history-create'), undo: async () => { await invoke('delete_contact', { path: contact.path }); await refetchAll(); }, redo: async () => { await invoke('save_contact', { contact }); await refetch(); openContactPermanent(contact.path, displayName); } });
    } finally { setCreating(false); }
  }

  function createContactInFolder(folderPath: string) {
    setCtxMenu(null);
    const name = window.prompt(t('contacts-ctx-rename-prompt'), '');
    if (!name?.trim()) return;
    setCreating(true);
    invoke<Contact>('create_contact', { givenName: name.trim(), familyName: '', folder: folderPath }).then(async contact => {
      await refetchAll();
      const displayName = (contact.frontmatter['fn'] as string | undefined) ?? name.trim();
      openContactPermanent(contact.path, displayName);
      pushHistory({ description: t('contacts-history-create'), undo: async () => { await invoke('delete_contact', { path: contact.path }); await refetchAll(); }, redo: async () => { await invoke('save_contact', { contact }); await refetch(); openContactPermanent(contact.path, displayName); } });
    }).catch(e => window.alert(String(e))).finally(() => setCreating(false));
  }

  const filtered = () => {
    const q = query().toLowerCase();
    return (contacts() ?? []).filter(c =>
      !q ||
      c.display_name.toLowerCase().includes(q) ||
      (c.org ?? '').toLowerCase().includes(q) ||
      (c.primary_email ?? '').toLowerCase().includes(q),
    );
  };

  return (
    <div class="contact-list" onContextMenu={e => openCtxMenu(e, { kind: 'empty' })}>
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
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div style={{ padding: '12px 14px 8px', 'flex-shrink': '0', 'border-bottom': '1px solid var(--surface0)' }}>
        <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', 'margin-bottom': '8px' }}>
          <span style={{ 'font-size': '13px', 'font-weight': '600', color: 'var(--text)' }}>
            {t('contacts-header')}
          </span>
          <button class="list-new-btn" title={t('contacts-new-btn-title')} onClick={openForm}>
            +
          </button>
        </div>

        {/* Search bar */}
        <div class="list-search">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2.5">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            type="text"
            placeholder={t('contacts-search-placeholder')}
            value={query()}
            onInput={e => setQuery((e.target as HTMLInputElement).value)}
          />
          <Show when={query()}>
            <button onClick={() => setQuery('')} style={{ color: 'var(--muted)', 'font-size': '12px' }}>✕</button>
          </Show>
        </div>

        {/* ── Inline new-contact form ─────────────────────────────────── */}
        <Show when={showForm()}>
          <form
            onSubmit={submitCreate}
            style={{
              display: 'flex', gap: '6px', 'align-items': 'center',
              'margin-top': '8px',
              background: 'var(--surface0)', 'border-radius': 'var(--radius)',
              padding: '6px 8px', border: '1px solid var(--accent)',
            }}
          >
            <input
              ref={givenRef}
              type="text"
              placeholder={t('contacts-new-firstname-placeholder')}
              value={newGiven()}
              onInput={e => setNewGiven((e.target as HTMLInputElement).value)}
              onKeyDown={e => e.key === 'Escape' && cancelForm()}
              style={{
                flex: '1', 'min-width': '0', padding: '3px 6px',
                background: 'var(--base)', border: '1px solid var(--surface1)',
                'border-radius': '4px', 'font-size': '12px', color: 'var(--text)',
              }}
            />
            <input
              type="text"
              placeholder={t('contacts-new-lastname-placeholder')}
              value={newFamily()}
              onInput={e => setNewFamily((e.target as HTMLInputElement).value)}
              onKeyDown={e => e.key === 'Escape' && cancelForm()}
              style={{
                flex: '1', 'min-width': '0', padding: '3px 6px',
                background: 'var(--base)', border: '1px solid var(--surface1)',
                'border-radius': '4px', 'font-size': '12px', color: 'var(--text)',
              }}
            />
            <button
              type="submit"
              disabled={creating() || !newGiven().trim()}
              style={{
                padding: '3px 8px', 'border-radius': '4px', 'font-size': '12px',
                background: 'var(--accent)', color: 'var(--crust)', 'font-weight': '600',
                opacity: creating() || !newGiven().trim() ? '0.5' : '1',
              }}
            >
              {creating() ? t('contacts-new-submitting') : '✓'}
            </button>
            <button
              type="button"
              onClick={cancelForm}
              style={{ padding: '3px 6px', 'border-radius': '4px', 'font-size': '12px', color: 'var(--muted)' }}
            >
              ✕
            </button>
          </form>
        </Show>
      </div>

      {/* ── Body: tree when browsing, flat results when searching ──────── */}
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
            fallback={<div style={{ padding: '20px', 'text-align': 'center', color: 'var(--muted)', 'font-size': '12px' }}>{t('contacts-loading')}</div>}
          >
            <Show
              when={(tree() ?? []).length > 0}
              fallback={<div style={{ padding: '20px', 'text-align': 'center', color: 'var(--muted)', 'font-size': '12px' }}>{t('contacts-empty')}</div>}
            >
              <For each={tree()}>{node => <ContactTreeRow node={node} depth={0} collapsed={collapsed()} toggleDir={toggleDir} openCtxMenu={openCtxMenu} dragOverFolder={dragOverFolder()} onDragStartContact={onDragStartContact} onDragStartFolder={onDragStartFolder} onDragOverFolder={onDragOverFolder} onDragLeaveFolder={onDragLeaveFolder} onDropFolder={onDropFolder} />}</For>
            </Show>
          </Show>
        }>
          <Show
            when={!contacts.loading}
            fallback={<div style={{ padding: '20px', 'text-align': 'center', color: 'var(--muted)', 'font-size': '12px' }}>{t('contacts-loading')}</div>}
          >
            <Show
              when={filtered().length > 0}
              fallback={<div style={{ padding: '20px', 'text-align': 'center', color: 'var(--muted)', 'font-size': '12px' }}>{t('contacts-no-results')}</div>}
            >
              <For each={filtered()}>
                {contact => {
                  const color = avatarColor(contact.initials);
                  return (
                    <div
                      class="contact-list-item"
                      onClick={e => {
                        if (e.ctrlKey || e.metaKey) {
                          openContactPermanent(contact.path, contact.display_name);
                        } else {
                          navigateToContact(contact.path, contact.display_name);
                        }
                      }}
                      onContextMenu={e => openCtxMenu(e, { kind: 'contact', path: contact.path, display_name: contact.display_name })}
                    >
                      <div style={{
                        width: '34px', height: '34px', 'border-radius': '50%', 'flex-shrink': '0',
                        background: `${color}22`, border: `1px solid ${color}55`,
                        display: 'flex', 'align-items': 'center', 'justify-content': 'center',
                        'font-size': '12px', 'font-weight': '600', color,
                      }}>
                        {contact.initials || '?'}
                      </div>
                      <div style={{ flex: '1', 'min-width': '0' }}>
                        <div class="truncate" style={{ 'font-size': '13px', 'font-weight': '500', color: 'var(--text)' }}>
                          {contact.display_name}
                        </div>
                        <Show when={contact.org ?? contact.primary_email}>
                          <div class="truncate" style={{ 'font-size': '11px', color: 'var(--muted)', 'margin-top': '1px' }}>
                            {contact.org ?? contact.primary_email}
                          </div>
                        </Show>
                      </div>
                    </div>
                  );
                }}
              </For>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
}

// ── Tree row (recursive) ──────────────────────────────────────────────────

function ContactTreeRow(props: {
  node: TreeNode;
  depth: number;
  collapsed: Set<string>;
  toggleDir: (p: string) => void;
  openCtxMenu: (e: MouseEvent, target: CtxTarget) => void;
  dragOverFolder: string | null;
  onDragStartContact: (e: DragEvent, path: string) => void;
  onDragStartFolder: (e: DragEvent, path: string) => void;
  onDragOverFolder: (e: DragEvent, path: string) => void;
  onDragLeaveFolder: () => void;
  onDropFolder: (e: DragEvent, path: string) => void;
}) {
  const pad = () => `${10 + props.depth * 12}px`;
  return (
    <Show
      when={props.node.is_dir}
      fallback={
        <div
          class="contact-tree-item"
          style={{ 'padding-left': pad() }}
          draggable="true"
          onDragStart={e => props.onDragStartContact(e, props.node.path)}
          onClick={e => {
            if (e.ctrlKey || e.metaKey) openContactPermanent(props.node.path, props.node.name);
            else navigateToContact(props.node.path, props.node.name);
          }}
          onContextMenu={e => props.openCtxMenu(e, { kind: 'contact', path: props.node.path, display_name: props.node.name })}
        >
          <div style={{
            width: '28px', height: '28px', 'border-radius': '50%', 'flex-shrink': '0',
            background: `var(--surface0)`, border: `1px solid var(--surface1)`,
            display: 'flex', 'align-items': 'center', 'justify-content': 'center',
            'font-size': '10px', 'font-weight': '600', color: 'var(--muted)',
          }}>
            {props.node.name.split(' ').filter(w => w).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'}
          </div>
          <span class="truncate" style={{ 'font-size': '13px', color: 'var(--text)' }}>{props.node.name}</span>
        </div>
      }
    >
      <div
        class="contact-tree-folder"
        classList={{ 'drag-over': props.dragOverFolder === props.node.path }}
        style={{ 'padding-left': pad() }}
        draggable="true"
        onDragStart={e => props.onDragStartFolder(e, props.node.path)}
        onClick={() => props.toggleDir(props.node.path)}
        onContextMenu={e => props.openCtxMenu(e, { kind: 'folder', path: props.node.path })}
        onDragOver={e => props.onDragOverFolder(e, props.node.path)}
        onDragEnter={e => { e.preventDefault(); props.onDragOverFolder(e, props.node.path); }}
        onDragLeave={e => { e.preventDefault(); props.onDragLeaveFolder(); }}
        onDrop={e => props.onDropFolder(e, props.node.path)}
      >
        <span style={{ 'font-size': '9px', color: 'var(--muted)', width: '10px', 'flex-shrink': '0' }}>
          {props.collapsed.has(props.node.path) ? '▸' : '▾'}
        </span>
        <span class="truncate" style={{ 'font-size': '13px', 'font-weight': '500', color: 'var(--subtext)' }}>{props.node.name}</span>
      </div>
      <Show when={!props.collapsed.has(props.node.path)}>
        <For each={props.node.children}>{child => <ContactTreeRow node={child} depth={props.depth + 1} collapsed={props.collapsed} toggleDir={props.toggleDir} openCtxMenu={props.openCtxMenu} dragOverFolder={props.dragOverFolder} onDragStartContact={props.onDragStartContact} onDragStartFolder={props.onDragStartFolder} onDragOverFolder={props.onDragOverFolder} onDragLeaveFolder={props.onDragLeaveFolder} onDropFolder={props.onDropFolder} />}</For>
      </Show>
    </Show>
  );
}
