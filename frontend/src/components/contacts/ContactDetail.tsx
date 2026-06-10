import { For, Show, createEffect, createResource, createSignal, on, onCleanup, untrack, type JSX } from 'solid-js';
import { MarkdownModeBar, type MarkdownMode } from '../shared/MarkdownEditor';
import EditorPane from '../shared/EditorPane';
import ViewPane from '../shared/ViewPane';
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

// ── Main component ─────────────────────────────────────────────────────────

export default function ContactDetail(props: { path: string; panelId: string }) {
	const { t } = useI18n();

	const [contact] = createResource(() => props.path, async path => {
		try { return await invoke<Contact>('read_contact', { path }); }
		catch { return undefined; }
	});

	const [fm, setFm] = createStore<Fm>({});
	const [body, setBody] = createSignal('');
	const [bodyMode, setBodyMode] = createSignal<MarkdownMode>('edit');
	const [rawContactDoc, setRawContactDoc] = createSignal('');
	const [loaded, setLoaded] = createSignal(false);
	const [saveStatus, setSaveStatus] = createSignal<SaveStatus>('saved');
	const [tagInput, setTagInput] = createSignal('');
	const [showTagInput, setShowTagInput] = createSignal(false);
	const [bdayEditing, setBdayEditing] = createSignal<string | null>(null);
	const [newPropKey, setNewPropKey] = createSignal('');
	const [newPropValue, setNewPropValue] = createSignal('');
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
		if (isActiveSurface()) setActiveNote(prev => (prev && prev.path === props.path ? prev : { path: props.path, onJump: () => {} }));
		else clearActiveNote(props.path);
	});

	createEffect(() => { if (isActiveSurface()) setActiveNoteBody(body()); });

	const statusLabel = (): Record<SaveStatus, { color: string; label: string }> => ({
		saved: { color: 'var(--green)', label: t('contact-status-saved') },
		unsaved: { color: 'var(--yellow)', label: t('contact-status-unsaved') },
		saving: { color: 'var(--muted)', label: t('contact-status-saving') },
		error: { color: 'var(--red)', label: t('contact-status-error') },
	});

	createEffect(on(() => props.path, () => {
		setLoaded(false); setSaveStatus('saved'); clearTimeout(saveTimer);
		promoted = false; setBdayEditing(null); setBodyMode('edit'); setRawContactDoc('');
	}, { defer: false }));

	createEffect(on(contact, c => {
		if (!c || c.path !== untrack(() => props.path)) return;
		setActivePath(c.path);
		setFm(reconcile({ ...c.frontmatter, email: c.frontmatter.email ?? [], tel: c.frontmatter.tel ?? [], adr: c.frontmatter.adr ?? [], tags: c.frontmatter.tags ?? [] }));
		setBody(c.body ?? '');
		setLoaded(true);
	}));

	onCleanup(async () => {
		clearTimeout(saveTimer); clearActiveNote(props.path);
		if (saveStatus() !== 'unsaved') return;
		try {
			if (bodyMode() === 'raw') await saveFromRaw();
			else { const res = await invoke<Contact>('save_contact', { contact: buildContact() }); handleSaveRename(res); }
		} catch { /* unmounting — best-effort save */ }
	});

	function toPlainFm(): Record<string, unknown> {
		const plain = JSON.parse(JSON.stringify(fm)) as Record<string, unknown>;
		for (const k of ['email', 'tel', 'adr', 'tags']) { if (Array.isArray(plain[k]) && (plain[k] as unknown[]).length === 0) delete plain[k]; }
		return plain;
	}

	function parseRaw() {
		const split = splitFrontmatter(rawContactDoc());
		if (!split) return { newFm: { ...JSON.parse(JSON.stringify(fm)) } as Fm, newBody: rawContactDoc() };
		const parsed = loadYaml(split.fmYaml);
		if (!parsed) return { newFm: { ...JSON.parse(JSON.stringify(fm)) } as Fm, newBody: split.body };
		const prev = JSON.parse(JSON.stringify(fm)) as Fm;
		const newFm: Fm = { ...(parsed as Partial<Fm>), uid: (parsed.uid as string | undefined) ?? prev.uid, created: (parsed.created as string | undefined) ?? prev.created, email: Array.isArray(parsed.email) ? (parsed.email as EmailEntry[]) : prev.email, tel: Array.isArray(parsed.tel) ? (parsed.tel as PhoneEntry[]) : prev.tel, adr: Array.isArray(parsed.adr) ? (parsed.adr as AdrEntry[]) : prev.adr, tags: Array.isArray(parsed.tags) ? (parsed.tags as string[]) : prev.tags };
		return { newFm, newBody: split.body };
	}

	async function saveFromRaw() {
		const { newFm, newBody } = parseRaw();
		const contact: Contact = { path: activePath(), frontmatter: { ...newFm, email: newFm.email?.length ? newFm.email : undefined, tel: newFm.tel?.length ? newFm.tel : undefined, adr: newFm.adr?.length ? newFm.adr : undefined, tags: newFm.tags?.length ? newFm.tags : undefined, modified: new Date().toISOString() }, body: newBody };
		const result = await invoke<Contact>('save_contact', { contact });
		handleSaveRename(result);
	}

	function changeBodyMode(next: MarkdownMode) {
		const cur = bodyMode(); if (cur === next) return;
		if (next === 'raw') setRawContactDoc(buildDocument(toPlainFm(), body()));
		if (cur === 'raw') {
			const { newFm, newBody } = parseRaw();
			setFm(reconcile({ ...newFm, email: newFm.email ?? [], tel: newFm.tel ?? [], adr: newFm.adr ?? [], tags: newFm.tags ?? [] }));
			setBody(newBody);
			const newName = (newFm.fn as string | undefined) ?? '';
			if (newName !== (fm.fn ?? '')) updateTabTitle(props.path, newName || t('contact-detail-no-name'));
			scheduleSave();
		}
		setBodyMode(next);
	}

	function buildContact(): Contact {
		return { path: activePath(), frontmatter: { ...fm, email: fm.email?.length ? fm.email : undefined, tel: fm.tel?.length ? fm.tel : undefined, adr: fm.adr?.length ? fm.adr : undefined, tags: fm.tags?.length ? fm.tags : undefined, modified: new Date().toISOString() }, body: body() };
	}

	function handleSaveRename(result: Contact | undefined) {
		if (!result) return;
		if (result.path !== activePath()) { updateContactTabPath(activePath(), result.path); setActivePath(result.path); }
		const newName = (result.frontmatter as Record<string, unknown>).fn as string | undefined;
		if (newName !== undefined && newName !== fm.fn) { setFm(produce(d => { (d as Record<string, unknown>).fn = newName; })); updateTabTitle(result.path, newName || t('contact-detail-no-name')); }
	}

	function scheduleSave() {
		if (!promoted) { promoted = true; promotePreviewByPath(props.path); }
		setSaveStatus('unsaved'); clearTimeout(saveTimer);
		saveTimer = setTimeout(async () => {
			setSaveStatus('saving');
			try { const result = await invoke<Contact>('save_contact', { contact: buildContact() }); setSaveStatus('saved'); invalidateContacts(); handleSaveRename(result); }
			catch { setSaveStatus('error'); }
		}, 800);
	}

	function setField<K extends keyof Fm>(key: K, value: Fm[K]) {
		setFm(produce(d => { (d as Record<string, unknown>)[key] = value; }));
		if (key === 'fn' && typeof value === 'string') updateTabTitle(props.path, value || t('contact-detail-no-name'));
		if (key === 'fn' || key === 'given-name' || key === 'family-name') { setSaveStatus('unsaved'); return; }
		scheduleSave();
	}

	const KNOWN_FM_KEYS = new Set(['fn', 'given-name', 'family-name', 'email', 'tel', 'adr', 'org', 'title', 'url', 'bday', 'tags', 'uid', 'created', 'modified']);

	const customProps = () => Object.entries(JSON.parse(JSON.stringify(fm)) as Record<string, unknown>).filter(([k]) => !KNOWN_FM_KEYS.has(k)).filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean').map(([k, v]) => [k, String(v)] as [string, string]);

	function setCustomProp(key: string, value: string) { setFm(produce(d => { (d as Record<string, unknown>)[key] = value; })); scheduleSave(); }
	function removeCustomProp(key: string) { setFm(produce(d => { delete (d as Record<string, unknown>)[key]; })); scheduleSave(); }
	function addCustomProp() { const key = newPropKey().trim(); const value = newPropValue().trim(); if (!key || KNOWN_FM_KEYS.has(key)) return; setCustomProp(key, value); setNewPropKey(''); setNewPropValue(''); newPropKeyRef?.focus(); }

	function setEmailField(idx: number, f: 'type' | 'value', v: string) { setFm(produce(d => { if (d.email?.[idx]) { if (f === 'type') d.email[idx].type = v; else d.email[idx].value = v; } })); scheduleSave(); }
	function addEmail() { setFm(produce(d => { d.email = [...(d.email ?? []), { type: 'work', value: '' }]; })); scheduleSave(); }
	function removeEmail(idx: number) { setFm(produce(d => { d.email = d.email?.filter((_, i) => i !== idx); })); scheduleSave(); }

	function setTelField(idx: number, f: 'type' | 'value', v: string) { setFm(produce(d => { if (d.tel?.[idx]) { if (f === 'type') d.tel[idx].type = v; else d.tel[idx].value = v; } })); scheduleSave(); }
	function addTel() { setFm(produce(d => { d.tel = [...(d.tel ?? []), { type: 'mobile', value: '' }]; })); scheduleSave(); }
	function removeTel(idx: number) { setFm(produce(d => { d.tel = d.tel?.filter((_, i) => i !== idx); })); scheduleSave(); }

	function setAdrField(idx: number, f: keyof AdrEntry, v: string) { setFm(produce(d => { if (d.adr?.[idx]) (d.adr[idx] as unknown as Record<string, string>)[f] = v; })); scheduleSave(); }
	function addAdr() { setFm(produce(d => { d.adr = [...(d.adr ?? []), { type: 'home' }]; })); scheduleSave(); }
	function removeAdr(idx: number) { setFm(produce(d => { d.adr = d.adr?.filter((_, i) => i !== idx); })); scheduleSave(); }

	function addTag(raw: string) { const tg = raw.trim().replace(/^#/, ''); if (!tg || fm.tags?.includes(tg)) return; setFm(produce(d => { d.tags = [...(d.tags ?? []), tg]; })); setTagInput(''); setShowTagInput(false); scheduleSave(); }
	function removeTag(tag: string) { setFm(produce(d => { d.tags = d.tags?.filter(tg => tg !== tag); })); scheduleSave(); }

	// ── Icons ───────────────────────────────────────────────────────────────
	const EmailIcon = <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2 4 12 13 22 4"/></svg>;
	const PhoneIcon = <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>;
	const GlobeIcon = <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>;
	const CakeIcon = <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;

	// ── Render ───────────────────────────────────────────────────────────────

	return (
		<div class="contact-detail">
			<Show when={contact.loading && !loaded()}>
				<div style={{ padding: '32px', color: 'var(--muted)', 'font-size': '12px' }}>{t('contact-detail-loading')}</div>
			</Show>

			<Show when={loaded()}>
				{/* Toolbar */}
				<div class="note-toolbar" style={{ display: 'flex', 'align-items': 'center', gap: '8px', padding: '6px 14px', 'flex-shrink': '0', 'border-bottom': '1px solid var(--surface0)', background: 'var(--mantle)' }}>
					<input class="note-title-input" type="text" value={fm['fn'] ?? ''} placeholder={t('contact-detail-name-placeholder')}
						onInput={e => setField('fn', (e.target as HTMLInputElement).value)}
						onBlur={() => { if (saveStatus() === 'unsaved') { clearTimeout(saveTimer); scheduleSave(); } }}
						onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
					/>
					<div style={{ display: 'flex', gap: '2px', 'flex-shrink': '0', background: 'var(--surface0)', 'border-radius': '6px', padding: '2px' }}>
						<MarkdownModeBar mode={bodyMode()} onModeChange={changeBodyMode} />
					</div>
				</div>

				<div style={{ flex: '1 1 0', 'overflow-y': 'auto' }}>

					{/* ═══ RAW mode ═══ */}
					<Show when={bodyMode() === 'raw'}>
						<div style={{ padding: '12px 0 40px', 'max-width': '800px', margin: '0 auto' }}>
							<EditorPane content={rawContactDoc()} mode="edit" autoGrow
								onChange={v => { setRawContactDoc(v); setSaveStatus('unsaved'); }}
							/>
						</div>
					</Show>

					{/* ═══ VIEW / EDIT mode ═══ */}
					<Show when={bodyMode() !== 'raw'}>
						<div style={{ padding: '24px 0', 'max-width': '800px', margin: '0 auto' }}>
							{/* Avatar + title/org + tags */}
							<div style={{ display: 'flex', gap: '18px', 'align-items': 'flex-start', 'margin-bottom': '24px' }}>
								{(() => {
									const init = getInitials(fm);
									const color = avatarColor(init);
									return (
										<div style={{ width: '64px', height: '64px', 'border-radius': '50%', 'flex-shrink': '0', background: `${color}1a`, border: `2px solid ${color}44`, display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'font-family': 'var(--font-display)', 'font-size': '22px', 'font-weight': '700', color }}>
											{init}
										</div>
									);
								})()}
								<div style={{ flex: '1', 'min-width': '0', 'padding-top': '4px' }}>
									<Show when={bodyMode() === 'view'}
										fallback={
											<>
												<input class="contact-subfield" style={{ 'flex': '0 1 auto', 'font-family': 'var(--font-display)', 'font-size': '15px' }} type="text" value={fm.title ?? ''} placeholder={t('contact-detail-title-placeholder')} onInput={e => setField('title', (e.target as HTMLInputElement).value)} />
												<Show when={fm.title && fm.org}><span style={{ color: 'var(--surface2)', 'flex-shrink': '0', margin: '0 6px' }}>·</span></Show>
												<input class="contact-subfield" style={{ flex: '1' }} type="text" value={fm.org ?? ''} placeholder={t('contact-detail-org-placeholder')} onInput={e => setField('org', (e.target as HTMLInputElement).value)} />
											</>
										}
									>
										<p style={{ 'font-family': 'var(--font-display)', 'font-size': '15px', 'font-weight': '500', color: 'var(--subtext)', margin: '0 0 2px' }}>{fm.title || fm.org ? [fm.title, fm.org].filter(Boolean).join(' · ') : '—'}</p>
									</Show>
									<div style={{ display: 'flex', 'flex-wrap': 'wrap', gap: '5px', 'margin-top': '8px' }}>
										<For each={fm.tags ?? []}>
											{tag => (
												<span class="fm-tag">
													<span class="fm-tag-hash">#</span>{tag}
													<Show when={bodyMode() === 'edit'}>
														<button class="fm-tag-remove" onClick={() => removeTag(tag)}><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
													</Show>
												</span>
											)}
										</For>
										<Show when={bodyMode() === 'edit'}>
											<Show when={showTagInput()} fallback={<button class="fm-contact-add" onClick={() => { setShowTagInput(true); setTimeout(() => tagInputRef?.focus(), 0); }}>+ tag</button>}>
												<input ref={tagInputRef} type="text" class="fm-tag-input" value={tagInput()} placeholder={t('contact-tag-placeholder')}
													onInput={e => setTagInput((e.target as HTMLInputElement).value)}
													onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput()); } if (e.key === 'Escape') { setShowTagInput(false); setTagInput(''); } }}
													onBlur={() => { tagInput() ? addTag(tagInput()) : setShowTagInput(false); }}
												/>
											</Show>
										</Show>
									</div>
								</div>
							</div>

							{/* Info cards grid */}
							<div style={{ display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '10px', 'margin-bottom': '24px' }}>
								{/* Email */}
								<div class="contact-info-card">
									<div class="contact-info-card-label">{EmailIcon} {t('contact-prop-email')}</div>
									<For each={fm.email ?? []}>{(e, i) => (
										<div class="contact-info-card-entry">
											<Show when={bodyMode() === 'view'}>
												<span style={{ 'font-size': '11px', color: 'var(--muted)', 'margin-right': '6px' }}>{e.type}</span>
												<span style={{ 'font-size': '12px', color: 'var(--text)' }}>{e.value || '—'}</span>
											</Show>
											<Show when={bodyMode() === 'edit'}>
												<input class="fm-contact-type" type="text" value={e.type} placeholder={t('contact-type-placeholder')} onInput={ev => setEmailField(i(), 'type', (ev.target as HTMLInputElement).value)} />
												<input class="fm-contact-value" type="email" value={e.value} placeholder={t('contact-email-placeholder')} spellcheck={false} onInput={ev => setEmailField(i(), 'value', (ev.target as HTMLInputElement).value)} />
												<button class="fm-contact-remove" onClick={() => removeEmail(i())}><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
											</Show>
										</div>
									)}</For>
									<Show when={bodyMode() === 'edit'}><button class="fm-contact-add" onClick={addEmail}>{t('contact-add-email')}</button></Show>
								</div>

								{/* Phone */}
								<div class="contact-info-card">
									<div class="contact-info-card-label">{PhoneIcon} {t('contact-prop-tel')}</div>
									<For each={fm.tel ?? []}>{(tel, i) => (
										<div class="contact-info-card-entry">
											<Show when={bodyMode() === 'view'}>
												<span style={{ 'font-size': '11px', color: 'var(--muted)', 'margin-right': '6px' }}>{tel.type}</span>
												<span style={{ 'font-size': '12px', color: 'var(--text)' }}>{tel.value || '—'}</span>
											</Show>
											<Show when={bodyMode() === 'edit'}>
												<input class="fm-contact-type" type="text" value={tel.type} placeholder={t('contact-type-placeholder')} onInput={ev => setTelField(i(), 'type', (ev.target as HTMLInputElement).value)} />
												<input class="fm-contact-value" type="tel" value={tel.value} placeholder={t('contact-phone-placeholder')} spellcheck={false} onInput={ev => setTelField(i(), 'value', (ev.target as HTMLInputElement).value)} />
												<button class="fm-contact-remove" onClick={() => removeTel(i())}><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
											</Show>
										</div>
									)}</For>
									<Show when={bodyMode() === 'edit'}><button class="fm-contact-add" onClick={addTel}>{t('contact-add-phone')}</button></Show>
								</div>

								{/* URL */}
								<div class="contact-info-card">
									<div class="contact-info-card-label">{GlobeIcon} {t('contact-prop-url')}</div>
									<Show when={bodyMode() === 'view'}
										fallback={<div class="contact-info-card-entry"><input class="fm-contact-value" style={{ flex: '1' }} type="url" value={fm.url ?? ''} placeholder="https://…" spellcheck={false} onInput={ev => setField('url', (ev.target as HTMLInputElement).value)} /></div>}
									>
										<span style={{ 'font-size': '12px', color: fm.url ? 'var(--accent)' : 'var(--muted)' }}>{fm.url || '—'}</span>
									</Show>
								</div>

								{/* Birthday */}
								<div class="contact-info-card">
									<div class="contact-info-card-label">{CakeIcon} {t('contact-prop-birthday')}</div>
									<Show when={bodyMode() === 'view'}
										fallback={
											<div class="contact-info-card-entry" style={{ position: 'relative' }}>
												<input class="fm-contact-value" style={{ width: '130px' }} type="text" value={bdayEditing() ?? isoToDisplay(fm.bday ?? '')} placeholder={t('contact-birthday-placeholder')} maxLength={10}
													onKeyDown={e => { if (e.ctrlKey || e.metaKey || e.altKey) return; const nav = ['Backspace','Delete','ArrowLeft','ArrowRight','Tab','Home','End'].includes(e.key); if (!nav && !/^[0-9\/\-\.]$/.test(e.key)) e.preventDefault(); }}
													onFocus={() => setBdayEditing(isoToDisplay(fm.bday ?? ''))}
													onInput={e => setBdayEditing((e.target as HTMLInputElement).value)}
													onBlur={e => { const iso = displayToIso((e.target as HTMLInputElement).value); setBdayEditing(null); setField('bday', isValidBday(iso) ? iso || undefined : undefined); }}
												/>
												<input ref={bdayPickerRef} type="date" value={/^\d{4}-\d{2}-\d{2}$/.test(fm.bday ?? '') ? fm.bday : ''} style={{ position: 'absolute', opacity: '0', width: '1px', height: '1px', top: '100%', left: '0', 'pointer-events': 'none' }}
													onInput={e => { const iso = (e.target as HTMLInputElement).value; if (iso) { setField('bday', iso); setBdayEditing(null); } }}
												/>
												<button class="fm-contact-remove" style={{ opacity: '0.6' }} title={t('contact-birthday-calendar-title')} onClick={() => (bdayPickerRef as HTMLInputElement & { showPicker?: () => void })?.showPicker?.()}>
													<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
												</button>
											</div>
										}
									>
										<span style={{ 'font-size': '12px', color: fm.bday ? 'var(--text)' : 'var(--muted)' }}>{fm.bday ? isoToDisplay(fm.bday) : '—'}</span>
									</Show>
								</div>
							</div>

							{/* Address */}
							<Show when={(fm.adr ?? []).length > 0 || bodyMode() === 'edit'}>
								<div class="fm-section" style={{ 'margin-bottom': '20px' }}>
									<div class="fm-section-label">{t('contact-prop-address')}</div>
									<div class="fm-section-content">
										<For each={fm.adr ?? []}>{(a, i) => (
											<div class="fm-address-card">
												<Show when={bodyMode() === 'view'}>
													<span style={{ 'font-size': '10px', color: 'var(--muted)', 'text-transform': 'uppercase' }}>{a.type || '—'}</span>
													<span style={{ 'font-size': '12px', color: 'var(--text)' }}>{[a.street, a.neighborhood, a.city, a.region, a.code, a.country].filter(Boolean).join(', ') || '—'}</span>
												</Show>
												<Show when={bodyMode() === 'edit'}>
													<div class="fm-contact-entry">
														<input class="fm-contact-type" type="text" value={a.type} placeholder={t('contact-type-placeholder')} onInput={ev => setAdrField(i(), 'type', (ev.target as HTMLInputElement).value)} />
														<input class="fm-contact-value" type="text" value={a.street ?? ''} placeholder={t('contact-address-street-placeholder')} spellcheck={false} onInput={ev => setAdrField(i(), 'street', (ev.target as HTMLInputElement).value)} />
														<button class="fm-contact-remove" onClick={() => removeAdr(i())}><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
													</div>
													<div class="fm-address-grid">
														<input class="fm-contact-value" type="text" value={a.neighborhood ?? ''} placeholder={t('contact-address-neighborhood-placeholder')} spellcheck={false} onInput={ev => setAdrField(i(), 'neighborhood', (ev.target as HTMLInputElement).value)} />
														<input class="fm-contact-value" type="text" value={a.city ?? ''} placeholder={t('contact-address-city-placeholder')} spellcheck={false} onInput={ev => setAdrField(i(), 'city', (ev.target as HTMLInputElement).value)} />
														<input class="fm-contact-value" type="text" value={a.region ?? ''} placeholder={t('contact-address-region-placeholder')} spellcheck={false} onInput={ev => setAdrField(i(), 'region', (ev.target as HTMLInputElement).value)} />
														<input class="fm-contact-value" type="text" value={a.code ?? ''} placeholder={t('contact-address-code-placeholder')} spellcheck={false} onInput={ev => setAdrField(i(), 'code', (ev.target as HTMLInputElement).value)} />
														<input class="fm-contact-value" type="text" value={a.country ?? ''} placeholder={t('contact-address-country-placeholder')} spellcheck={false} onInput={ev => setAdrField(i(), 'country', (ev.target as HTMLInputElement).value)} />
													</div>
												</Show>
											</div>
										)}</For>
										<Show when={bodyMode() === 'edit'}><button class="fm-contact-add" onClick={addAdr}>{t('contact-add-address')}</button></Show>
									</div>
								</div>
							</Show>

							{/* Custom properties */}
							<For each={customProps()}>{([key, value]) => (
								<div class="fm-field-row">
									<label class="fm-field-key">{key}</label>
									<div class="fm-field-value">
										<Show when={bodyMode() === 'view'}><span style={{ 'font-size': '12px', color: 'var(--text)' }}>{value || '—'}</span></Show>
										<Show when={bodyMode() === 'edit'}>
											<input class="fm-field-input" type="text" value={value} spellcheck={false} onInput={e => setCustomProp(key, (e.target as HTMLInputElement).value)} />
											<button class="fm-field-remove" onClick={() => removeCustomProp(key)} title={t('notes-fm-remove-prop')}><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
										</Show>
									</div>
								</div>
							)}</For>

							{/* Add custom property */}
							<Show when={bodyMode() === 'edit'}>
								<div class="fm-add-row" style={{ 'margin-top': '8px' }}>
									<input ref={newPropKeyRef} class="fm-field-input" style={{ flex: '1 1 120px' }} type="text" value={newPropKey()} placeholder={t('notes-fm-add-prop')} spellcheck={false}
										onInput={e => setNewPropKey((e.target as HTMLInputElement).value)}
										onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomProp(); } }}
									/>
									<input class="fm-field-input" style={{ flex: '1 1 120px' }} type="text" value={newPropValue()} placeholder="value" spellcheck={false}
										onInput={e => setNewPropValue((e.target as HTMLInputElement).value)}
										onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomProp(); } }}
									/>
									<button class="fm-add-btn" onClick={addCustomProp} disabled={!newPropKey().trim()}>+ {t('notes-fm-add')}</button>
								</div>
							</Show>

							{/* Markdown body */}
							<div style={{ 'margin-top': '24px', 'border-top': '1px solid var(--surface0)', 'padding-top': '20px' }}>
								<Show when={bodyMode() === 'view'}>
									<ViewPane body={body()} autoGrow />
								</Show>
								<Show when={bodyMode() === 'edit'}>
									<EditorPane content={body()} mode="edit" autoGrow
										onChange={v => { setBody(v); scheduleSave(); }}
									/>
								</Show>
							</div>
						</div>
					</Show>
				</div>

				{/* Status bar */}
				<div class="status-bar">
					<span class="status-path">{activePath()}</span>
					<span class="status-label" style={{ color: statusLabel()[saveStatus()].color }}>{statusLabel()[saveStatus()].label}</span>
				</div>
			</Show>
		</div>
	);
}
