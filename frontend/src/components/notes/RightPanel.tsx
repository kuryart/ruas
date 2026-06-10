import { Show, createSignal } from 'solid-js';
import { useI18n } from '../../i18n/context';
import { activeNote, activeNoteBody } from '../../stores/layoutStore';
import TableOfContents from './TableOfContents';
import BacklinksPanel from './BacklinksPanel';
import { plugins } from '../../stores/pluginsStore';
import { invoke } from '../../utils/api';

type Tab = 'toc' | 'backlinks' | 'plugins';

/** Global right sidebar: switches between the table of contents, backlinks
 *  of the focused note, and plugin actions via a 3-dots menu. */
export default function RightPanel() {
  const { t } = useI18n();
  const [tab, setTab] = createSignal<Tab>('toc');
  const [menu, setMenu] = createSignal(false);
  const [importing, setImporting] = createSignal(false);
  const [importResult, setImportResult] = createSignal<string | null>(null);

  const title = () => {
    switch (tab()) {
      case 'toc': return t('notes-toc-title');
      case 'backlinks': return t('notes-backlinks-title');
      case 'plugins': return 'Plugin Actions';
    }
  };

  const MenuItem = (p: { value: Tab; label: string }) => (
    <button
      class="right-panel-menu-item"
      classList={{ active: tab() === p.value }}
      onClick={() => { setTab(p.value); setMenu(false); }}
    >
      <span style={{ color: 'var(--accent)', visibility: tab() === p.value ? 'visible' : 'hidden' }}>●</span>
      {p.label}
    </button>
  );

  // Find enabled native plugins that have import-like commands
  const actionPlugins = () =>
    (plugins() ?? []).filter(
      p => p.trust === 'native' && p.enabled && p.id === 'com.ruas.vcf-importer',
    );

  async function runVcfImport() {
    setImporting(true);
    setImportResult(null);
    try {
      // Open folder picker for .vcf files
      const vcfDir = await invoke<string | null>('select_folder', {});
      if (!vcfDir) {
        setImporting(false);
        return;
      }
      // Get the vault's contacts directory
      const contactsDir = await invoke<string>('get_contacts_dir');
      // Run the plugin
      const result = await invoke<{ imported: number }>('invoke_module', {
        moduleId: 'com.ruas.vcf-importer',
        command: 'import',
        args: { vcf_dir: vcfDir, contacts_dir: contactsDir },
      });
      setImportResult(`✓ Imported ${result.imported} contact(s).`);
    } catch (e) {
      setImportResult(`✗ Error: ${String(e)}`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div class="right-panel" style={{
      width: '240px', 'flex-shrink': '0', height: '100%',
      display: 'flex', 'flex-direction': 'column',
      'border-left': '1px solid var(--surface0)', background: 'var(--mantle)',
    }}>
      <div class="right-panel-header">
        <span class="right-panel-title">{title()}</span>
        <div style={{ position: 'relative' }}>
          <button class="right-panel-menu-btn" title={t('notes-panel-switch')} onClick={() => setMenu(v => !v)}>
            ⋯
          </button>
          <Show when={menu()}>
            <div class="right-panel-menu">
              <MenuItem value="toc" label={t('notes-toc-title')} />
              <MenuItem value="backlinks" label={t('notes-backlinks-title')} />
              <Show when={actionPlugins().length > 0}>
                <MenuItem value="plugins" label="Plugins" />
              </Show>
            </div>
          </Show>
        </div>
      </div>

      <div style={{ flex: '1 1 0', 'overflow-y': 'auto' }}>
        {/* TOC / Backlinks */}
        <Show when={tab() !== 'plugins'}>
          <Show
            when={activeNote()}
            keyed
            fallback={
              <div style={{ padding: '20px', 'text-align': 'center', color: 'var(--muted)', 'font-size': '12px' }}>
                {t('notes-panel-empty')}
              </div>
            }
          >
            {note => (
              <Show when={tab() === 'toc'} fallback={<BacklinksPanel path={note.path} />}>
                <TableOfContents body={activeNoteBody()} onJump={note.onJump} />
              </Show>
            )}
          </Show>
        </Show>

        {/* Plugin actions */}
        <Show when={tab() === 'plugins'}>
          <div style={{ padding: '16px 14px' }}>
            <Show when={actionPlugins().length > 0}
              fallback={
                <p style={{ 'font-size': '12px', color: 'var(--muted)' }}>
                  No plugins with actions are enabled. Enable plugins in Settings → Plugins.
                </p>
              }
            >
              <div style={{ display: 'flex', 'flex-direction': 'column', gap: '12px' }}>
                <div class="fm-section-label">VCF Importer</div>
                <p style={{ 'font-size': '12px', color: 'var(--subtext)', 'line-height': '1.5' }}>
                  Select a directory containing .vcf files to import contacts into the vault.
                </p>
                <button
                  class="fm-add-btn"
                  style={{ 'align-self': 'flex-start' }}
                  onClick={runVcfImport}
                  disabled={importing()}
                >
                  {importing() ? 'Importing…' : 'Import VCF files'}
                </button>
                <Show when={importResult()}>
                  <p style={{
                    'font-size': '12px',
                    color: importResult()!.startsWith('✓') ? 'var(--green)' : 'var(--red)',
                    'line-height': '1.5',
                  }}>
                    {importResult()}
                  </p>
                </Show>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
