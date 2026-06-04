import { Show, createEffect, createResource, createSignal, on, onCleanup } from 'solid-js';
import { useI18n } from '../../i18n/context';
import { invoke } from '../../utils/api';
import { buildDocument, loadYaml, splitFrontmatter } from '../../utils/frontmatter';
import {
  canGoBack, canGoForward, goBack, goForward,
  promoteNotePreviewByPath, updateNoteTabTitle,
  focusedPanelId, panels,
} from '../workspace/workspaceStore';
import { pendingBlock, setPendingBlock } from '../../stores/blockTargetStore';
import { setActiveNote, setActiveNoteBody, clearActiveNote } from '../../stores/layoutStore';
import { type Heading } from '../shared/editor/toc';
import { extractBodyTags } from '../shared/editor/tags';
import ViewPane, { type ViewApi } from '../shared/ViewPane';
import EditorPane, { type EditorApi } from '../shared/EditorPane';
import FrontmatterEditor, { type Frontmatter } from './FrontmatterEditor';
import { markdownLivePreview } from './livePreview';
import { wikiLinks, openNoteByTitle } from './editor/wikiLink';
import { blockRef } from './editor/blockRef';
import { fillNoteEmbed } from './editor/embedRenderer';

// Notes-specific editor extensions — created once (stateless CM6 configuration).
const notesExtensions = [markdownLivePreview, wikiLinks(), blockRef()];

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
  const [activePath, setActivePath] = createSignal<string | null>(null);
  const [scrollBlockId, setScrollBlockId] = createSignal<string | null>(null);
  // Full document buffer used only while mode === 'raw'.
  const [rawDoc, setRawDoc] = createSignal('');

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let promoted = false;
  let editorApi: EditorApi | undefined;
  let viewApi: ViewApi | undefined;

  // TOC click → scroll the active surface (editor line or rendered heading).
  function onJump(h: Heading) {
    if (mode() === 'view') viewApi?.scrollToHeading(h.slug);
    else editorApi?.scrollToLine(h.line);
  }

  const isActiveSurface = () => {
    if (focusedPanelId() !== props.panelId) return false;
    const p = panels[props.panelId];
    const tab = p?.tabs.find(t => t.id === p.activeTabId);
    return !!tab && tab.content.type === 'note-detail' && tab.content.notePath === props.path;
  };

  createEffect(() => {
    if (isActiveSurface() && activePath() === props.path) {
      setActiveNote(prev => (prev && prev.path === props.path ? prev : { path: props.path, onJump }));
    } else {
      clearActiveNote(props.path);
    }
  });

  createEffect(() => {
    if (isActiveSurface() && activePath() === props.path) setActiveNoteBody(body());
  });

  createEffect(on(() => props.path, (_path, prev) => {
    if (prev !== undefined && saveStatus() === 'unsaved') {
      clearTimeout(saveTimer);
      void saveNow();
    }
  }, { defer: false }));

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

  // ── Raw mode helpers ───────────────────────────────────────────────────

  /** Parse the current rawDoc into {fm, body}, falling back to previous values
   *  when the YAML is missing or invalid. */
  function parseRaw(): { fm: NoteFrontmatter; body: string } {
    const raw = rawDoc();
    const split = splitFrontmatter(raw);
    if (!split) return { fm: fm(), body: raw };

    const parsed = loadYaml(split.fmYaml);
    if (!parsed) return { fm: fm(), body: split.body };

    const prev = fm();
    return {
      fm: {
        ...parsed,
        // These fields must never be silently removed.
        uid:     (parsed.uid     as string | undefined) ?? prev.uid,
        created: (parsed.created as string | undefined) ?? prev.created,
      } as NoteFrontmatter,
      body: split.body,
    };
  }

  /** Transition between modes, building/parsing the raw document as needed. */
  function changeMode(next: NoteMode) {
    const cur = mode();
    if (cur === next) return;

    if (next === 'raw') {
      // Entering raw: serialise current fm + body into a full document.
      setRawDoc(buildDocument(fm() as Record<string, unknown>, body()));
    }

    if (cur === 'raw') {
      // Exiting raw: apply parsed changes back to fm + body.
      const { fm: newFm, body: newBody } = parseRaw();
      setFm(newFm);
      setBody(newBody);
      const newTitle = (newFm.title as string | undefined) ?? '';
      if (newTitle !== title()) {
        setTitle(newTitle || t('notes-untitled'));
        updateNoteTabTitle(props.path, newTitle || t('notes-untitled'));
      }
    }

    setMode(next);
  }

  // ── Save ───────────────────────────────────────────────────────────────

  async function saveNow() {
    const path = activePath();
    if (!path) return;

    let currentFm = fm();
    let currentBody = body();

    if (mode() === 'raw') {
      const parsed = parseRaw();
      currentFm = parsed.fm;
      currentBody = parsed.body;
      setFm(currentFm);
      setBody(currentBody);
    }

    const merged = [...new Set([...(currentFm.tags ?? []), ...extractBodyTags(currentBody)])];
    const payload: Note = {
      path,
      frontmatter: {
        ...currentFm,
        title: title(),
        tags: merged.length ? merged : undefined,
        modified: new Date().toISOString(),
      },
      body: currentBody,
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
    if (!promoted) { promoted = true; promoteNotePreviewByPath(props.path); }
  }

  function onTitleChange(v: string) {
    promoteOnce(); setTitle(v);
    updateNoteTabTitle(props.path, v || t('notes-untitled'));
    scheduleSave();
  }

  function onFmChange(next: Frontmatter) {
    promoteOnce(); setFm(next); scheduleSave();
  }

  function onBodyChange(v: string) {
    promoteOnce(); setBody(v); scheduleSave();
  }

  function onRawDocChange(v: string) {
    promoteOnce();
    setRawDoc(v);
    // No auto-save timer in raw mode — Ctrl+S or mode-switch triggers the save.
    setSaveStatus('unsaved');
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

  const ModeBtn = (btnProps: { m: NoteMode; labelKey: string }) => (
    <button
      class="mode-btn"
      classList={{ 'mode-active': mode() === btnProps.m }}
      onClick={() => changeMode(btnProps.m)}
    >
      {t(btnProps.labelKey)}
    </button>
  );

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
          <NavBtn label="←" titleKey="notes-nav-back"    enabled={canGoBack(props.panelId)}    onClick={() => goBack(props.panelId)}    />
          <NavBtn label="→" titleKey="notes-nav-forward" enabled={canGoForward(props.panelId)} onClick={() => goForward(props.panelId)} />
          <input
            class="note-title-input"
            type="text"
            value={title()}
            placeholder={t('notes-untitled')}
            onInput={e => onTitleChange((e.target as HTMLInputElement).value)}
            onFocus={() => promoteOnce()}
          />
          <div style={{ display: 'flex', gap: '2px', 'flex-shrink': '0', background: 'var(--surface0)', 'border-radius': '6px', padding: '2px' }}>
            <ModeBtn m="view" labelKey="notes-mode-view" />
            <ModeBtn m="edit" labelKey="notes-mode-edit" />
            <ModeBtn m="raw"  labelKey="notes-mode-raw"  />
          </div>
        </div>

        {/* ── Frontmatter editor (hidden in raw — YAML is in the editor) ── */}
        <Show when={mode() !== 'raw'}>
          <FrontmatterEditor fm={fm()} onChange={onFmChange} />
        </Show>

        {/* ── Content ──────────────────────────────────────────────── */}
        <div style={{ flex: '1 1 0', overflow: 'hidden' }}>
          <Show when={mode() === 'view'}>
            <ViewPane
              body={body()}
              onReady={api => (viewApi = api)}
              onWikiLinkClick={openNoteByTitle}
              resolveEmbed={fillNoteEmbed}
            />
          </Show>
          <Show when={mode() === 'edit'}>
            <EditorPane
              content={body()}
              mode="edit"
              onChange={onBodyChange}
              scrollTarget={scrollBlockId()}
              onReady={api => (editorApi = api)}
              extraExtensions={notesExtensions}
            />
          </Show>
          <Show when={mode() === 'raw'}>
            <EditorPane
              content={rawDoc()}
              mode="raw"
              onChange={onRawDocChange}
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
