import { createSignal } from 'solid-js';
import type { Heading } from '../components/shared/editor/toc';

// Module identifier whose content the left drawer is showing (matches the
// sidebar icon ids: 'notes', 'contacts', …). `null` → drawer hidden.
export type ModuleId = string;

// ── Left drawer (file tree / module list) ──────────────────────────────────

const LEFT_KEY = 'ruas.layout.leftPanel';
const RIGHT_KEY = 'ruas.layout.rightVisible';

// Sentinel persisted when the user explicitly closes the drawer, so first-run
// (key absent) can default it open without re-opening after a deliberate close.
const CLOSED = 'none';

function loadLeft(): ModuleId | null {
  try {
    const v = localStorage.getItem(LEFT_KEY);
    if (v === null) return 'notes'; // first run → open the notes tree
    return v === CLOSED ? null : (v as ModuleId);
  } catch { return 'notes'; }
}
function loadRight(): boolean {
  try { return localStorage.getItem(RIGHT_KEY) !== 'false'; }
  catch { return true; }
}

const [leftPanelModule, setLeftPanelModuleRaw] = createSignal<ModuleId | null>(loadLeft());

// Last module the drawer showed, so a bare show/hide toggle can restore it.
let lastLeftModule: ModuleId = loadLeft() ?? 'notes';

function setLeftPanelModule(v: ModuleId | null) {
  if (v) lastLeftModule = v;
  setLeftPanelModuleRaw(v);
  try { localStorage.setItem(LEFT_KEY, v ?? CLOSED); } catch { /* ignore */ }
}

/** Toggle the left drawer for a module: same id closes it, a different id swaps. */
export function toggleLeftPanel(id: ModuleId) {
  setLeftPanelModule(leftPanelModule() === id ? null : id);
}

/** Show/hide the drawer without changing module (restores the last module). */
export function toggleLeftVisible() {
  setLeftPanelModule(leftPanelModule() ? null : lastLeftModule);
}

export function hideLeftPanel() {
  setLeftPanelModule(null);
}

export { leftPanelModule };

// ── Right sidebar (TOC / backlinks of the active note) ──────────────────────

const [rightVisible, setRightVisibleRaw] = createSignal<boolean>(loadRight());

export function toggleRight() {
  setRightVisibleRaw(v => {
    const next = !v;
    try { localStorage.setItem(RIGHT_KEY, String(next)); } catch { /* ignore */ }
    return next;
  });
}

export { rightVisible };

// ── Active note context (published by the focused NoteDetail) ───────────────
// Identity (path + jump handler) is kept separate from the body so the right
// panel can key on the stable identity (no remount per keystroke) while the
// body updates the TOC live. Keying avoids stale-<Show> reads when a note tab
// is closed.

export interface ActiveNote {
  path: string;
  onJump: (h: Heading) => void;
}

const [activeNote, setActiveNote] = createSignal<ActiveNote | null>(null);
const [activeNoteBody, setActiveNoteBody] = createSignal('');

export { activeNote, setActiveNote, activeNoteBody, setActiveNoteBody };

/** Clear the active note only if it still belongs to the given path (avoids
 *  races when another note has already claimed focus). */
export function clearActiveNote(path: string) {
  setActiveNote(prev => (prev && prev.path === path ? null : prev));
}

// ── Notes list invalidation ─────────────────────────────────────────────────
// Incremented by NoteDetail after every successful save so NotesList can
// refetch without polling.

const [notesVersion, setNotesVersion] = createSignal(0);

export { notesVersion };

export function invalidateNotesList() {
  setNotesVersion(v => v + 1);
}
