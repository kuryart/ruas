import { For, Show, createEffect, createResource, createSignal } from 'solid-js';
import { invoke } from '../../utils/api';
import { navigateToContact, openContactPermanent } from '../workspace/workspaceStore';

interface ContactMeta {
  path: string;
  display_name: string;
  initials: string;
  org: string | null;
  primary_email: string | null;
  tags: string[] | null;
}

interface Contact {
  path: string;
  frontmatter: { fn?: string; [k: string]: unknown };
  body: string;
}

function avatarColor(initials: string): string {
  const palette = ['#89b4fa', '#a6e3a1', '#fab387', '#f5c2e7', '#94e2d5', '#cba6f7', '#f9e2af', '#f38ba8'];
  let h = 0;
  for (const c of initials) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return palette[h % palette.length];
}

export default function ContactsList() {
  const [query, setQuery] = createSignal('');
  const [contacts, { refetch }] = createResource<ContactMeta[]>(() =>
    invoke<ContactMeta[]>('list_contacts'),
  );

  // ── New contact form state ─────────────────────────────────────────────
  const [showForm, setShowForm] = createSignal(false);
  const [newGiven, setNewGiven] = createSignal('');
  const [newFamily, setNewFamily] = createSignal('');
  const [creating, setCreating] = createSignal(false);
  let givenRef: HTMLInputElement | undefined;

  createEffect(() => {
    if (showForm()) setTimeout(() => givenRef?.focus(), 0);
  });

  function openForm() {
    setNewGiven('');
    setNewFamily('');
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
  }

  async function submitCreate(e: Event) {
    e.preventDefault();
    const given = newGiven().trim();
    if (!given || creating()) return;
    setCreating(true);
    try {
      const contact = await invoke<Contact>('create_contact', {
        givenName: given,
        familyName: newFamily().trim(),
      });
      setShowForm(false);
      await refetch();
      const displayName = (contact.frontmatter['fn'] as string | undefined)
        ?? `${given} ${newFamily()}`.trim();
      openContactPermanent(contact.path, displayName);
    } finally {
      setCreating(false);
    }
  }

  // ── Filtered list ──────────────────────────────────────────────────────
  const filtered = () => {
    const q = query().toLowerCase();
    return (contacts() ?? []).filter(c =>
      !q ||
      c.display_name.toLowerCase().includes(q) ||
      (c.org ?? '').toLowerCase().includes(q) ||
      (c.primary_email ?? '').toLowerCase().includes(q),
    );
  };

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', height: '100%', overflow: 'hidden' }}>
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div style={{ padding: '12px 14px 8px', 'flex-shrink': '0', 'border-bottom': '1px solid var(--surface0)' }}>
        <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', 'margin-bottom': '8px' }}>
          <span style={{ 'font-size': '13px', 'font-weight': '600', color: 'var(--text)' }}>Contatos</span>
          <button
            title="Novo contato"
            onClick={openForm}
            style={{
              color: 'var(--accent)', 'font-size': '18px', 'line-height': '1',
              opacity: '0.7', padding: '0 2px',
            }}
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.opacity = '1')}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.opacity = '0.7')}
          >
            +
          </button>
        </div>

        {/* Search bar */}
        <div style={{
          display: 'flex', 'align-items': 'center', gap: '6px',
          background: 'var(--surface0)', 'border-radius': 'var(--radius)', padding: '5px 10px',
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2.5">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            type="text"
            placeholder="Buscar contatos..."
            value={query()}
            onInput={e => setQuery((e.target as HTMLInputElement).value)}
            style={{ flex: '1', 'font-size': '12px', color: 'var(--text)' }}
          />
          <Show when={query()}>
            <button onClick={() => setQuery('')} style={{ color: 'var(--muted)', 'font-size': '12px' }}>✕</button>
          </Show>
        </div>

        {/* ── Inline new-contact form ─────────────────────────────────── */}
        <Show when={showForm()}>
          <form
            onSubmit={submitCreate}
            style={{
              display: 'flex', gap: '6px', 'align-items': 'center',
              'margin-top': '8px',
              background: 'var(--surface0)', 'border-radius': 'var(--radius)',
              padding: '6px 8px', border: '1px solid var(--accent)',
            }}
          >
            <input
              ref={givenRef}
              type="text"
              placeholder="Nome"
              value={newGiven()}
              onInput={e => setNewGiven((e.target as HTMLInputElement).value)}
              onKeyDown={e => e.key === 'Escape' && cancelForm()}
              style={{
                flex: '1', 'min-width': '0', padding: '3px 6px',
                background: 'var(--base)', border: '1px solid var(--surface1)',
                'border-radius': '4px', 'font-size': '12px', color: 'var(--text)',
              }}
            />
            <input
              type="text"
              placeholder="Sobrenome"
              value={newFamily()}
              onInput={e => setNewFamily((e.target as HTMLInputElement).value)}
              onKeyDown={e => e.key === 'Escape' && cancelForm()}
              style={{
                flex: '1', 'min-width': '0', padding: '3px 6px',
                background: 'var(--base)', border: '1px solid var(--surface1)',
                'border-radius': '4px', 'font-size': '12px', color: 'var(--text)',
              }}
            />
            <button
              type="submit"
              disabled={creating() || !newGiven().trim()}
              style={{
                padding: '3px 8px', 'border-radius': '4px', 'font-size': '12px',
                background: 'var(--accent)', color: 'var(--crust)', 'font-weight': '600',
                opacity: creating() || !newGiven().trim() ? '0.5' : '1',
              }}
            >
              {creating() ? '…' : '✓'}
            </button>
            <button
              type="button"
              onClick={cancelForm}
              style={{ padding: '3px 6px', 'border-radius': '4px', 'font-size': '12px', color: 'var(--muted)' }}
            >
              ✕
            </button>
          </form>
        </Show>
      </div>

      {/* ── Contact list ──────────────────────────────────────────────── */}
      <div style={{ flex: '1 1 0', 'overflow-y': 'auto', padding: '4px 0' }}>
        <Show
          when={!contacts.loading}
          fallback={<div style={{ padding: '20px', 'text-align': 'center', color: 'var(--muted)', 'font-size': '12px' }}>Carregando…</div>}
        >
          <Show
            when={filtered().length > 0}
            fallback={
              <div style={{ padding: '20px', 'text-align': 'center', color: 'var(--muted)', 'font-size': '12px' }}>
                {query() ? 'Nenhum resultado' : 'Nenhum contato — clique em + para criar'}
              </div>
            }
          >
            <For each={filtered()}>
              {contact => {
                const color = avatarColor(contact.initials);
                return (
                  <div
                    style={{ display: 'flex', 'align-items': 'center', gap: '10px', padding: '7px 14px', cursor: 'pointer' }}
                    onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = 'var(--surface0)')}
                    onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                    onClick={e => {
                      if (e.ctrlKey || e.metaKey) {
                        openContactPermanent(contact.path, contact.display_name);
                      } else {
                        navigateToContact(contact.path, contact.display_name);
                      }
                    }}
                  >
                    {/* Avatar */}
                    <div style={{
                      width: '34px', height: '34px', 'border-radius': '50%', 'flex-shrink': '0',
                      background: `${color}22`, border: `1px solid ${color}55`,
                      display: 'flex', 'align-items': 'center', 'justify-content': 'center',
                      'font-size': '12px', 'font-weight': '600', color,
                    }}>
                      {contact.initials || '?'}
                    </div>
                    {/* Info */}
                    <div style={{ flex: '1', 'min-width': '0' }}>
                      <div class="truncate" style={{ 'font-size': '13px', 'font-weight': '500', color: 'var(--text)' }}>
                        {contact.display_name}
                      </div>
                      <Show when={contact.org ?? contact.primary_email}>
                        <div class="truncate" style={{ 'font-size': '11px', color: 'var(--muted)', 'margin-top': '1px' }}>
                          {contact.org ?? contact.primary_email}
                        </div>
                      </Show>
                    </div>
                  </div>
                );
              }}
            </For>
          </Show>
        </Show>
      </div>
    </div>
  );
}
