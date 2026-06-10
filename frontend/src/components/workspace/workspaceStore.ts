import { batch, createSignal } from 'solid-js';
import { createStore, produce } from 'solid-js/store';

// ── Types ──────────────────────────────────────────────────────────────────

export type TabContent =
  | { type: 'contacts-list' }
  | { type: 'contact-detail'; contactPath: string }
  | { type: 'notes-list' }
  | { type: 'note-detail'; notePath: string }
  | { type: 'placeholder'; module: string }
  | { type: 'plugin'; pluginId: string; viewId: string; payload: unknown };

export interface Tab {
  id: string;
  title: string;
  content: TabContent;
  /** Preview tabs (single-click navigation) are shown in italics and get
   *  replaced by the next single-click navigation. Ctrl-click or editing
   *  promotes the tab to permanent. */
  preview?: boolean;
}

export interface Panel {
  id: string;
  tabs: Tab[];
  activeTabId: string | null;
}

export interface LeafNode {
  kind: 'leaf';
  panelId: string;
}

export interface SplitNode {
  kind: 'split';
  id: string;
  direction: 'row' | 'column';
  ratio: number;
  first: WorkspaceNode;
  second: WorkspaceNode;
}

export type WorkspaceNode = LeafNode | SplitNode;

// ── Initial state ──────────────────────────────────────────────────────────

const MAIN = 'main';

// The workspace starts empty — module browsers live in the left drawer, so the
// center shows a welcome placeholder until the user opens something.
const [panels, setPanels] = createStore<Record<string, Panel>>({
  [MAIN]: { id: MAIN, tabs: [], activeTabId: null },
});

const [tree, setTree] = createSignal<WorkspaceNode>({ kind: 'leaf', panelId: MAIN });
const [focusedPanelId, setFocusedPanelId] = createSignal<string>(MAIN);

export { panels, tree, focusedPanelId };

// ── Tree helpers ───────────────────────────────────────────────────────────

function replaceLeaf(node: WorkspaceNode, id: string, rep: WorkspaceNode): WorkspaceNode {
  if (node.kind === 'leaf') return node.panelId === id ? rep : node;
  return { ...node, first: replaceLeaf(node.first, id, rep), second: replaceLeaf(node.second, id, rep) };
}

function removeLeaf(node: WorkspaceNode, id: string): WorkspaceNode | null {
  if (node.kind === 'leaf') return node.panelId === id ? null : node;
  const first = removeLeaf(node.first, id);
  const second = removeLeaf(node.second, id);
  if (first === null) return second;
  if (second === null) return first;
  return { ...node, first, second };
}

function updateRatio(node: WorkspaceNode, splitId: string, ratio: number): WorkspaceNode {
  if (node.kind === 'leaf') return node;
  if (node.id === splitId) return { ...node, ratio };
  return { ...node, first: updateRatio(node.first, splitId, ratio), second: updateRatio(node.second, splitId, ratio) };
}

export function firstLeaf(node: WorkspaceNode): string | null {
  if (node.kind === 'leaf') return node.panelId;
  return firstLeaf(node.first);
}

export function lastLeaf(node: WorkspaceNode): string | null {
  if (node.kind === 'leaf') return node.panelId;
  return lastLeaf(node.second);
}

// ── Core tab actions ───────────────────────────────────────────────────────

export function focusPanel(id: string) {
  setFocusedPanelId(id);
}

export function setActiveTab(panelId: string, tabId: string) {
  setPanels(panelId, 'activeTabId', tabId);
}

export function openTab(panelId: string, tab: Tab) {
  setPanels(produce(d => {
    d[panelId].tabs.push(tab);
    d[panelId].activeTabId = tab.id;
  }));
}

export function closeTab(panelId: string, tabId: string) {
  const p = panels[panelId];
  if (!p) return;
  const idx = p.tabs.findIndex(t => t.id === tabId);
  if (idx === -1) return;

  if (p.tabs.length > 1) {
    // Other tabs remain — simple splice, no unmounting.
    setPanels(produce(d => {
      d[panelId].tabs.splice(idx, 1);
      if (d[panelId].activeTabId === tabId)
        d[panelId].activeTabId = d[panelId].tabs[Math.max(0, idx - 1)].id;
    }));
    return;
  }

  // Last tab removed.
  const next = removeLeaf(tree(), panelId);
  if (next !== null) {
    // Remove panel from tree. PanelView unmounts from its current valid state
    // (still has 1 tab), avoiding any stale-accessor issues in <Show>.
    batch(() => {
      setTree(next);
      const leaf = firstLeaf(next);
      if (leaf) setFocusedPanelId(leaf);
    });
  } else {
    // Last panel in workspace — replace the tab with a placeholder atomically.
    const placeholder: Tab = {
      id: crypto.randomUUID(),
      title: 'Nova aba',
      content: { type: 'placeholder', module: '' },
      preview: false,
    };
    setPanels(produce(d => {
      d[panelId].tabs.splice(idx, 1);
      d[panelId].tabs.push(placeholder);
      d[panelId].activeTabId = placeholder.id;
    }));
  }
}

export function splitPanel(panelId: string, direction: 'row' | 'column') {
  const newId = crypto.randomUUID();
  setPanels(produce(d => { d[newId] = { id: newId, tabs: [], activeTabId: null }; }));
  setTree(replaceLeaf(tree(), panelId, {
    kind: 'split', id: crypto.randomUUID(), direction, ratio: 0.5,
    first: { kind: 'leaf', panelId },
    second: { kind: 'leaf', panelId: newId },
  }));
  setFocusedPanelId(newId);
}

export function updateSplitRatio(splitId: string, ratio: number) {
  setTree(updateRatio(tree(), splitId, ratio));
}

// ── Contact navigation ─────────────────────────────────────────────────────

/**
 * Single-click: navigate to contact using a preview tab.
 * Only one preview tab exists per panel at a time; it gets replaced on each
 * subsequent single-click navigation.
 */
export function navigateToContact(path: string, displayName: string) {
  const pid = focusedPanelId();
  const panel = panels[pid];
  if (!panel) return;

  // If already open as permanent tab, just switch to it
  const permanent = panel.tabs.find(
    t => !t.preview && t.content.type === 'contact-detail' &&
         (t.content as { contactPath: string }).contactPath === path,
  );
  if (permanent) { setActiveTab(pid, permanent.id); return; }

  // Find existing preview tab and replace its content
  const previewIdx = panel.tabs.findIndex(t => t.preview === true);
  if (previewIdx !== -1) {
    setPanels(produce(d => {
      const p = d[pid];
      p.tabs[previewIdx] = { id: p.tabs[previewIdx].id, title: displayName, content: { type: 'contact-detail', contactPath: path }, preview: true };
      p.activeTabId = p.tabs[previewIdx].id;
    }));
  } else {
    openTab(pid, { id: crypto.randomUUID(), title: displayName, content: { type: 'contact-detail', contactPath: path }, preview: true });
  }
}

/**
 * Ctrl-click: always open a new permanent tab (or focus existing one).
 */
export function openContactPermanent(path: string, displayName: string) {
  const pid = focusedPanelId();
  const panel = panels[pid];
  if (!panel) return;

  // Already open? promote preview → permanent and switch
  const existing = panel.tabs.find(
    t => t.content.type === 'contact-detail' &&
         (t.content as { contactPath: string }).contactPath === path,
  );
  if (existing) {
    if (existing.preview) {
      const idx = panel.tabs.findIndex(t => t.id === existing.id);
      if (idx !== -1) setPanels(pid, 'tabs', idx, 'preview', false);
    }
    setActiveTab(pid, existing.id);
    return;
  }

  openTab(pid, { id: crypto.randomUUID(), title: displayName, content: { type: 'contact-detail', contactPath: path }, preview: false });
}

/**
 * Called when the user starts editing a contact — promotes its preview tab
 * to permanent so navigation won't replace it.
 */
export function promotePreviewByPath(contactPath: string) {
  for (const [pid, panel] of Object.entries(panels)) {
    const idx = panel.tabs.findIndex(
      t => t.preview === true && t.content.type === 'contact-detail' &&
           (t.content as { contactPath: string }).contactPath === contactPath,
    );
    if (idx !== -1) {
      setPanels(pid, 'tabs', idx, 'preview', false);
      break;
    }
  }
}

/**
 * Sync tab title when the contact's name changes.
 */
export function updateTabTitle(contactPath: string, title: string) {
  for (const [pid, panel] of Object.entries(panels)) {
    const idx = panel.tabs.findIndex(
      t => t.content.type === 'contact-detail' &&
           (t.content as { contactPath: string }).contactPath === contactPath,
    );
    if (idx !== -1) {
      setPanels(pid, 'tabs', idx, 'title', title);
    }
  }
}

// ── Module openers ─────────────────────────────────────────────────────────

export function openContactsList(panelId?: string) {
  const pid = panelId ?? focusedPanelId();
  const existing = panels[pid]?.tabs.find(t => t.content.type === 'contacts-list');
  if (existing) { setActiveTab(pid, existing.id); return; }
  openTab(pid, { id: crypto.randomUUID(), title: 'Contatos', content: { type: 'contacts-list' }, preview: false });
}

export function openModule(module: string, label: string) {
  const pid = focusedPanelId();
  const existing = panels[pid]?.tabs.find(
    t => t.content.type === 'placeholder' && (t.content as { module: string }).module === module,
  );
  if (existing) { setActiveTab(pid, existing.id); return; }
  openTab(pid, { id: crypto.randomUUID(), title: label, content: { type: 'placeholder', module }, preview: false });
}

// ── Per-panel navigation history (back/forward) ─────────────────────────────

interface NavEntry { path: string; title: string }
const [navStacks, setNavStacks] = createStore<Record<string, { entries: NavEntry[]; index: number }>>({});
// Set while goBack/goForward drive navigation, so those moves aren't re-recorded.
let suppressNav = false;

function recordNav(panelId: string, path: string, title: string) {
  if (suppressNav) return;
  setNavStacks(produce(d => {
    const s = d[panelId] ?? { entries: [], index: -1 };
    if (s.entries[s.index]?.path === path) return;       // already current
    const entries = s.entries.slice(0, s.index + 1);     // drop forward history
    entries.push({ path, title });
    d[panelId] = { entries, index: entries.length - 1 };
  }));
}

export const canGoBack = (panelId: string) => (navStacks[panelId]?.index ?? 0) > 0;
export const canGoForward = (panelId: string) => {
  const s = navStacks[panelId];
  return !!s && s.index < s.entries.length - 1;
};

export function goBack(panelId: string) {
  const s = navStacks[panelId];
  if (!s || s.index <= 0) return;
  const entry = s.entries[s.index - 1];
  setNavStacks(panelId, 'index', s.index - 1);
  suppressNav = true;
  navigateToNote(entry.path, entry.title, panelId);
  suppressNav = false;
}

export function goForward(panelId: string) {
  const s = navStacks[panelId];
  if (!s || s.index >= s.entries.length - 1) return;
  const entry = s.entries[s.index + 1];
  setNavStacks(panelId, 'index', s.index + 1);
  suppressNav = true;
  navigateToNote(entry.path, entry.title, panelId);
  suppressNav = false;
}

// ── Note navigation ────────────────────────────────────────────────────────

export function navigateToNote(path: string, title: string, panelId?: string) {
  const pid = panelId ?? focusedPanelId();
  const panel = panels[pid];
  if (!panel) return;
  recordNav(pid, path, title);

  const permanent = panel.tabs.find(
    t => !t.preview && t.content.type === 'note-detail' &&
         (t.content as { notePath: string }).notePath === path,
  );
  if (permanent) { setActiveTab(pid, permanent.id); return; }

  const previewIdx = panel.tabs.findIndex(t => t.preview === true);
  if (previewIdx !== -1) {
    setPanels(produce(d => {
      const p = d[pid];
      p.tabs[previewIdx] = { id: p.tabs[previewIdx].id, title, content: { type: 'note-detail', notePath: path }, preview: true };
      p.activeTabId = p.tabs[previewIdx].id;
    }));
  } else {
    openTab(pid, { id: crypto.randomUUID(), title, content: { type: 'note-detail', notePath: path }, preview: true });
  }
}

export function openNotePermanent(path: string, title: string) {
  const pid = focusedPanelId();
  const panel = panels[pid];
  if (!panel) return;
  recordNav(pid, path, title);

  const existing = panel.tabs.find(
    t => t.content.type === 'note-detail' &&
         (t.content as { notePath: string }).notePath === path,
  );
  if (existing) {
    if (existing.preview) {
      const idx = panel.tabs.findIndex(t => t.id === existing.id);
      if (idx !== -1) setPanels(pid, 'tabs', idx, 'preview', false);
    }
    setActiveTab(pid, existing.id);
    return;
  }

  openTab(pid, { id: crypto.randomUUID(), title, content: { type: 'note-detail', notePath: path }, preview: false });
}

export function openNotesList(panelId?: string) {
  const pid = panelId ?? focusedPanelId();
  const existing = panels[pid]?.tabs.find(t => t.content.type === 'notes-list');
  if (existing) { setActiveTab(pid, existing.id); return; }
  openTab(pid, { id: crypto.randomUUID(), title: 'Notes', content: { type: 'notes-list' }, preview: false });
}

export function promoteNotePreviewByPath(notePath: string) {
  for (const [pid, panel] of Object.entries(panels)) {
    const idx = panel.tabs.findIndex(
      t => t.preview === true && t.content.type === 'note-detail' &&
           (t.content as { notePath: string }).notePath === notePath,
    );
    if (idx !== -1) {
      setPanels(pid, 'tabs', idx, 'preview', false);
      break;
    }
  }
}

// ── Plugin navigation ──────────────────────────────────────────────────────

export function openPluginView(pluginId: string, viewId: string, title: string, payload: unknown = null) {
  const pid = focusedPanelId();
  if (!panels[pid]) return;
  openTab(pid, {
    id: crypto.randomUUID(),
    title,
    content: { type: 'plugin', pluginId, viewId, payload },
    preview: false,
  });
}

export function updateNoteTabTitle(notePath: string, title: string) {
  for (const [pid, panel] of Object.entries(panels)) {
    const idx = panel.tabs.findIndex(
      t => t.content.type === 'note-detail' &&
           (t.content as { notePath: string }).notePath === notePath,
    );
    if (idx !== -1) {
      setPanels(pid, 'tabs', idx, 'title', title);
    }
  }
}

/** Update the notePath in all tabs that reference oldPath (called after a rename-on-save). */
export function updateNoteTabPath(oldPath: string, newPath: string) {
  for (const [pid, panel] of Object.entries(panels)) {
    const idx = panel.tabs.findIndex(
      t => t.content.type === 'note-detail' &&
           (t.content as { notePath: string }).notePath === oldPath,
    );
    if (idx !== -1) {
      setPanels(pid, 'tabs', idx, 'content', { type: 'note-detail', notePath: newPath });
    }
  }
}

/** Update the contactPath in all tabs that reference oldPath (called after a rename-on-save). */
export function updateContactTabPath(oldPath: string, newPath: string) {
  for (const [pid, panel] of Object.entries(panels)) {
    const idx = panel.tabs.findIndex(
      t => t.content.type === 'contact-detail' &&
           (t.content as { contactPath: string }).contactPath === oldPath,
    );
    if (idx !== -1) {
      setPanels(pid, 'tabs', idx, 'content', { type: 'contact-detail', contactPath: newPath });
    }
  }
}
