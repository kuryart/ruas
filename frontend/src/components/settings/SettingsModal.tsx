import { Show, createSignal, onCleanup, onMount } from 'solid-js';
import { type Locale, useI18n } from '../../i18n/context';
import { For } from 'solid-js';
import { setSettingsOpen } from '../../stores/settingsStore';
import { setVimMode, vimMode } from '../../stores/prefsStore';
import {
  accent, availableSnippets, availableThemes, enabledSnippets, font,
  reloadAppearance, setAccent, setFont, setTheme, setUserTheme, theme, toggleSnippet, userTheme,
} from '../../stores/appearanceStore';
import { type AccentId, ACCENTS, FONTS, THEMES } from '../../styles/themes';
import { invoke } from '../../utils/api';

// ── Category types ─────────────────────────────────────────────────────────

type Category = 'general' | 'appearance' | 'editor';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ── Appearance settings panel ────────────────────────────────────────────────

function AppearancePanel() {
  const { t } = useI18n();

  const Field = (p: { label: string; desc: string; children: any }) => (
    <div style={{ 'margin-bottom': '24px' }}>
      <label style={{ display: 'block', 'font-size': '13px', 'font-weight': '500', color: 'var(--text)', 'margin-bottom': '8px' }}>
        {p.label}
      </label>
      {p.children}
      <p style={{ 'margin-top': '6px', 'font-size': '12px', color: 'var(--muted)', 'line-height': '1.5' }}>{p.desc}</p>
    </div>
  );

  return (
    <div>
      <h2 class="settings-heading">{t('settings-category-appearance')}</h2>

      <Field label={t('settings-appearance-theme')} desc={t('settings-appearance-theme-desc')}>
        <select
          class="settings-select"
          value={userTheme() ? `user:${userTheme()}` : `builtin:${theme()}`}
          onChange={e => {
            const v = e.currentTarget.value;
            if (v.startsWith('user:')) void setUserTheme(v.slice(5));
            else { void setUserTheme(null); setTheme(v.slice(8)); }
          }}
        >
          <optgroup label={t('settings-appearance-theme-builtin')}>
            <For each={THEMES}>{th => <option value={`builtin:${th.id}`}>{th.name}</option>}</For>
          </optgroup>
          <Show when={availableThemes().length}>
            <optgroup label={t('settings-appearance-theme-user')}>
              <For each={availableThemes()}>{f => <option value={`user:${f.name}`}>{f.name}</option>}</For>
            </optgroup>
          </Show>
        </select>
      </Field>

      <Field label={t('settings-appearance-accent')} desc={t('settings-appearance-accent-desc')}>
        <select value={accent()} onChange={e => setAccent(e.currentTarget.value as AccentId)} class="settings-select">
          <For each={ACCENTS}>{a => <option value={a}>{a === 'default' ? t('settings-appearance-accent-default') : cap(a)}</option>}</For>
        </select>
      </Field>

      <Field label={t('settings-appearance-font')} desc={t('settings-appearance-font-desc')}>
        <select value={font()} onChange={e => setFont(e.currentTarget.value)} class="settings-select">
          <For each={FONTS}>{f => <option value={f.id}>{f.label}</option>}</For>
        </select>
      </Field>

      <Field label={t('settings-appearance-snippets')} desc={t('settings-appearance-snippets-desc')}>
        <Show
          when={availableSnippets().length}
          fallback={<p style={{ 'font-size': '12px', color: 'var(--muted)' }}>{t('settings-appearance-snippets-empty')}</p>}
        >
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
            <For each={availableSnippets()}>
              {s => (
                <label style={{ display: 'flex', 'align-items': 'center', gap: '8px', cursor: 'pointer', 'font-size': '13px', color: 'var(--text)' }}>
                  <input
                    type="checkbox"
                    checked={enabledSnippets().includes(s.name)}
                    onChange={e => void toggleSnippet(s.name, (e.currentTarget as HTMLInputElement).checked)}
                    style={{ 'accent-color': 'var(--accent)', cursor: 'pointer' }}
                  />
                  {s.name}
                </label>
              )}
            </For>
          </div>
        </Show>
        <div style={{ display: 'flex', gap: '8px', 'margin-top': '10px' }}>
          <button class="fm-add-btn" onClick={() => void invoke('open_appearance_folder', { kind: 'snippets' })}>
            {t('settings-appearance-open-folder')}
          </button>
          <button class="fm-add-btn" onClick={() => void reloadAppearance()}>
            {t('settings-appearance-reload')}
          </button>
        </div>
      </Field>
    </div>
  );
}

// ── Editor settings panel ───────────────────────────────────────────────────

function EditorPanel() {
  const { t } = useI18n();
  return (
    <div>
      <h2 class="settings-heading">{t('settings-category-editor')}</h2>

      {/* Vim mode toggle */}
      <label style={{ display: 'flex', 'align-items': 'flex-start', gap: '12px', cursor: 'pointer', 'margin-bottom': '24px' }}>
        <input
          type="checkbox"
          checked={vimMode()}
          onChange={e => setVimMode((e.currentTarget as HTMLInputElement).checked)}
          style={{ 'margin-top': '2px', width: '16px', height: '16px', 'accent-color': 'var(--accent)', cursor: 'pointer' }}
        />
        <span>
          <span style={{ display: 'block', 'font-size': '13px', 'font-weight': '500', color: 'var(--text)' }}>
            {t('settings-editor-vim')}
          </span>
          <span style={{ display: 'block', 'margin-top': '4px', 'font-size': '12px', color: 'var(--muted)', 'line-height': '1.5' }}>
            {t('settings-editor-vim-desc')}
          </span>
        </span>
      </label>
    </div>
  );
}

// ── General settings panel ─────────────────────────────────────────────────

function GeneralPanel() {
  const { t, locale, setLocale } = useI18n();

  return (
    <div>
      <h2 class="settings-heading">{t('settings-category-general')}</h2>

      {/* ── Language ──────────────────────────────────────────────────── */}
      <div style={{ 'margin-bottom': '24px' }}>
        <label style={{
          display: 'block', 'font-size': '13px', 'font-weight': '500',
          color: 'var(--text)', 'margin-bottom': '8px',
        }}>
          {t('settings-general-language')}
        </label>

        <select
          class="settings-select"
          value={locale()}
          onChange={e => setLocale(e.currentTarget.value as Locale)}
        >
          <option value="pt-BR">{t('settings-general-language-pt')}</option>
          <option value="en-US">{t('settings-general-language-en')}</option>
        </select>

        <p style={{
          'margin-top': '6px', 'font-size': '12px',
          color: 'var(--muted)', 'line-height': '1.5',
        }}>
          {t('settings-general-language-desc')}
        </p>
      </div>
    </div>
  );
}

// ── Modal ──────────────────────────────────────────────────────────────────

export default function SettingsModal() {
  const { t } = useI18n();
  const [category, setCategory] = createSignal<Category>('general');

  // Close on Escape
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') setSettingsOpen(false);
  }
  onMount(() => document.addEventListener('keydown', handleKeyDown));
  onCleanup(() => document.removeEventListener('keydown', handleKeyDown));

  return (
    <div class="settings-backdrop" onClick={() => setSettingsOpen(false)}>
      <div class="settings-dialog" onClick={e => e.stopPropagation()}>

        {/* ── Header ────────────────────────────────────────────────── */}
        <div class="settings-header">
          <span class="settings-title">{t('settings-title')}</span>
          <button class="settings-close" onClick={() => setSettingsOpen(false)}>✕</button>
        </div>

        {/* ── Body ──────────────────────────────────────────────────── */}
        <div class="settings-body">

          {/* Left panel — categories */}
          <div class="settings-categories">
            <button
              class="settings-cat"
              classList={{ active: category() === 'general' }}
              onClick={() => setCategory('general')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
              {t('settings-category-general')}
            </button>

            <button
              class="settings-cat"
              classList={{ active: category() === 'appearance' }}
              onClick={() => setCategory('appearance')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.504 5.555-5.555C21.965 6.012 17.461 2 12 2z"/>
              </svg>
              {t('settings-category-appearance')}
            </button>

            <button
              class="settings-cat"
              classList={{ active: category() === 'editor' }}
              onClick={() => setCategory('editor')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>
              </svg>
              {t('settings-category-editor')}
            </button>
          </div>

          {/* Right panel — content */}
          <div class="settings-content">
            <Show when={category() === 'general'}>
              <GeneralPanel />
            </Show>
            <Show when={category() === 'appearance'}>
              <AppearancePanel />
            </Show>
            <Show when={category() === 'editor'}>
              <EditorPanel />
            </Show>
          </div>

        </div>
      </div>
    </div>
  );
}
