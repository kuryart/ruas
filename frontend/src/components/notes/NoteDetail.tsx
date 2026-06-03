import { Show, createEffect, createResource, createSignal, on, onCleanup } from 'solid-js';
import { useI18n } from '../../i18n/context';
import { invoke } from '../../utils/api';
import {
  canGoBack, canGoForward, goBack, goForward,
  promoteNotePreviewByPath, updateNoteTabTitle,
  focusedPanelId, panels,
} from '../workspace/workspaceStore';
import { pendingBlock, setPendingBlock } from '../../stores/blockTargetStore';
import { setActiveNote, setActiveNoteBody, clearActiveNote } from '../../stores/layoutStore';
import { type Heading } from './editor/toc';
import { extractBodyTags } from './editor/tags';
import ViewPane, { type ViewApi } from './ViewPane';
import EditorPane, { type EditorApi } from './EditorPane';
import FrontmatterEditor, { type Frontmatter } from './FrontmatterEditor';

// ── Types ──────────────────────────────────────────────────────────────────

type NoteFrontmatter = Frontmatter;

interface Note {
  path: string;
  frontmatter: NoteFrontmatter;
  body: string;
}

type NoteMode = 'view' | 'edit' | 'raw';
type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error';

// ── Component ──────────────────────────────────────────────────────────────

export default function NoteDetail(props: { path: string; panelId: string }) {
  const { t } = useI18n();

  const [note] = createResource(() => props.path, path =>
    invoke<Note>('read_note', { path }),
  );

  const [mode, setMode] = createSignal<NoteMode>('edit');
  const [title, setTitle] = createSignal('');
  const [body, setBody] = createSignal('');
  const [fm, setFm] = createSignal<NoteFrontmatter>({});
  const [saveStatus, setSaveStatus] = createSignal<SaveStatus>('saved');
  // The path of the note currently populated into the editors. Rendering is
  // gated on this matching props.path so stale resource data (the previous
  // note, still returned while the new path loads) can never be shown.
  const [activePath, setActivePath] = createSignal<string | null>(null);
  // Block-ref navigation target for this note, once its content is loaded.
  const [scrollBlockId, setScrollBlockId] = createSignal<string | null>(null);

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let promoted = false;
  let editorApi: EditorApi | undefined;
  let viewApi: ViewApi | undefined;

  // TOC click → scroll the active surface (editor line or rendered heading).
  function onJump(h: Heading) {
    if (mode() === 'view') viewApi?.scrollToHeading(h.slug);
    else editorApi?.scrollToLine(h.line);
  }

  // This note is the surface the global right panel should reflect when its
  // panel is focused and its tab is the active one.
  const isActiveSurface = () => {
    if (focusedPanelId() !== props.panelId) return false;
    const p = panels[props.panelId];
    const tab = p?.tabs.find(t => t.id === p.activeTabId);
    return !!tab && tab.content.type === 'note-detail' && tab.content.notePath === props.path;
  };

  // Publish (or relinquish) the active-note identity for the global RightPanel.
  // Kept stable (does not depend on body) so the panel doesn't remount on edits.
  createEffect(() => {
    if (isActiveSurface() && activePath() === props.path) {
      setActiveNote(prev => (prev && prev.path === props.path ? prev : { path: props.path, onJump }));
    } else {
      clearActiveNote(props.path); // no-op unless the active note is still ours
    }
  });

  // Keep the body in sync for the TOC while we are the active surface.
  createEffect(() => {
    if (isActiveSurface() && activePath() === props.path) setActiveNoteBody(body());
  });

  // Flush pending edits for the outgoing note *before* the new path loads.
  createEffect(on(() => props.path, (_path, prev) => {
    if (prev !== undefined && saveStatus() === 'unsaved') {
      clearTimeout(saveTimer);
      void saveNow();
    }
  }, { defer: false }));

  // Populate when the resource value actually changes — never with stale data.
  createEffect(on(note, n => {
    if (!n) return;
    setTitle(n.frontmatter.title ?? t('notes-untitled'));
    setBody(n.body);
    setFm(n.frontmatter);
    setSaveStatus('saved');
    promoted = false;
    clearTimeout(saveTimer);
    setActivePath(n.path);
  }));

  // Consume a queued block-ref target once this note is the active, loaded one.
  createEffect(() => {
    const target = pendingBlock();
    if (target && target.path === props.path && activePath() === props.path) {
      setScrollBlockId(target.blockId);
      setPendingBlock(null);
    }
  });

  onCleanup(() => {
    clearTimeout(saveTimer);
    if (saveStatus() === 'unsaved') void saveNow();
    clearActiveNote(props.path);
  });

  // ── Save ───────────────────────────────────────────────────────────────

  async function saveNow() {
    const path = activePath();
    if (!path) return;
    // Merge inline #tags from the body into frontmatter.tags (union, order-stable).
    const merged = [...new Set([...(fm().tags ?? []), ...extractBodyTags(body())])];
    const payload: Note = {
      path,
      frontmatter: {
        ...fm(),
        title: title(),
        tags: merged.length ? merged : undefined,
        modified: new Date().toISOString(),
      },
      body: body(),
    };
    setSaveStatus('saving');
    try {
      await invoke('save_note', { note: payload });
      setSaveStatus('saved');
    } catch {
      setSaveStatus('error');
    }
  }

  function scheduleSave() {
    setSaveStatus('unsaved');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 1000);
  }

  // ── Edit helpers ───────────────────────────────────────────────────────

  function promoteOnce() {
    if (!promoted) {
      promoted = true;
      promoteNotePreviewByPath(props.path);
    }
  }

  function onTitleChange(v: string) {
    promoteOnce();
    setTitle(v);
    updateNoteTabTitle(props.path, v || t('notes-untitled'));
    scheduleSave();
  }

  function onFmChange(next: Frontmatter) {
    promoteOnce();
    setFm(next);
    scheduleSave();
  }

  function onBodyChange(v: string) {
    promoteOnce();
    setBody(v);
    scheduleSave();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      clearTimeout(saveTimer);
      void saveNow();
    }
  }

  // ── Status bar ─────────────────────────────────────────────────────────

  const STATUS: Record<SaveStatus, { color: string; key: string }> = {
    saved:   { color: 'var(--green)',  key: 'notes-status-saved'   },
    unsaved: { color: 'var(--yellow)', key: 'notes-status-unsaved' },
    saving:  { color: 'var(--muted)',  key: 'notes-status-saving'  },
    error:   { color: 'var(--red)',    key: 'notes-status-error'   },
  };

  // ── Mode button ────────────────────────────────────────────────────────

  const ModeBtn = (btnProps: { m: NoteMode; labelKey: string }) => (
    <button
      class="mode-btn"
      classList={{ 'mode-active': mode() === btnProps.m }}
      onClick={() => setMode(btnProps.m)}
    >
      {t(btnProps.labelKey)}
    </button>
  );

  // ── Navigation button (back / forward) ───────────────────────────────────

  const NavBtn = (p: { label: string; titleKey: string; enabled: boolean; onClick: () => void }) => (
    <button class="nav-btn" onClick={p.onClick} disabled={!p.enabled} title={t(p.titleKey)}>
      {p.label}
    </button>
  );

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div
      class="note-detail"
      style={{ display: 'flex', 'flex-direction': 'column', height: '100%', overflow: 'hidden', background: 'var(--base)' }}
      onKeyDown={handleKeyDown}
    >
      <Show when={activePath() !== props.path}>
        <div style={{ padding: '32px', color: 'var(--muted)', 'font-size': '12px' }}>
          {t('notes-loading')}
        </div>
      </Show>

      <Show when={activePath() === props.path}>
        {/* ── Toolbar ──────────────────────────────────────────────── */}
        <div class="note-toolbar" style={{
          display: 'flex', 'align-items': 'center', gap: '8px',
          padding: '6px 14px', 'flex-shrink': '0',
          'border-bottom': '1px solid var(--surface0)',
          background: 'var(--mantle)',
        }}>
          <NavBtn label="←" titleKey="notes-nav-back" enabled={canGoBack(props.panelId)} onClick={() => goBack(props.panelId)} />
          <NavBtn label="→" titleKey="notes-nav-forward" enabled={canGoForward(props.panelId)} onClick={() => goForward(props.panelId)} />
          <input
            class="note-title-input"
            type="text"
            value={title()}
            placeholder={t('notes-untitled')}
            onInput={e => onTitleChange((e.target as HTMLInputElement).value)}
            onFocus={() => promoteOnce()}
          />

          <div style={{
            display: 'flex', gap: '2px', 'flex-shrink': '0',
            background: 'var(--surface0)', 'border-radius': '6px', padding: '2px',
          }}>
            <ModeBtn m="view" labelKey="notes-mode-view" />
            <ModeBtn m="edit" labelKey="notes-mode-edit" />
            <ModeBtn m="raw"  labelKey="notes-mode-raw"  />
          </div>
        </div>

        {/* ── Frontmatter (hidden in raw — the YAML is visible in the editor) ── */}
        <Show when={mode() !== 'raw'}>
          <FrontmatterEditor fm={fm()} onChange={onFmChange} />
        </Show>

        {/* ── Content (TOC/backlinks live in the global right panel) ──── */}
        <div style={{ flex: '1 1 0', overflow: 'hidden' }}>
          <Show when={mode() === 'view'}>
            <ViewPane body={body()} onReady={api => (viewApi = api)} />
          </Show>
          <Show when={mode() === 'edit' || mode() === 'raw'}>
            <EditorPane
              content={body()}
              mode={mode() as 'edit' | 'raw'}
              onChange={onBodyChange}
              scrollTarget={scrollBlockId()}
              onReady={api => (editorApi = api)}
            />
          </Show>
        </div>

        {/* ── Status bar ───────────────────────────────────────────── */}
        <div class="status-bar">
          <span class="status-path">{props.path.split('/').pop()}</span>
          <span class="status-label" style={{ color: STATUS[saveStatus()].color }}>
            {t(STATUS[saveStatus()].key)}
          </span>
        </div>
      </Show>
    </div>
  );
}
