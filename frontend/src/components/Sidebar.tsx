import { type JSX } from 'solid-js';
import { focusedPanelId, openContactsList, openModule } from './workspace/workspaceStore';

// ── SVG icons (24×24, stroke-based) ───────────────────────────────────────

const icons: Record<string, JSX.Element> = {
  contacts: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  agenda: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <path d="M16 2v4M8 2v4M3 10h18"/>
      <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <path d="M16 2v4M8 2v4M3 10h18"/>
      <circle cx="12" cy="16" r="2" fill="currentColor" stroke="none"/>
    </svg>
  ),
  notes: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="8" y1="13" x2="16" y2="13"/>
      <line x1="8" y1="17" x2="13" y2="17"/>
    </svg>
  ),
  email: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2"/>
      <polyline points="2,4 12,13 22,4"/>
    </svg>
  ),
  projects: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
  ),
};

const modules = [
  { id: 'contacts', label: 'Contatos' },
  { id: 'agenda',   label: 'Agenda'   },
  { id: 'calendar', label: 'Calendário' },
  { id: 'notes',    label: 'Notas'    },
  { id: 'email',    label: 'Email'    },
  { id: 'projects', label: 'Projetos' },
] as const;

type ModuleId = (typeof modules)[number]['id'];

function handleOpen(id: ModuleId, label: string) {
  if (id === 'contacts') openContactsList();
  else openModule(id, label);
}

// ── Component ──────────────────────────────────────────────────────────────

export default function Sidebar() {
  return (
    <div
      style={{
        width: 'var(--sidebar-w)', 'flex-shrink': '0',
        display: 'flex', 'flex-direction': 'column', 'align-items': 'center',
        'padding-top': '8px', gap: '2px',
        background: 'var(--crust)',
        'border-right': '1px solid var(--surface0)',
        'z-index': '10',
      }}
    >
      {modules.map(m => (
        <button
          title={m.label}
          onClick={() => handleOpen(m.id, m.label)}
          style={{
            width: '36px', height: '36px',
            display: 'flex', 'align-items': 'center', 'justify-content': 'center',
            'border-radius': 'var(--radius)',
            color: 'var(--overlay0)',
            transition: 'color 0.15s, background 0.15s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.color = 'var(--text)';
            (e.currentTarget as HTMLElement).style.background = 'var(--surface0)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.color = 'var(--overlay0)';
            (e.currentTarget as HTMLElement).style.background = 'transparent';
          }}
        >
          <div style={{ width: '20px', height: '20px' }}>
            {icons[m.id]}
          </div>
        </button>
      ))}
    </div>
  );
}
