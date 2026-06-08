import { createEffect, createRoot, createSignal } from 'solid-js';
import { type AccentId, FONTS, THEMES } from '../styles/themes';
import { invoke } from '../utils/api';

// Appearance is layered, applied as <style> tags in head order so the cascade
// resolves correctly: global.css → #ruas-builtin (theme/accent/font) →
// user theme → enabled snippets.
//
// - theme / accent / font are app-level (localStorage, per machine).
// - the selected *user theme* and *enabled snippets* live in the vault
//   (`.ruas/appearance.json`, via get/set_appearance_config) so they travel
//   with it. Their CSS is read (sanitized) from `.ruas/themes|snippets`.

interface AppearanceFile { name: string; path: string }

// ── App-level prefs (localStorage) ───────────────────────────────────────────

const KEY = 'ruas.appearance';
interface LocalPrefs { theme: string; accent: AccentId; font: string }
const DEFAULTS: LocalPrefs = { theme: 'mocha', accent: 'default', font: 'system' };

function loadLocal(): LocalPrefs {
  if (typeof localStorage === 'undefined') return DEFAULTS;
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<LocalPrefs>) }; }
  catch { return DEFAULTS; }
}

const initial = loadLocal();
const [theme, setTheme] = createSignal(initial.theme);
const [accent, setAccent] = createSignal<AccentId>(initial.accent);
const [font, setFont] = createSignal(initial.font);

// ── Vault-scoped: user theme + snippets ──────────────────────────────────────

const [userTheme, setUserThemeSig] = createSignal<string | null>(null);
const [enabledSnippets, setEnabledSnippetsSig] = createSignal<string[]>([]);
const [availableThemes, setAvailableThemes] = createSignal<AppearanceFile[]>([]);
const [availableSnippets, setAvailableSnippets] = createSignal<AppearanceFile[]>([]);

const cssCache = new Map<string, string>(); // "theme:name" | "snippet:name" → CSS

export {
  theme, setTheme, accent, setAccent, font, setFont,
  userTheme, enabledSnippets, availableThemes, availableSnippets,
};

// ── Injection ────────────────────────────────────────────────────────────────

function setStyle(id: string, css: string) {
  if (typeof document === 'undefined') return;
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); }
  el.textContent = css;
}

function applyBuiltin() {
  const t = THEMES.find(x => x.id === theme()) ?? THEMES[0];
  let vars = Object.entries(t.palette).map(([k, v]) => `--${k}:${v};`).join('');
  if (accent() !== 'default' && t.palette[accent()]) vars += `--accent:${t.palette[accent()]};`;
  let css = `:root{${vars}}`;
  const stack = FONTS.find(f => f.id === font())?.stack;
  if (stack) css += `html,body,#root{font-family:${stack};}`;
  setStyle('ruas-builtin', css);
}

/** Re-stack the user theme + enabled snippets (always after #ruas-builtin). */
function applyUserCss() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('style[data-ruas-css]').forEach(e => e.remove());
  const append = (name: string, css: string) => {
    const el = document.createElement('style');
    el.dataset.ruasCss = name;
    el.textContent = css;
    document.head.appendChild(el);
  };
  const ut = userTheme();
  if (ut) { const css = cssCache.get(`theme:${ut}`); if (css) append(`theme:${ut}`, css); }
  for (const s of enabledSnippets()) { const css = cssCache.get(`snippet:${s}`); if (css) append(`snippet:${s}`, css); }
}

async function fetchCss(kind: 'theme' | 'snippet', name: string, files: AppearanceFile[]) {
  const f = files.find(x => x.name === name);
  if (!f) return;
  try { cssCache.set(`${kind}:${name}`, await invoke<string>('read_appearance_css', { path: f.path })); }
  catch { /* ignore unreadable file */ }
}

async function saveConfig() {
  try { await invoke('set_appearance_config', { config: { userTheme: userTheme(), enabledSnippets: enabledSnippets() } }); }
  catch { /* no vault / write failed */ }
}

// ── Public actions ───────────────────────────────────────────────────────────

/** Load available themes/snippets and the persisted selection from the vault,
 *  then inject. Call when a vault becomes active and on "reload". */
export async function loadVaultAppearance() {
  try {
    const list = await invoke<{ themes: AppearanceFile[]; snippets: AppearanceFile[] }>('list_appearance');
    setAvailableThemes(list.themes);
    setAvailableSnippets(list.snippets);
    const config = await invoke<{ userTheme?: string | null; enabledSnippets?: string[] }>('get_appearance_config');
    setUserThemeSig(config.userTheme ?? null);
    setEnabledSnippetsSig(config.enabledSnippets ?? []);
    const ut = userTheme();
    await Promise.all([
      ...(ut ? [fetchCss('theme', ut, list.themes)] : []),
      ...enabledSnippets().map(s => fetchCss('snippet', s, list.snippets)),
    ]);
    applyUserCss();
  } catch { /* no active vault yet */ }
}

/** Re-read everything from disk (clears CSS cache) — for the "Reload" button. */
export async function reloadAppearance() {
  cssCache.clear();
  await loadVaultAppearance();
}

export async function setUserTheme(name: string | null) {
  setUserThemeSig(name);
  if (name && !cssCache.has(`theme:${name}`)) await fetchCss('theme', name, availableThemes());
  applyUserCss();
  await saveConfig();
}

export async function toggleSnippet(name: string, on: boolean) {
  setEnabledSnippetsSig(prev => (on ? [...new Set([...prev, name])] : prev.filter(s => s !== name)));
  if (on && !cssCache.has(`snippet:${name}`)) await fetchCss('snippet', name, availableSnippets());
  applyUserCss();
  await saveConfig();
}

// Apply built-in layer on import + whenever it changes (persist to localStorage).
if (typeof document !== 'undefined') {
  createRoot(() => {
    createEffect(() => {
      applyBuiltin();
      try { localStorage.setItem(KEY, JSON.stringify({ theme: theme(), accent: accent(), font: font() })); } catch { /* ignore */ }
    });
  });
}

// Hot-reload: the desktop watcher emits `appearance-changed` when a themes/
// snippets .css file changes on disk → re-read and re-inject.
if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
  import('@tauri-apps/api/event')
    .then(({ listen }) => listen('appearance-changed', () => void reloadAppearance()))
    .catch(() => { /* event API unavailable */ });
}
