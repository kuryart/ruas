import { type Component, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { useI18n } from '../i18n/context';
import { leftPanelModule } from '../stores/layoutStore';
import { clearVault } from '../stores/vaultStore';
import NotesList from './notes/NotesList';
import ContactsList from './contacts/ContactsList';

// Module-specific drawer bodies. Modules without a dedicated browser fall back
// to a placeholder (they still open in the workspace via the sidebar).
const BODIES: Record<string, Component> = {
  notes: NotesList,
  contacts: ContactsList,
};

/** Persistent left drawer (Obsidian-style). Shows the active module's browser
 *  (file tree for notes, list for contacts, …) with a "Change Vault" footer.
 *  Show/hide is driven from the toolbar toggle and sidebar icons — never from a
 *  control inside the drawer (which would hide its own toggle). */
export default function LeftPanel() {
  const { t } = useI18n();
  const body = () => BODIES[leftPanelModule() ?? ''];

  return (
    <div class="left-panel">
      <div class="left-panel-body">
        <Show
          when={body()}
          fallback={
            <div style={{ padding: '20px', 'text-align': 'center', color: 'var(--muted)', 'font-size': '12px' }}>
              {t('left-panel-empty')}
            </div>
          }
        >
          <Dynamic component={body()} />
        </Show>
      </div>

      <div class="left-panel-footer">
        <button class="change-vault-btn" onClick={clearVault}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ 'flex-shrink': '0' }}>
            <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-3H5a2 2 0 0 0-2 2z"/>
          </svg>
          <span class="truncate">{t('change-vault')}</span>
        </button>
      </div>
    </div>
  );
}
