import { For, Show, createEffect, createResource, createSignal, on, onCleanup, untrack, type JSX } from 'solid-js';
import MarkdownEditor, { MarkdownModeBar, type MarkdownMode } from '../shared/MarkdownEditor';
import { createStore, produce, reconcile } from 'solid-js/store';
import { useI18n } from '../../i18n/context';
import { invoke } from '../../utils/api';
import { buildDocument, loadYaml, splitFrontmatter } from '../../utils/frontmatter';
import { invalidateContacts } from '../../stores/contactsStore';
import { promotePreviewByPath, updateTabTitle, updateContactTabPath, focusedPanelId, panels } from '../workspace/workspaceStore';
import { setActiveNote, clearActiveNote, setActiveNoteBody } from '../../stores/layoutStore';

// ── Types ──────────────────────────────────────────────────────────────────

interface EmailEntry { type: string; value: string; }
interface PhoneEntry { type: string; value: string; }
interface AdrEntry {
	type: string;
	street?: string;
	neighborhood?: string;
	city?: string;
	region?: string;
	code?: string;
	country?: string;
}

interface Fm {
	fn?: string;
	'given-name'?: string;
	'family-name'?: string;
	email?: EmailEntry[];
	tel?: PhoneEntry[];
	adr?: AdrEntry[];
	org?: string;
	title?: string;
	url?: string;
	bday?: string;
	tags?: string[];
	uid?: string;
	created?: string;
	modified?: string;
}

interface Contact { path: string; frontmatter: Fm; body: string; }
type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error';

// ── Helpers ────────────────────────────────────────────────────────────────

function avatarColor(s: string): string {
	const p = ['#89b4fa', '#a6e3a1', '#fab387', '#f5c2e7', '#94e2d5', '#cba6f7', '#f9e2af', '#f38ba8'];
	let h = 0;
	for (const c of s) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
	return p[h % p.length];
}

function getInitials(fm: Fm): string {
	const name = fm.fn ?? [fm['given-name'], fm['family-name']].filter(Boolean).join(' ');
	return (name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

// Birthday: ISO (YYYY-MM-DD or --MM-DD) ↔ display (dd/mm/aaaa or dd/mm)
function isoToDisplay(iso: string): string {
	const full = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (full) return `${full[3]}/${full[2]}/${full[1]}`;
	const noYear = iso.match(/^--(\d{2})-(\d{2})$/);
	if (noYear) return `${noYear[2]}/${noYear[1]}`;
	return iso;
}
function displayToIso(input: string): string {
	const s = input.trim();
	if (!s) return '';
	if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
	const full = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
	if (full) return `${full[3]}-${full[2].padStart(2, '0')}-${full[1].padStart(2, '0')}`;
	const noYear = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})$/);
	if (noYear) return `--${noYear[2].padStart(2, '0')}-${noYear[1].padStart(2, '0')}`;
	return s;
}
function isValidBday(iso: string): boolean {
	if (!iso) return true;
	if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
		const [y, m, d] = iso.split('-').map(Number);
		const dt = new Date(y, m - 1, d);
		return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
	}
	if (/^--(\d{2})-(\d{2})$/.test(iso)) {
		const [, mm, dd] = iso.match(/^--(\d{2})-(\d{2})$/)!;
		const m = +mm, d = +dd;
		if (m < 1 || m > 12 || d < 1) return false;
		return d <= new Date(2000, m, 0).getDate();
	}
	return false;
}

// ── Primitive components ───────────────────────────────────────────────────

/** Key-value property row — left label column, right editable slot */
function PropRow(props: { label: string; children: JSX.Element; alignTop?: boolean }) {
	return (
		<div class="prop-row" classList={{ top: !!props.alignTop }}>
			<span class="prop-label">{props.label}</span>
			<div class="prop-value">{props.children}</div>
		</div>
	);
}

/** Transparent inline input that shows a border only on focus */
function InlineInput(props: {
	type?: string; value: string; placeholder?: string;
	onInput: (v: string) => void; mono?: boolean;
}) {
	return (
		<input
			class="inline-input"
			classList={{ mono: !!props.mono }}
			type={props.type ?? 'text'}
			value={props.value}
			placeholder={props.placeholder ?? '—'}
			onInput={e => props.onInput((e.target as HTMLInputElement).value)}
		/>
	);
}

/** Compact free-text pill for field type (vCard TYPE is open-ended in RFC 6350) */
function TypeInput(props: { value: string; placeholder: string; onChange: (v: string) => void }) {
	return (
		<input
			class="type-pill"
			type="text"
			value={props.value}
			placeholder={props.placeholder}
			onInput={e => props.onChange((e.target as HTMLInputElement).value)}
		/>
	);
}

// ── Main component ─────────────────────────────────────────────────────────

export default function ContactDetail(props: { path: string; panelId: string }) {
	const { t } = useI18n();

	const [contact] = createResource(() => props.path, async path => {
		try {
			return await invoke<Contact>('read_contact', { path });
		} catch {
			// File may have been renamed by a concurrent save.
			return undefined;
		}
	});

	const [fm, setFm] = createStore<Fm>({});
	const [body, setBody] = createSignal('');
	const [bodyMode, setBodyMode] = createSignal<MarkdownMode>('edit');
	// Full contact file buffer (YAML frontmatter + body), only used in raw mode.
	const [rawContactDoc, setRawContactDoc] = createSignal('');
	const [loaded, setLoaded] = createSignal(false);
	const [saveStatus, setSaveStatus] = createSignal<SaveStatus>('saved');
	const [propsOpen, setPropsOpen] = createSignal(true);
	const [tagInput, setTagInput] = createSignal('');
	const [showTagInput, setShowTagInput] = createSignal(false);
	const [bdayEditing, setBdayEditing] = createSignal<string | null>(null);
	const [newPropKey, setNewPropKey] = createSignal('');
	const [newPropValue, setNewPropValue] = createSignal('');
	// Tracks the current file path, updated after renames (mirrors note pattern).
	const [activePath, setActivePath] = createSignal(props.path);

	let tagInputRef: HTMLInputElement | undefined;
	let bdayPickerRef: HTMLInputElement | undefined;
	let newPropKeyRef: HTMLInputElement | undefined;
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let promoted = false;

	const isActiveSurface = () => {
		if (focusedPanelId() !== props.panelId) return false;
		const p = panels[props.panelId];
		const tab = p?.tabs.find(t => t.id === p.activeTabId);
		return !!tab && tab.content.type === 'contact-detail' &&
			(tab.content as { contactPath: string }).contactPath === props.path;
	};

	createEffect(() => {
		if (isActiveSurface()) {
			setActiveNote(prev => (prev && prev.path === props.path ? prev : { path: props.path, onJump: () => {} }));
		} else {
			clearActiveNote(props.path);
		}
	});

	createEffect(() => {
		if (isActiveSurface()) setActiveNoteBody(body());
	});

	// ── Status bar labels (reactive) ─────────────────────────────────────

	const statusLabel = (): Record<SaveStatus, { color: string; label: string }> => ({
		saved: { color: 'var(--green)', label: t('contact-status-saved') },
		unsaved: { color: 'var(--yellow)', label: t('contact-status-unsaved') },
		saving: { color: 'var(--muted)', label: t('contact-status-saving') },
		error: { color: 'var(--red)', label: t('contact-status-error') },
	});

	// Reset on path change
	createEffect(on(() => props.path, () => {
		setLoaded(false);
		setSaveStatus('saved');
		clearTimeout(saveTimer);
		promoted = false;
		setBdayEditing(null);
		setBodyMode('edit');
		setRawContactDoc('');
	}, { defer: false }));

	// Populate only when the resource value changes AND it matches the current path.
	// Using `on(contact, ...)` prevents re-running when other signals (loaded, etc.)
	// change, which avoids populating with stale data from the previous contact while
	// the new one is still loading.
	createEffect(on(contact, c => {
		if (!c || c.path !== untrack(() => props.path)) return;
		setActivePath(c.path);
		setFm(reconcile({
			...c.frontmatter,
			email: c.frontmatter.email ?? [],
			tel: c.frontmatter.tel ?? [],
			adr: c.frontmatter.adr ?? [],
			tags: c.frontmatter.tags ?? [],
		}));
		setBody(c.body ?? '');
		setLoaded(true);
	}));

	onCleanup(async () => {
		clearTimeout(saveTimer);
		clearActiveNote(props.path);
		if (saveStatus() !== 'unsaved') return;
		try {
			if (bodyMode() === 'raw') await saveFromRaw();
			else { const res = await invoke<Contact>('save_contact', { contact: buildContact() }); handleSaveRename(res); }
		} catch { /* unmounting — best-effort save */ }
	});

	// ── Raw mode helpers ───────────────────────────────────────────────────

	/** Serialise the fm store to a plain object suitable for YAML. */
	function toPlainFm(): Record<string, unknown> {
		const plain = JSON.parse(JSON.stringify(fm)) as Record<string, unknown>;
		for (const k of ['email', 'tel', 'adr', 'tags']) {
			if (Array.isArray(plain[k]) && (plain[k] as unknown[]).length === 0) delete plain[k];
		}
		return plain;
	}

	/** Parse rawContactDoc, falling back to previous values on error. */
	function parseRaw() {
		const split = splitFrontmatter(rawContactDoc());
		if (!split) return { newFm: { ...JSON.parse(JSON.stringify(fm)) } as Fm, newBody: rawContactDoc() };

		const parsed = loadYaml(split.fmYaml);
		if (!parsed) return { newFm: { ...JSON.parse(JSON.stringify(fm)) } as Fm, newBody: split.body };

		const prev = JSON.parse(JSON.stringify(fm)) as Fm;
		const newFm: Fm = {
			...(parsed as Partial<Fm>),
			uid: (parsed.uid as string | undefined) ?? prev.uid,
			created: (parsed.created as string | undefined) ?? prev.created,
			// Validate array fields: restore previous if the user broke the structure.
			email: Array.isArray(parsed.email) ? (parsed.email as EmailEntry[]) : prev.email,
			tel: Array.isArray(parsed.tel) ? (parsed.tel as PhoneEntry[]) : prev.tel,
			adr: Array.isArray(parsed.adr) ? (parsed.adr as AdrEntry[]) : prev.adr,
			tags: Array.isArray(parsed.tags) ? (parsed.tags as string[]) : prev.tags,
		};
		return { newFm, newBody: split.body };
	}

	/** Save while in raw mode without mutating reactive state (safe in onCleanup). */
	async function saveFromRaw() {
		const { newFm, newBody } = parseRaw();
		const contact: Contact = {
			path: activePath(),
			frontmatter: {
				...newFm,
				email: newFm.email?.length ? newFm.email : undefined,
				tel: newFm.tel?.length ? newFm.tel : undefined,
				adr: newFm.adr?.length ? newFm.adr : undefined,
				tags: newFm.tags?.length ? newFm.tags : undefined,
				modified: new Date().toISOString(),
			},
			body: newBody,
		};
		const result = await invoke<Contact>('save_contact', { contact });
		handleSaveRename(result);
	}

	/** Mode transition handler — builds/parses the raw document as needed. */
	function changeBodyMode(next: MarkdownMode) {
		const cur = bodyMode();
		if (cur === next) return;

		if (next === 'raw') {
			setRawContactDoc(buildDocument(toPlainFm(), body()));
		}

		if (cur === 'raw') {
			const { newFm, newBody } = parseRaw();
			setFm(reconcile({
				...newFm,
				email: newFm.email ?? [],
				tel: newFm.tel ?? [],
				adr: newFm.adr ?? [],
				tags: newFm.tags ?? [],
			}));
			setBody(newBody);
			const newName = (newFm.fn as string | undefined) ?? '';
			if (newName !== (fm.fn ?? '')) updateTabTitle(props.path, newName || t('contact-detail-no-name'));
			scheduleSave();
		}

		setBodyMode(next);
	}

	// ── Save ───────────────────────────────────────────────────────────────

	function buildContact(): Contact {
		return {
			path: activePath(),
			frontmatter: {
				...fm,
				email: fm.email?.length ? fm.email : undefined,
				tel: fm.tel?.length ? fm.tel : undefined,
				adr: fm.adr?.length ? fm.adr : undefined,
				tags: fm.tags?.length ? fm.tags : undefined,
				modified: new Date().toISOString(),
			},
			body: body(),
		};
	}

	/** If the contact was renamed on save, update tab references. */
	function handleSaveRename(result: Contact | undefined) {
		if (!result) return;
		if (result.path !== activePath()) {
			updateContactTabPath(activePath(), result.path);
			setActivePath(result.path);
		}
		// Sync the display name back from the result — the backend may have
		// reverted it on a naming conflict, so the UI must reflect reality.
		const newName = (result.frontmatter as Record<string, unknown>).fn as string | undefined;
		if (newName !== undefined && newName !== fm.fn) {
			setFm(produce(d => { (d as Record<string, unknown>).fn = newName; }));
			updateTabTitle(result.path, newName || t('contact-detail-no-name'));
		}
	}

	function scheduleSave() {
		if (!promoted) { promoted = true; promotePreviewByPath(props.path); }
		setSaveStatus('unsaved');
		clearTimeout(saveTimer);
		saveTimer = setTimeout(async () => {
			setSaveStatus('saving');
			try {
				const result = await invoke<Contact>('save_contact', { contact: buildContact() });
				setSaveStatus('saved');
				invalidateContacts();
				handleSaveRename(result);
			} catch { setSaveStatus('error'); }
		}, 800);
	}

	// ── Field helpers ──────────────────────────────────────────────────────

	function setField<K extends keyof Fm>(key: K, value: Fm[K]) {
		setFm(produce(d => { (d as Record<string, unknown>)[key] = value; }));
		if (key === 'fn' && typeof value === 'string') updateTabTitle(props.path, value || t('contact-detail-no-name'));
		// Name fields (fn, given-name, family-name) are buffered locally;
		// save fires on Enter/blur, not on every keystroke (per spec).
		if (key === 'fn' || key === 'given-name' || key === 'family-name') {
			setSaveStatus('unsaved');
			return;
		}
		scheduleSave();
	}

	// ── Custom / extra property helpers ───────────────────────────────────

	const KNOWN_FM_KEYS = new Set([
		'fn', 'given-name', 'family-name', 'email', 'tel', 'adr',
		'org', 'title', 'url', 'bday', 'tags', 'uid', 'created', 'modified',
	]);

	const customProps = () =>
		Object.entries(JSON.parse(JSON.stringify(fm)) as Record<string, unknown>)
			.filter(([k]) => !KNOWN_FM_KEYS.has(k))
			.filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
			.map(([k, v]) => [k, String(v)] as [string, string]);

	function setCustomProp(key: string, value: string) {
		setFm(produce(d => { (d as Record<string, unknown>)[key] = value; }));
		scheduleSave();
	}

	function removeCustomProp(key: string) {
		setFm(produce(d => { delete (d as Record<string, unknown>)[key]; }));
		scheduleSave();
	}

	function addCustomProp() {
		const key = newPropKey().trim();
		const value = newPropValue().trim();
		if (!key || KNOWN_FM_KEYS.has(key)) return;
		setCustomProp(key, value);
		setNewPropKey('');
		setNewPropValue('');
		newPropKeyRef?.focus();
	}

	function setEmailField(idx: number, f: 'type' | 'value', v: string) {
		setFm(produce(d => { if (d.email?.[idx]) { if (f === 'type') d.email[idx].type = v; else d.email[idx].value = v; } }));
		scheduleSave();
	}
	function addEmail() { setFm(produce(d => { d.email = [...(d.email ?? []), { type: 'work', value: '' }]; })); scheduleSave(); }
	function removeEmail(idx: number) { setFm(produce(d => { d.email = d.email?.filter((_, i) => i !== idx); })); scheduleSave(); }

	function setTelField(idx: number, f: 'type' | 'value', v: string) {
		setFm(produce(d => { if (d.tel?.[idx]) { if (f === 'type') d.tel[idx].type = v; else d.tel[idx].value = v; } }));
		scheduleSave();
	}
	function addTel() { setFm(produce(d => { d.tel = [...(d.tel ?? []), { type: 'mobile', value: '' }]; })); scheduleSave(); }
	function removeTel(idx: number) { setFm(produce(d => { d.tel = d.tel?.filter((_, i) => i !== idx); })); scheduleSave(); }

	function setAdrField(idx: number, f: keyof AdrEntry, v: string) {
		setFm(produce(d => { if (d.adr?.[idx]) (d.adr[idx] as unknown as Record<string, string>)[f] = v; }));
		scheduleSave();
	}
	function addAdr() { setFm(produce(d => { d.adr = [...(d.adr ?? []), { type: 'home' }]; })); scheduleSave(); }
	function removeAdr(idx: number) { setFm(produce(d => { d.adr = d.adr?.filter((_, i) => i !== idx); })); scheduleSave(); }

	function addTag(raw: string) {
		const tg = raw.trim().replace(/^#/, '');
		if (!tg || fm.tags?.includes(tg)) return;
		setFm(produce(d => { d.tags = [...(d.tags ?? []), tg]; }));
		setTagInput(''); setShowTagInput(false); scheduleSave();
	}
	function removeTag(tag: string) { setFm(produce(d => { d.tags = d.tags?.filter(tg => tg !== tag); })); scheduleSave(); }

	// ── Render ─────────────────────────────────────────────────────────────

	return (
		<div class="contact-detail">

			<Show when={contact.loading && !loaded()}>
				<div style={{ padding: '32px', color: 'var(--muted)', 'font-size': '12px' }}>
					{t('contact-detail-loading')}
				</div>
			</Show>

			<Show when={loaded()}>

				{/* ── Scrollable document body ───────────────────────────────── */}
				<div style={{ flex: '1 1 0', 'overflow-y': 'auto' }}>

					{/* ── Title block ─────────────────────────────────────────── */}
					<div style={{ padding: '28px 24px 16px', 'border-bottom': '1px solid var(--surface0)' }}>
						<div style={{ display: 'flex', gap: '16px', 'align-items': 'flex-start' }}>
							{/* Avatar */}
							{(() => {
								const init = getInitials(fm);
								const color = avatarColor(init);
								return (
									<div style={{
										width: '44px', height: '44px', 'border-radius': '50%', 'flex-shrink': '0',
										background: `${color}1a`, border: `1.5px solid ${color}44`,
										display: 'flex', 'align-items': 'center', 'justify-content': 'center',
										'font-size': '16px', 'font-weight': '700', color, 'margin-top': '2px',
									}}>
										{init}
									</div>
								);
							})()}
							<div style={{ flex: '1', 'min-width': '0' }}>
								{/* Name */}
								<input
									class="contact-name"
									type="text"
									value={fm['fn'] ?? ''}
									placeholder={t('contact-detail-name-placeholder')}
									onInput={e => setField('fn', (e.target as HTMLInputElement).value)}
									onBlur={() => { if (saveStatus() === 'unsaved') { clearTimeout(saveTimer); scheduleSave(); } }}
									onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
								/>
								{/* Cargo · Empresa */}
								<div style={{ display: 'flex', gap: '6px', 'margin-top': '6px', 'align-items': 'center' }}>
									<input
										class="contact-subfield"
										style={{ flex: '0 1 auto' }}
										type="text"
										value={fm.title ?? ''}
										placeholder={t('contact-detail-title-placeholder')}
										onInput={e => setField('title', (e.target as HTMLInputElement).value)}
									/>
									<Show when={fm.title && fm.org}>
										<span style={{ color: 'var(--surface2)', 'flex-shrink': '0' }}>·</span>
									</Show>
									<input
										class="contact-subfield"
										style={{ flex: '1' }}
										type="text"
										value={fm.org ?? ''}
										placeholder={t('contact-detail-org-placeholder')}
										onInput={e => setField('org', (e.target as HTMLInputElement).value)}
									/>

									<MarkdownModeBar mode={bodyMode()} onModeChange={changeBodyMode} />

								</div>
							</div>
						</div>
					</div>

					{/* ── Properties — hidden when editing raw YAML ──────────── */}
					<Show when={bodyMode() !== 'raw'}>
						<div style={{ 'border-bottom': '1px solid var(--surface0)' }}>
							{/* Collapsible header */}
							<button class="props-header" onClick={() => setPropsOpen(v => !v)}>
								<span style={{ 'font-size': '9px', transition: 'transform 0.15s', transform: propsOpen() ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
								{t('contact-detail-props-header')}
							</button>

							<Show when={propsOpen()}>
								{/* Email */}
								<PropRow label={t('contact-prop-email')}>
									<For each={fm.email ?? []}>
										{(e, i) => (
											<div style={{ display: 'flex', 'align-items': 'center' }}>
												<TypeInput value={e.type} placeholder={t('contact-type-placeholder')} onChange={v => setEmailField(i(), 'type', v)} />
												<InlineInput type="email" value={e.value} placeholder={t('contact-email-placeholder')} onInput={v => setEmailField(i(), 'value', v)} />
												<button class="field-remove" onClick={() => removeEmail(i())}>✕</button>
											</div>
										)}
									</For>
									<button class="field-add" onClick={addEmail}>{t('contact-add-email')}</button>
								</PropRow>

								{/* Telefone */}
								<PropRow label={t('contact-prop-tel')}>
									<For each={fm.tel ?? []}>
										{(tel, i) => (
											<div style={{ display: 'flex', 'align-items': 'center' }}>
												<TypeInput value={tel.type} placeholder={t('contact-type-placeholder')} onChange={v => setTelField(i(), 'type', v)} />
												<InlineInput type="tel" value={tel.value} placeholder={t('contact-phone-placeholder')} onInput={v => setTelField(i(), 'value', v)} />
												<button class="field-remove" onClick={() => removeTel(i())}>✕</button>
											</div>
										)}
									</For>
									<button class="field-add" onClick={addTel}>{t('contact-add-phone')}</button>
								</PropRow>

								{/* Endereço */}
								<PropRow label={t('contact-prop-address')} alignTop>
									<For each={fm.adr ?? []}>
										{(a, i) => (
											<div class="adr-card">
												<div style={{ display: 'flex', 'align-items': 'center', gap: '4px' }}>
													<TypeInput value={a.type} placeholder={t('contact-type-placeholder')} onChange={v => setAdrField(i(), 'type', v)} />
													<div style={{ flex: '1' }}>
														<InlineInput value={a.street ?? ''} placeholder={t('contact-address-street-placeholder')} onInput={v => setAdrField(i(), 'street', v)} />
													</div>
													<button class="field-remove" onClick={() => removeAdr(i())}>✕</button>
												</div>
												<div style={{ display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '4px' }}>
													<InlineInput value={a.neighborhood ?? ''} placeholder={t('contact-address-neighborhood-placeholder')} onInput={v => setAdrField(i(), 'neighborhood', v)} />
													<InlineInput value={a.city ?? ''} placeholder={t('contact-address-city-placeholder')} onInput={v => setAdrField(i(), 'city', v)} />
												</div>
												<div style={{ display: 'grid', 'grid-template-columns': '70px 110px 1fr', gap: '4px' }}>
													<InlineInput value={a.region ?? ''} placeholder={t('contact-address-region-placeholder')} onInput={v => setAdrField(i(), 'region', v)} />
													<InlineInput value={a.code ?? ''} placeholder={t('contact-address-code-placeholder')} onInput={v => setAdrField(i(), 'code', v)} />
													<InlineInput value={a.country ?? ''} placeholder={t('contact-address-country-placeholder')} onInput={v => setAdrField(i(), 'country', v)} />
												</div>
											</div>
										)}
									</For>
									<button class="field-add" onClick={addAdr}>{t('contact-add-address')}</button>
								</PropRow>

								{/* URL */}
								<PropRow label={t('contact-prop-url')}>
									<InlineInput type="url" value={fm.url ?? ''} placeholder="https://..." onInput={v => setField('url', v)} />
								</PropRow>

								{/* Aniversário */}
								<PropRow label={t('contact-prop-birthday')}>
									<div style={{ display: 'flex', 'align-items': 'center', gap: '4px', position: 'relative' }}>
										<input
											class="bday-input"
											type="text"
											value={bdayEditing() ?? isoToDisplay(fm.bday ?? '')}
											placeholder={t('contact-birthday-placeholder')}
											maxLength={10}
											onKeyDown={e => {
												if (e.ctrlKey || e.metaKey || e.altKey) return;
												const nav = ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab', 'Home', 'End'].includes(e.key);
												if (!nav && !/^[0-9\/\-\.]$/.test(e.key)) e.preventDefault();
											}}
											onFocus={() => setBdayEditing(isoToDisplay(fm.bday ?? ''))}
											onInput={e => setBdayEditing((e.target as HTMLInputElement).value)}
											onBlur={e => {
												const iso = displayToIso((e.target as HTMLInputElement).value);
												setBdayEditing(null);
												setField('bday', isValidBday(iso) ? iso || undefined : undefined);
											}}
										/>
										{/* Picker nativo oculto */}
										<input
											ref={bdayPickerRef}
											type="date"
											value={/^\d{4}-\d{2}-\d{2}$/.test(fm.bday ?? '') ? fm.bday : ''}
											style={{ position: 'absolute', opacity: '0', width: '1px', height: '1px', top: '100%', left: '0', 'pointer-events': 'none' }}
											onInput={e => {
												const iso = (e.target as HTMLInputElement).value;
												if (iso) { setField('bday', iso); setBdayEditing(null); }
											}}
										/>
										<button
											class="field-remove"
											title={t('contact-birthday-calendar-title')}
											onClick={() => (bdayPickerRef as HTMLInputElement & { showPicker?: () => void })?.showPicker?.()}
										>
											<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
												<rect x="3" y="4" width="18" height="18" rx="2" />
												<line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
												<line x1="3" y1="10" x2="21" y2="10" />
											</svg>
										</button>
									</div>
								</PropRow>

								{/* Tags */}
								<PropRow label={t('contact-prop-tags')} alignTop>
									<div style={{ display: 'flex', 'flex-wrap': 'wrap', gap: '4px', padding: '2px 0' }}>
										<For each={fm.tags ?? []}>
											{tag => (
												<span class="contact-tag">
													#{tag}
													<button class="contact-tag-remove" onClick={() => removeTag(tag)}>✕</button>
												</span>
											)}
										</For>
										<Show
											when={showTagInput()}
											fallback={
												<button class="contact-tag-add" onClick={() => { setShowTagInput(true); setTimeout(() => tagInputRef?.focus(), 0); }}>+ tag</button>
											}
										>
											<input
												ref={tagInputRef}
												type="text"
												value={tagInput()}
												placeholder={t('contact-tag-placeholder')}
												onInput={e => setTagInput((e.target as HTMLInputElement).value)}
												onKeyDown={e => {
													if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput()); }
													if (e.key === 'Escape') { setShowTagInput(false); setTagInput(''); }
												}}
												onBlur={() => { tagInput() ? addTag(tagInput()) : setShowTagInput(false); }}
												style={{
													padding: '1px 8px', 'border-radius': '10px', width: '90px',
													background: 'var(--surface0)', border: '1px solid var(--accent)',
													'font-size': '11px', color: 'var(--text)', outline: 'none',
												}}
											/>
										</Show>
									</div>
								</PropRow>

								{/* Custom properties */}
								<For each={customProps()}>
									{([key, value]) => (
										<PropRow label={key}>
											<div style={{ display: 'flex', 'align-items': 'center', gap: '4px' }}>
												<InlineInput
													value={value}
													onInput={v => setCustomProp(key, v)}
												/>
												<button
													class="contact-tag-remove"
													onClick={() => removeCustomProp(key)}
													title={t('notes-fm-remove-prop')}
													style={{ 'flex-shrink': '0' }}
												>✕</button>
											</div>
										</PropRow>
									)}
								</For>

								{/* Add custom property */}
								<div style={{
									display: 'flex', 'align-items': 'center', gap: '6px',
									padding: '4px 24px 8px',
								}}>
									<input
										ref={newPropKeyRef}
										class="inline-input"
										style={{ width: '120px', 'font-size': '12px' }}
										type="text"
										value={newPropKey()}
										placeholder={t('notes-fm-add-prop')}
										onInput={e => setNewPropKey((e.target as HTMLInputElement).value)}
										onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomProp(); } }}
									/>
									<input
										class="inline-input"
										style={{ flex: '1', 'font-size': '12px' }}
										type="text"
										value={newPropValue()}
										placeholder="valor"
										onInput={e => setNewPropValue((e.target as HTMLInputElement).value)}
										onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomProp(); } }}
									/>
									<button
										class="contact-tag-add"
										onClick={addCustomProp}
										disabled={!newPropKey().trim()}
										title={t('notes-fm-add')}
									>+ {t('notes-fm-add')}</button>
								</div>
							</Show>
						</div>
					</Show>

					{/* ── Markdown notes ───────────────────────────────────────── */}
					<div style={{ padding: '12px 0px 40px' }}>
						<MarkdownEditor
							content={bodyMode() === 'raw' ? rawContactDoc() : body()}
							onChange={v => {
								if (bodyMode() === 'raw') {
									setRawContactDoc(v);
									setSaveStatus('unsaved');
								} else {
									setBody(v);
									scheduleSave();
								}
							}}
							mode={bodyMode()}
							onModeChange={changeBodyMode}
							autoGrow={true}
						/>
					</div>
				</div>

				{/* ── Status bar ────────────────────────────────────────────── */}
				<div class="status-bar">
					<span class="status-path">{props.path.split('/').pop()}</span>
					<span class="status-label" style={{ color: statusLabel()[saveStatus()].color }}>
						{statusLabel()[saveStatus()].label}
					</span>
				</div>

			</Show>
		</div>
	);
}
