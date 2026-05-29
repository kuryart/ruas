import { For, Show, createEffect, createResource, createSignal, on, onCleanup, type JSX } from 'solid-js';
import { createStore, produce, reconcile } from 'solid-js/store';
import { invoke } from '../../utils/api';
import { promotePreviewByPath, updateTabTitle } from '../workspace/workspaceStore';

// ── Types ──────────────────────────────────────────────────────────────────

interface EmailEntry { type: string; value: string; }
interface PhoneEntry { type: string; value: string; }
interface AdrEntry {
  type: string;
  street?: string;
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
    return d <= new Date(2000, m, 0).getDate(); // 2000 = leap year, covers Feb 29
  }
  return false;
}

// ── Primitive components ───────────────────────────────────────────────────

/** Key-value property row — left label column, right editable slot */
function PropRow(props: { label: string; children: JSX.Element; alignTop?: boolean }) {
  return (
    <div style={{
      display: 'grid', 'grid-template-columns': '80px 1fr', 'align-items': props.alignTop ? 'start' : 'center',
      'min-height': '28px', padding: '1px 12px 1px 16px',
      'border-bottom': '1px solid var(--surface0)',
    }}>
      <span style={{ 'font-size': '11px', color: 'var(--muted)', 'padding-top': props.alignTop ? '6px' : '0', 'user-select': 'none' }}>
        {props.label}
      </span>
      <div style={{ display: 'flex', 'flex-direction': 'column', gap: '2px', padding: '3px 0' }}>
        {props.children}
      </div>
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
      type={props.type ?? 'text'}
      value={props.value}
      placeholder={props.placeholder ?? '—'}
      onInput={e => props.onInput((e.target as HTMLInputElement).value)}
      style={{
        width: '100%', background: 'transparent', border: 'none',
        'border-radius': '3px', padding: '2px 4px',
        'font-size': '13px', color: 'var(--text)',
        'font-family': props.mono ? "monospace" : 'inherit',
        outline: 'none',
      }}
      onFocus={e => { const t = e.target as HTMLElement; t.style.background = 'var(--surface0)'; t.style.outline = '1px solid var(--accent)'; }}
      onBlur={e => { const t = e.target as HTMLElement; t.style.background = 'transparent'; t.style.outline = 'none'; }}
    />
  );
}

/** Compact pill select for email/phone type */
function TypePill(props: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <select
      value={props.value}
      onChange={e => props.onChange((e.target as HTMLSelectElement).value)}
      style={{
        background: 'var(--surface0)', border: '1px solid var(--surface1)',
        'border-radius': '10px', padding: '1px 6px', 'font-size': '10px',
        color: 'var(--muted)', cursor: 'pointer', 'flex-shrink': '0',
        'margin-right': '6px',
      }}
    >
      <For each={props.options}>{o => <option value={o}>{o}</option>}</For>
    </select>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function ContactDetail(props: { path: string }) {
  const [contact] = createResource(() => props.path, path => invoke<Contact>('read_contact', { path }));

  const [fm, setFm] = createStore<Fm>({});
  const [body, setBody] = createSignal('');
  const [loaded, setLoaded] = createSignal(false);
  const [saveStatus, setSaveStatus] = createSignal<SaveStatus>('saved');
  const [propsOpen, setPropsOpen] = createSignal(true);
  const [tagInput, setTagInput] = createSignal('');
  const [showTagInput, setShowTagInput] = createSignal(false);
  const [bdayEditing, setBdayEditing] = createSignal<string | null>(null);

  let tagInputRef: HTMLInputElement | undefined;
  let bodyRef: HTMLTextAreaElement | undefined;
  let bdayPickerRef: HTMLInputElement | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let promoted = false;

  // Reset on path change
  createEffect(on(() => props.path, () => {
    setLoaded(false);
    setSaveStatus('saved');
    clearTimeout(saveTimer);
    promoted = false;
    setBdayEditing(null);
  }, { defer: false }));

  // Populate state once data loads
  createEffect(() => {
    const c = contact();
    if (!c || loaded()) return;
    setFm(reconcile({
      ...c.frontmatter,
      email: c.frontmatter.email ?? [],
      tel: c.frontmatter.tel ?? [],
      adr: c.frontmatter.adr ?? [],
      tags: c.frontmatter.tags ?? [],
    }));
    setBody(c.body ?? '');
    setLoaded(true);
    // auto-size textarea after render
    setTimeout(resizeBody, 0);
  });

  onCleanup(() => {
    clearTimeout(saveTimer);
    if (saveStatus() === 'unsaved') void invoke('save_contact', { contact: buildContact() });
  });

  // ── Auto-resize textarea ───────────────────────────────────────────────

  function resizeBody() {
    if (!bodyRef) return;
    bodyRef.style.height = 'auto';
    bodyRef.style.height = Math.max(240, bodyRef.scrollHeight) + 'px';
  }

  // ── Save ───────────────────────────────────────────────────────────────

  function buildContact(): Contact {
    return {
      path: props.path,
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

  function scheduleSave() {
    if (!promoted) { promoted = true; promotePreviewByPath(props.path); }
    setSaveStatus('unsaved');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      setSaveStatus('saving');
      try { await invoke('save_contact', { contact: buildContact() }); setSaveStatus('saved'); }
      catch { setSaveStatus('error'); }
    }, 800);
  }

  // ── Field helpers ──────────────────────────────────────────────────────

  function setField<K extends keyof Fm>(key: K, value: Fm[K]) {
    setFm(produce(d => { (d as Record<string, unknown>)[key] = value; }));
    if (key === 'fn' && typeof value === 'string') updateTabTitle(props.path, value || 'Sem nome');
    scheduleSave();
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
    const t = raw.trim().replace(/^#/, '');
    if (!t || fm.tags?.includes(t)) return;
    setFm(produce(d => { d.tags = [...(d.tags ?? []), t]; }));
    setTagInput(''); setShowTagInput(false); scheduleSave();
  }
  function removeTag(tag: string) { setFm(produce(d => { d.tags = d.tags?.filter(t => t !== tag); })); scheduleSave(); }

  // ── Status ─────────────────────────────────────────────────────────────

  const STATUS = {
    saved:   { color: 'var(--green)',  label: '● Salvo' },
    unsaved: { color: 'var(--yellow)', label: '● Modificado' },
    saving:  { color: 'var(--muted)',  label: '◌ Salvando…' },
    error:   { color: 'var(--red)',    label: '● Erro ao salvar' },
  };

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', height: '100%', overflow: 'hidden', background: 'var(--base)' }}>

      <Show when={contact.loading && !loaded()}>
        <div style={{ padding: '32px', color: 'var(--muted)', 'font-size': '12px' }}>Carregando…</div>
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
                  type="text"
                  value={fm['fn'] ?? ''}
                  placeholder="Nome completo"
                  onInput={e => setField('fn', (e.target as HTMLInputElement).value)}
                  style={{
                    width: '100%', background: 'transparent', border: 'none',
                    'font-size': '22px', 'font-weight': '700', color: 'var(--text)',
                    padding: '0', outline: 'none', 'line-height': '1.3',
                  }}
                  onFocus={e => ((e.target as HTMLElement).style.color = 'var(--text)')}
                />
                {/* Cargo · Empresa */}
                <div style={{ display: 'flex', gap: '6px', 'margin-top': '6px', 'align-items': 'center' }}>
                  <input
                    type="text"
                    value={fm.title ?? ''}
                    placeholder="Cargo"
                    onInput={e => setField('title', (e.target as HTMLInputElement).value)}
                    style={{
                      background: 'transparent', border: 'none', outline: 'none',
                      'font-size': '13px', color: 'var(--subtext)', padding: '0',
                      'min-width': '0', flex: '0 1 auto',
                    }}
                    onFocus={e => { const t = e.target as HTMLElement; t.style.background = 'var(--surface0)'; t.style.borderRadius = '3px'; t.style.padding = '1px 4px'; }}
                    onBlur={e => { const t = e.target as HTMLElement; t.style.background = 'transparent'; t.style.padding = '0'; }}
                  />
                  <Show when={fm.title && fm.org}>
                    <span style={{ color: 'var(--surface2)', 'flex-shrink': '0' }}>·</span>
                  </Show>
                  <input
                    type="text"
                    value={fm.org ?? ''}
                    placeholder="Empresa"
                    onInput={e => setField('org', (e.target as HTMLInputElement).value)}
                    style={{
                      background: 'transparent', border: 'none', outline: 'none',
                      'font-size': '13px', color: 'var(--subtext)', padding: '0',
                      'min-width': '0', flex: '1',
                    }}
                    onFocus={e => { const t = e.target as HTMLElement; t.style.background = 'var(--surface0)'; t.style.borderRadius = '3px'; t.style.padding = '1px 4px'; }}
                    onBlur={e => { const t = e.target as HTMLElement; t.style.background = 'transparent'; t.style.padding = '0'; }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── Properties (Obsidian-style) ──────────────────────────── */}
          <div style={{ 'border-bottom': '1px solid var(--surface0)' }}>
            {/* Collapsible header */}
            <button
              onClick={() => setPropsOpen(v => !v)}
              style={{
                display: 'flex', 'align-items': 'center', gap: '6px',
                width: '100%', padding: '7px 16px',
                'font-size': '11px', 'font-weight': '600', color: 'var(--muted)',
                'text-transform': 'uppercase', 'letter-spacing': '0.07em',
                background: 'transparent',
              }}
              onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = 'var(--surface0)')}
              onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
            >
              <span style={{ 'font-size': '9px', transition: 'transform 0.15s', transform: propsOpen() ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
              Propriedades
            </button>

            <Show when={propsOpen()}>
              {/* Email */}
              <PropRow label="email">
                <For each={fm.email ?? []}>
                  {(e, i) => (
                    <div style={{ display: 'flex', 'align-items': 'center' }}>
                      <TypePill value={e.type} options={['work','home','mobile','other']} onChange={v => setEmailField(i(), 'type', v)} />
                      <InlineInput type="email" value={e.value} placeholder="email@exemplo.com" onInput={v => setEmailField(i(), 'value', v)} />
                      <button onClick={() => removeEmail(i())} style={{ color: 'var(--muted)', padding: '2px 4px', 'flex-shrink': '0', opacity: '0.5' }}
                        onMouseEnter={e => ((e.currentTarget as HTMLElement).style.opacity = '1')}
                        onMouseLeave={e => ((e.currentTarget as HTMLElement).style.opacity = '0.5')}
                      >✕</button>
                    </div>
                  )}
                </For>
                <button onClick={addEmail} style={{ 'font-size': '11px', color: 'var(--accent)', opacity: '0.6', padding: '2px 4px', 'align-self': 'flex-start' }}
                  onMouseEnter={e => ((e.currentTarget as HTMLElement).style.opacity = '1')}
                  onMouseLeave={e => ((e.currentTarget as HTMLElement).style.opacity = '0.6')}
                >+ email</button>
              </PropRow>

              {/* Telefone */}
              <PropRow label="tel">
                <For each={fm.tel ?? []}>
                  {(t, i) => (
                    <div style={{ display: 'flex', 'align-items': 'center' }}>
                      <TypePill value={t.type} options={['mobile','work','home','other']} onChange={v => setTelField(i(), 'type', v)} />
                      <InlineInput type="tel" value={t.value} placeholder="+55 11 9 0000-0000" onInput={v => setTelField(i(), 'value', v)} />
                      <button onClick={() => removeTel(i())} style={{ color: 'var(--muted)', padding: '2px 4px', 'flex-shrink': '0', opacity: '0.5' }}
                        onMouseEnter={e => ((e.currentTarget as HTMLElement).style.opacity = '1')}
                        onMouseLeave={e => ((e.currentTarget as HTMLElement).style.opacity = '0.5')}
                      >✕</button>
                    </div>
                  )}
                </For>
                <button onClick={addTel} style={{ 'font-size': '11px', color: 'var(--accent)', opacity: '0.6', padding: '2px 4px', 'align-self': 'flex-start' }}
                  onMouseEnter={e => ((e.currentTarget as HTMLElement).style.opacity = '1')}
                  onMouseLeave={e => ((e.currentTarget as HTMLElement).style.opacity = '0.6')}
                >+ telefone</button>
              </PropRow>

              {/* Endereço */}
              <PropRow label="endereço" alignTop>
                <For each={fm.adr ?? []}>
                  {(a, i) => (
                    <div style={{
                      background: 'var(--mantle)', 'border-radius': '6px',
                      border: '1px solid var(--surface0)', padding: '6px 8px',
                      display: 'flex', 'flex-direction': 'column', gap: '4px',
                      'margin-bottom': '4px',
                    }}>
                      <div style={{ display: 'flex', 'align-items': 'center', gap: '4px' }}>
                        <TypePill value={a.type} options={['home','work','other']} onChange={v => setAdrField(i(), 'type', v)} />
                        <div style={{ flex: '1' }}>
                          <InlineInput value={a.street ?? ''} placeholder="Rua, número, complemento" onInput={v => setAdrField(i(), 'street', v)} />
                        </div>
                        <button onClick={() => removeAdr(i())} style={{ color: 'var(--muted)', padding: '2px 4px', 'flex-shrink': '0', opacity: '0.5' }}
                          onMouseEnter={e => ((e.currentTarget as HTMLElement).style.opacity = '1')}
                          onMouseLeave={e => ((e.currentTarget as HTMLElement).style.opacity = '0.5')}
                        >✕</button>
                      </div>
                      <div style={{ display: 'grid', 'grid-template-columns': '1fr 70px 110px', gap: '4px' }}>
                        <InlineInput value={a.city ?? ''} placeholder="Cidade" onInput={v => setAdrField(i(), 'city', v)} />
                        <InlineInput value={a.region ?? ''} placeholder="Estado" onInput={v => setAdrField(i(), 'region', v)} />
                        <InlineInput value={a.code ?? ''} placeholder="CEP" onInput={v => setAdrField(i(), 'code', v)} />
                      </div>
                      <InlineInput value={a.country ?? ''} placeholder="País" onInput={v => setAdrField(i(), 'country', v)} />
                    </div>
                  )}
                </For>
                <button onClick={addAdr} style={{ 'font-size': '11px', color: 'var(--accent)', opacity: '0.6', padding: '2px 4px', 'align-self': 'flex-start' }}
                  onMouseEnter={e => ((e.currentTarget as HTMLElement).style.opacity = '1')}
                  onMouseLeave={e => ((e.currentTarget as HTMLElement).style.opacity = '0.6')}
                >+ endereço</button>
              </PropRow>

              {/* URL */}
              <PropRow label="url">
                <InlineInput type="url" value={fm.url ?? ''} placeholder="https://..." onInput={v => setField('url', v)} />
              </PropRow>

              {/* Aniversário */}
              <PropRow label="aniversário">
                <div style={{ display: 'flex', 'align-items': 'center', gap: '4px', position: 'relative' }}>
                  <input
                    type="text"
                    value={bdayEditing() ?? isoToDisplay(fm.bday ?? '')}
                    placeholder="dd/mm/aaaa"
                    maxLength={10}
                    onKeyDown={e => {
                      if (e.ctrlKey || e.metaKey || e.altKey) return;
                      const nav = ['Backspace','Delete','ArrowLeft','ArrowRight','Tab','Home','End'].includes(e.key);
                      if (!nav && !/^[0-9\/\-\.]$/.test(e.key)) e.preventDefault();
                    }}
                    onFocus={e => {
                      setBdayEditing(isoToDisplay(fm.bday ?? ''));
                      const t = e.target as HTMLElement;
                      t.style.background = 'var(--surface0)';
                      t.style.outline = '1px solid var(--accent)';
                    }}
                    onInput={e => setBdayEditing((e.target as HTMLInputElement).value)}
                    onBlur={e => {
                      const iso = displayToIso((e.target as HTMLInputElement).value);
                      setBdayEditing(null);
                      setField('bday', isValidBday(iso) ? iso || undefined : undefined);
                      const t = e.target as HTMLElement;
                      t.style.background = 'transparent';
                      t.style.outline = 'none';
                    }}
                    style={{
                      background: 'transparent', border: 'none', outline: 'none',
                      'border-radius': '3px', padding: '2px 4px',
                      'font-size': '13px', color: 'var(--text)', width: '110px',
                    }}
                  />
                  {/* Picker nativo oculto — posicionado abaixo do botão */}
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
                    title="Calendário"
                    onClick={() => (bdayPickerRef as HTMLInputElement & { showPicker?: () => void })?.showPicker?.()}
                    style={{ color: 'var(--muted)', opacity: '0.5', padding: '2px 3px', 'flex-shrink': '0' }}
                    onMouseEnter={e => ((e.currentTarget as HTMLElement).style.opacity = '1')}
                    onMouseLeave={e => ((e.currentTarget as HTMLElement).style.opacity = '0.5')}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="3" y="4" width="18" height="18" rx="2"/>
                      <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
                      <line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                  </button>
                </div>
              </PropRow>

              {/* Tags */}
              <PropRow label="tags" alignTop>
                <div style={{ display: 'flex', 'flex-wrap': 'wrap', gap: '4px', padding: '2px 0' }}>
                  <For each={fm.tags ?? []}>
                    {tag => (
                      <span style={{
                        display: 'inline-flex', 'align-items': 'center', gap: '3px',
                        padding: '1px 8px', 'border-radius': '10px',
                        background: 'var(--surface0)', color: 'var(--accent)',
                        border: '1px solid var(--surface1)', 'font-size': '11px',
                      }}>
                        #{tag}
                        <button onClick={() => removeTag(tag)} style={{ color: 'var(--muted)', 'font-size': '9px', opacity: '0.6' }}
                          onMouseEnter={e => ((e.currentTarget as HTMLElement).style.opacity = '1')}
                          onMouseLeave={e => ((e.currentTarget as HTMLElement).style.opacity = '0.6')}
                        >✕</button>
                      </span>
                    )}
                  </For>
                  <Show
                    when={showTagInput()}
                    fallback={
                      <button onClick={() => { setShowTagInput(true); setTimeout(() => tagInputRef?.focus(), 0); }}
                        style={{ 'font-size': '11px', color: 'var(--accent)', opacity: '0.6', padding: '1px 6px', 'border-radius': '10px', border: '1px dashed var(--surface1)' }}
                        onMouseEnter={e => ((e.currentTarget as HTMLElement).style.opacity = '1')}
                        onMouseLeave={e => ((e.currentTarget as HTMLElement).style.opacity = '0.6')}
                      >+ tag</button>
                    }
                  >
                    <input
                      ref={tagInputRef}
                      type="text"
                      value={tagInput()}
                      placeholder="nova-tag"
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
            </Show>
          </div>

          {/* ── Markdown notes ───────────────────────────────────────── */}
          <div style={{ padding: '20px 24px 40px' }}>
            <textarea
              ref={bodyRef}
              value={body()}
              placeholder="Escreva suas anotações em markdown…"
              onInput={e => {
                setBody((e.target as HTMLTextAreaElement).value);
                resizeBody();
                scheduleSave();
              }}
              style={{
                width: '100%',
                'min-height': '240px',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                resize: 'none',
                'font-size': '14px',
                'line-height': '1.75',
                color: 'var(--text)',
                'font-family': "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
                padding: '0',
                overflow: 'hidden',
              }}
            />
          </div>
        </div>

        {/* ── Status bar ────────────────────────────────────────────── */}
        <div style={{
          'flex-shrink': '0', padding: '3px 16px',
          'border-top': '1px solid var(--surface0)',
          display: 'flex', 'justify-content': 'space-between', 'align-items': 'center',
          background: 'var(--mantle)',
        }}>
          <span style={{ 'font-size': '11px', color: 'var(--muted)' }}>
            {props.path.split('/').pop()}
          </span>
          <span style={{ 'font-size': '11px', color: STATUS[saveStatus()].color }}>
            {STATUS[saveStatus()].label}
          </span>
        </div>

      </Show>
    </div>
  );
}
