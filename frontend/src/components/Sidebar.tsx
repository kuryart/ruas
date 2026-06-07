import { type JSX } from 'solid-js';
import { useI18n } from '../i18n/context';
import { setSettingsOpen } from '../stores/settingsStore';
import { leftPanelModule, toggleLeftPanel } from '../stores/layoutStore';
import { openModule } from './workspace/workspaceStore';

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
  finances: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <line x1="12" y1="1" x2="12" y2="23"/>
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    </svg>
  ),
  projects: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
  ),
};

const MODULE_IDS = ['contacts', 'agenda', 'calendar', 'notes', 'email', 'finances', 'projects'] as const;
type ModuleId = (typeof MODULE_IDS)[number];

// Modules with a dedicated left-drawer browser toggle the drawer; the rest open
// directly in the workspace.
const DRAWER_MODULES = new Set<ModuleId>(['notes', 'contacts']);

function handleOpen(id: ModuleId, label: string) {
  if (DRAWER_MODULES.has(id)) toggleLeftPanel(id);
  else openModule(id, label);
}

// ── Sidebar button ─────────────────────────────────────────────────────────

function SidebarBtn(props: {
  title: string;
  active?: boolean;
  onClick: () => void;
  children: JSX.Element;
}) {
  return (
    <button class="sidebar-btn" classList={{ active: props.active }} title={props.title} onClick={props.onClick}>
      <div>{props.children}</div>
    </button>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export default function Sidebar() {
  const { t } = useI18n();

  return (
    <div class="sidebar">
      {/* ── Module buttons ──────────────────────────────────────────── */}
      {MODULE_IDS.map(id => {
        const label = () => t(`module-${id}`);
        return (
          <SidebarBtn title={label()} active={leftPanelModule() === id} onClick={() => handleOpen(id, label())}>
            {icons[id]}
          </SidebarBtn>
        );
      })}

      {/* ── Spacer ──────────────────────────────────────────────────── */}
      <div style={{ flex: '1' }} />

      {/* ── Divider ─────────────────────────────────────────────────── */}
      <div style={{
        width: '22px', height: '1px',
        background: 'var(--surface0)',
        'margin-bottom': '2px',
      }} />

      {/* ── Settings button ─────────────────────────────────────────── */}
      <SidebarBtn title={t('settings-title')} onClick={() => setSettingsOpen(true)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </SidebarBtn>
    </div>
  );
}
