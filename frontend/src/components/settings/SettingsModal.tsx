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
import {
	type PluginEntry, plugins, refreshPlugins,
	enablePlugin, disablePlugin, uninstallPlugin,
	capabilityLabel,
} from '../../stores/pluginsStore';
import { requestPluginPermissions } from './PermissionDialog';

// ── Category types ─────────────────────────────────────────────────────────

type Category = 'general' | 'appearance' | 'editor' | 'plugins';
type PluginTab = 'native' | 'community';

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

// ── Plugins settings panel ──────────────────────────────────────────────────

function PluginsPanel() {
	const { t } = useI18n();
	const [tab, setTab] = createSignal<PluginTab>('native');
	const [search, setSearch] = createSignal('');
	const [communityEnabled, setCommunityEnabled] = createSignal(false);
	const [autoUpdate, setAutoUpdate] = createSignal(false);

	const filtered = () => {
		const q = search().toLowerCase();
		return (plugins() ?? []).filter(
			p => (tab() === 'native'
				? (p.trust === 'core' || p.trust === 'native')
				: p.trust === 'plugin') &&
				(!q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)),
		);
	};

	const corePlugins = () => filtered().filter(p => p.trust === 'core');
	const nativePlugins = () => filtered().filter(p => p.trust === 'native');
	const communityPlugins = () => filtered().filter(p => p.trust === 'plugin');

	return (
		<div>
			<h2 class="settings-heading">{t('settings-category-plugins')}</h2>

			{/* ── Sub-tabs ────────────────────────────────────────────────── */}
			<div style={{
				display: 'flex', gap: '2px', 'margin-bottom': '20px',
				background: 'var(--surface0)', 'border-radius': '6px', padding: '2px',
				width: 'fit-content',
			}}>
				<button class="settings-plugin-tab" classList={{ active: tab() === 'native' }} onClick={() => setTab('native')}>
					{t('settings-plugins-native')}
				</button>
				<button class="settings-plugin-tab" classList={{ active: tab() === 'community' }} onClick={() => setTab('community')}>
					{t('settings-plugins-community')}
				</button>
			</div>

			{/* ═══ Community controls ═══ */}
			<Show when={tab() === 'community'}>
				<div style={{
					display: 'flex', 'align-items': 'center', gap: '10px',
					'margin-bottom': '14px', 'flex-wrap': 'wrap',
				}}>
					<label style={{ display: 'flex', 'align-items': 'center', gap: '8px', cursor: 'pointer', 'font-size': '13px', color: 'var(--text)' }}>
						<input type="checkbox" checked={communityEnabled()} onChange={e => setCommunityEnabled((e.currentTarget as HTMLInputElement).checked)}
							style={{ width: '16px', height: '16px', 'accent-color': 'var(--accent)', cursor: 'pointer' }} />
						{t('settings-plugins-community-enabled')}
					</label>
					<button class="fm-add-btn" onClick={() => { /* Phase D: marketplace */ }}>
						{t('settings-plugins-community-browse')}
					</button>
					<button class="fm-add-btn" onClick={() => refreshPlugins()}>
						{t('settings-plugins-community-refresh')}
					</button>
					<label style={{ display: 'flex', 'align-items': 'center', gap: '8px', cursor: 'pointer', 'font-size': '13px', color: 'var(--text)', 'margin-left': 'auto' }}>
						<input type="checkbox" checked={autoUpdate()} onChange={e => setAutoUpdate((e.currentTarget as HTMLInputElement).checked)}
							style={{ width: '16px', height: '16px', 'accent-color': 'var(--accent)', cursor: 'pointer' }} />
						{t('settings-plugins-community-auto-update')}
					</label>
				</div>
			</Show>

			{/* Search */}
			<div class="list-search" style={{ 'margin-bottom': '12px' }}>
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2.5">
					<circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
				</svg>
				<input type="text" placeholder={t('settings-plugins-search')} value={search()} onInput={e => setSearch((e.target as HTMLInputElement).value)} />
				<Show when={search()}>
					<button onClick={() => setSearch('')} style={{ color: 'var(--muted)', 'font-size': '12px' }}>✕</button>
				</Show>
			</div>

			{/* Plugin list */}
			<Show when={filtered().length}
				fallback={
					<div style={{ padding: '32px 0', 'text-align': 'center', color: 'var(--muted)', 'font-size': '12px', border: '1px dashed var(--surface1)', 'border-radius': '8px' }}>
						{t('settings-plugins-empty')}
					</div>
				}
			>
				{/* ═══ Core modules (no disable option) ═══ */}
				<Show when={corePlugins().length > 0 && tab() === 'native'}>
					<div class="fm-section-label" style={{ 'margin-bottom': '8px' }}>Core modules</div>
					<div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px', 'margin-bottom': '16px' }}>
						<For each={corePlugins()}>
							{plugin => <PluginCard plugin={plugin} />}
						</For>
					</div>
				</Show>

				{/* ═══ Native plugins (can be disabled) ═══ */}
				<Show when={nativePlugins().length > 0 && tab() === 'native'}>
					<div class="fm-section-label" style={{ 'margin-bottom': '8px' }}>Native plugins</div>
					<div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px', 'margin-bottom': '16px' }}>
						<For each={nativePlugins()}>
							{plugin => <PluginCard plugin={plugin} />}
						</For>
					</div>
				</Show>

				{/* ═══ Community plugins ═══ */}
				<Show when={communityPlugins().length > 0}>
					<div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
						<For each={communityPlugins()}>
							{plugin => <PluginCard plugin={plugin} />}
						</For>
					</div>
				</Show>
			</Show>
		</div>
	);
}

// ── Plugin card ─────────────────────────────────────────────────────────────

function PluginCard(props: { plugin: PluginEntry }) {
	const { t } = useI18n();
	const p = () => props.plugin;
	const [collapsed, setCollapsed] = createSignal(true);

	const enabled = () => p().enabled;

	async function toggle() {
		if (p().trust === 'core') return; // core modules are always enabled
		if (enabled()) {
			void disablePlugin(p().id);
		} else {
			// Native plugins: capabilities are pre-approved, no permission dialog needed.
			// Community plugins: show permission dialog if unapproved capabilities exist.
			const unapproved = p().capabilities.filter(c => !p().approved.includes(c));
			if (p().trust === 'plugin' && unapproved.length > 0) {
				try {
					await requestPluginPermissions(p());
					void enablePlugin(p().id);
				} catch {
					// User rejected — do nothing
				}
			} else {
				void enablePlugin(p().id);
			}
		}
	}

	return (
		<div style={{
			background: 'var(--mantle)', border: '1px solid var(--surface0)',
			'border-radius': '8px', padding: '14px 16px',
			display: 'flex', 'flex-direction': 'column', gap: '8px',
		}}>
			{/* Header row */}
			<div style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
				<div style={{ flex: '1', 'min-width': '0' }}>
					<div style={{ display: 'flex', 'align-items': 'baseline', gap: '8px' }}>
						<span style={{ 'font-size': '13px', 'font-weight': '600', color: 'var(--text)' }}>{p().name}</span>
						<span style={{ 'font-size': '11px', color: 'var(--muted)', 'font-family': 'var(--font-mono)' }}>v{p().version}</span>
						<span style={{ 'font-size': '10px', padding: '1px 6px', 'border-radius': '8px', background: 'var(--surface0)', color: 'var(--muted)', 'text-transform': 'uppercase' }}>
							{p().trust}
						</span>
						<Show when={p().kind === 'tool'}>
							<span style={{ 'font-size': '10px', padding: '1px 6px', 'border-radius': '8px', background: 'color-mix(in srgb, var(--teal) 15%, transparent)', color: 'var(--teal)', 'text-transform': 'uppercase' }}>
								tool
							</span>
						</Show>
					</div>
					<p style={{ 'font-size': '12px', color: 'var(--subtext)', margin: '4px 0 0' }}>{p().description}</p>
				</div>
				<Show when={p().trust !== 'core' && p().kind !== 'tool'}>
					<button
						class="fm-add-btn"
						style={enabled() ? { color: 'var(--green)', 'border-color': 'var(--green)' } : {}}
						onClick={toggle}
					>
						{enabled() ? t('settings-plugins-community-enabled') : 'Enable'}
					</button>
				</Show>
				<Show when={p().kind === 'tool'}>
					<span style={{ 'font-size': '11px', color: 'var(--muted)', 'background': 'var(--surface0)', padding: '4px 10px', 'border-radius': '6px' }}>
						External tool
					</span>
				</Show>
			</div>

			{/* Capabilities bar */}
			<Show when={p().capabilities.length > 0}>
				<div style={{ display: 'flex', gap: '4px', 'flex-wrap': 'wrap' }}>
					<For each={p().capabilities}>
						{cap => {
							const approved = p().approved.includes(cap);
							return (
								<span style={{
									'font-size': '10px', padding: '2px 8px', 'border-radius': '10px',
									background: approved ? 'color-mix(in srgb, var(--green) 15%, transparent)' : 'color-mix(in srgb, var(--yellow) 15%, transparent)',
									color: approved ? 'var(--green)' : 'var(--yellow)',
									border: `1px solid ${approved ? 'color-mix(in srgb, var(--green) 40%, transparent)' : 'color-mix(in srgb, var(--yellow) 40%, transparent)'}`,
								}}>
									{capabilityLabel(cap)}
								</span>
							);
						}}
					</For>
				</div>
			</Show>

			{/* Expandable detail */}
			<Show when={p().trust === 'plugin'}>
				<div style={{ display: 'flex', gap: '8px', 'font-size': '11px', color: 'var(--muted)' }}>
					<button class="fm-contact-add" onClick={() => setCollapsed(v => !v)} style={{ color: 'var(--muted)' }}>
						{collapsed() ? 'Show details' : 'Hide details'}
					</button>
					<Show when={enabled()}>
						<button class="fm-contact-add" onClick={() => uninstallPlugin(p().id)} style={{ color: 'var(--red)' }}>
							Uninstall
						</button>
					</Show>
				</div>
				<Show when={!collapsed()}>
					<div style={{ 'font-size': '11px', color: 'var(--muted)', 'line-height': '1.6', 'margin-top': '4px' }}>
						<div>ID: <span style={{ 'font-family': 'var(--font-mono)', color: 'var(--subtext)' }}>{p().id}</span></div>
						<Show when={p().author}>
							<div>Author: <span style={{ color: 'var(--subtext)' }}>{p().author}</span></div>
						</Show>
					</div>
				</Show>
			</Show>
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
								<circle cx="12" cy="12" r="3" />
								<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
							</svg>
							{t('settings-category-general')}
						</button>

						<button
							class="settings-cat"
							classList={{ active: category() === 'appearance' }}
							onClick={() => setCategory('appearance')}
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /><circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /><circle cx="6.5" cy="12.5" r=".5" fill="currentColor" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.504 5.555-5.555C21.965 6.012 17.461 2 12 2z" />
							</svg>
							{t('settings-category-appearance')}
						</button>

						<button
							class="settings-cat"
							classList={{ active: category() === 'editor' }}
							onClick={() => setCategory('editor')}
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
							</svg>
							{t('settings-category-editor')}
						</button>

						<button
							class="settings-cat"
							classList={{ active: category() === 'plugins' }}
							onClick={() => setCategory('plugins')}
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M10 20h4a2 2 0 0 0 2-2v-6a2 2 0 0 1 2-2h.5a2.5 2.5 0 0 0 0-5H5.5A2.5 2.5 0 0 0 5.5 10H6a2 2 0 0 1 2 2v6a2 2 0 0 0 2 2z" />
							</svg>
							{t('settings-category-plugins')}
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
						<Show when={category() === 'plugins'}>
							<PluginsPanel />
						</Show>
					</div>

				</div>
			</div>
		</div>
	);
}
