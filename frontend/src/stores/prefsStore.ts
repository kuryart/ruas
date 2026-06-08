import { createSignal } from 'solid-js';

// User editor preferences, persisted to localStorage.

const PREFS_KEY = 'ruas.editor.prefs';

interface EditorPrefs {
  vimMode: boolean;
}

function load(): EditorPrefs {
  const defaults: EditorPrefs = { vimMode: false };
  try {
    return { ...defaults, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<EditorPrefs>) };
  } catch {
    return defaults;
  }
}

const initial = load();
const [vimMode, setVimModeSignal] = createSignal(initial.vimMode);

export { vimMode };

export function setVimMode(value: boolean) {
  setVimModeSignal(value);
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ vimMode: value }));
  } catch { /* ignore quota/availability errors */ }
}
