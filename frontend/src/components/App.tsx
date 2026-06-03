import { Show, createSignal } from 'solid-js';
import { I18nProvider } from '../i18n/context';
import { detectLocale } from '../i18n/detect';
import { settingsOpen } from '../stores/settingsStore';
import { canRedo, canUndo, redoNext, undoLast } from '../stores/historyStore';
import { togglePalette } from '../stores/paletteStore';
import { loadVaultAppearance } from '../stores/appearanceStore'; // also activates theme/accent/font injection
import { activeVault, setActiveVault, type VaultInfo } from '../stores/vaultStore';
import { invoke } from '../utils/api';
import SettingsModal from './settings/SettingsModal';
import CommandPalette from './notes/CommandPalette';
import FuzzyPopup from './notes/FuzzyPopup';
import Sidebar from './Sidebar';
import LeftPanel from './LeftPanel';
import RightPanel from './notes/RightPanel';
import VaultScreen from './vault/VaultScreen';
import Workspace from './workspace/Workspace';
import { leftPanelModule, rightVisible } from '../stores/layoutStore';

function handleGlobalKeyDown(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey)) return;

  // Ctrl/Cmd+P → quick-open palette (works regardless of focus).
  if (e.key === 'p' && !e.shiftKey && !e.altKey) {
    e.preventDefault();
    togglePalette();
    return;
  }

  const target = e.target as HTMLElement;
  // Native undo for text inputs
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
  // CM6 handles its own undo stack
  if (target.closest?.('.cm-editor')) return;

  if (e.key === 'z' && !e.shiftKey && canUndo()) {
    e.preventDefault();
    void undoLast();
  } else if ((e.key === 'z' && e.shiftKey || e.key === 'y') && canRedo()) {
    e.preventDefault();
    void redoNext();
  }
}

export default function App() {
  const [ready, setReady] = createSignal(false);

  // Set the active vault and load its user themes/snippets.
  const activateVault = (v: VaultInfo | null) => {
    setActiveVault(v);
    if (v) void loadVaultAppearance();
  };

  invoke<VaultInfo | null>('get_active_vault')
    .then(v => { activateVault(v); setReady(true); })
    .catch(() => setReady(true));

  return (
    <I18nProvider locale={detectLocale()}>
      <Show when={ready()}>

        {/* Settings modal — rendered above everything when open */}
        <Show when={settingsOpen()}>
          <SettingsModal />
        </Show>

        {/* Global quick-open palette (Ctrl+P) */}
        <CommandPalette />

        {/* Global fuzzy-find popup (wiki links, slash commands, …) */}
        <FuzzyPopup />

        <Show
          when={activeVault()}
          fallback={<VaultScreen onVaultOpen={v => activateVault(v)} />}
        >
          <div
            class="app-shell"
            style={{ display: 'flex', width: '100%', height: '100%', overflow: 'hidden', background: 'var(--base)' }}
            onKeyDown={handleGlobalKeyDown}
          >
            <Sidebar />
            <Show when={leftPanelModule()}>
              <LeftPanel />
            </Show>
            <Workspace />
            <Show when={rightVisible()}>
              <RightPanel />
            </Show>
          </div>
        </Show>

      </Show>
    </I18nProvider>
  );
}
