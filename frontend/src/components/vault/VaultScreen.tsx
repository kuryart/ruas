import { Show, createSignal } from 'solid-js';
import { useI18n } from '../../i18n/context';
import { invoke } from '../../utils/api';

interface VaultInfo {
  path: string;
  name: string;
}

interface Props {
  onVaultOpen: (vault: VaultInfo) => void;
}

// ── Shared styles ──────────────────────────────────────────────────────────

const btnBase: Record<string, string> = {
  display: 'flex',
  'align-items': 'center',
  'justify-content': 'center',
  gap: '8px',
  width: '100%',
  padding: '11px 16px',
  'border-radius': 'var(--radius)',
  'font-size': '13px',
  'font-weight': '600',
  transition: 'opacity 0.15s, background 0.15s',
  cursor: 'pointer',
};

const primaryStyle: Record<string, string> = {
  ...btnBase,
  background: 'var(--accent)',
  color: 'var(--crust)',
};

const secondaryStyle: Record<string, string> = {
  ...btnBase,
  background: 'var(--surface0)',
  color: 'var(--text)',
};

const ghostStyle: Record<string, string> = {
  padding: '7px 12px',
  'border-radius': 'var(--radius)',
  'font-size': '12px',
  'font-weight': '500',
  background: 'var(--surface1)',
  color: 'var(--text)',
  'flex-shrink': '0',
  cursor: 'pointer',
};

const inputStyle: Record<string, string> = {
  width: '100%',
  padding: '8px 10px',
  background: 'var(--surface0)',
  border: '1px solid var(--surface1)',
  'border-radius': 'var(--radius)',
  'font-size': '13px',
  color: 'var(--text)',
};

const labelStyle: Record<string, string> = {
  display: 'block',
  'font-size': '11px',
  'font-weight': '500',
  color: 'var(--muted)',
  'margin-bottom': '6px',
  'text-transform': 'uppercase',
  'letter-spacing': '0.5px',
};

// ── Component ──────────────────────────────────────────────────────────────

export default function VaultScreen(props: Props) {
  const { t } = useI18n();

  const [mode, setMode] = createSignal<'home' | 'new'>('home');
  const [vaultName, setVaultName] = createSignal('');
  const [folderPath, setFolderPath] = createSignal('');
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  let nameRef: HTMLInputElement | undefined;

  function enterNewMode() {
    setError('');
    setFolderPath('');
    setVaultName(t('vault-form-name-placeholder'));
    setMode('new');
    setTimeout(() => nameRef?.select(), 0);
  }

  function cancelNew() {
    setMode('home');
    setError('');
  }

  async function pickFolder(): Promise<string | null> {
    try {
      return await invoke<string | null>('select_folder');
    } catch {
      return null;
    }
  }

  async function handlePickForNew() {
    const path = await pickFolder();
    if (path) setFolderPath(path);
  }

  async function handleCreate(e: Event) {
    e.preventDefault();
    const name = vaultName().trim();
    if (!name || !folderPath() || loading()) return;
    setError('');
    setLoading(true);
    try {
      const vault = await invoke<VaultInfo>('new_vault', { path: folderPath(), name });
      props.onVaultOpen(vault);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleOpen() {
    setError('');
    const path = await pickFolder();
    if (!path) return;
    setLoading(true);
    try {
      const vault = await invoke<VaultInfo>('open_vault', { path });
      props.onVaultOpen(vault);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', 'flex-direction': 'column',
      'align-items': 'center', 'justify-content': 'center',
      background: 'var(--base)',
      gap: '28px',
    }}>

      {/* ── Logo ────────────────────────────────────────────────────────── */}
      <div style={{ 'text-align': 'center' }}>
        <div style={{
          'font-size': '28px', 'font-weight': '700',
          color: 'var(--text)', 'letter-spacing': '-0.5px',
        }}>
          {t('vault-title')}
        </div>
        <div style={{ 'font-size': '12px', color: 'var(--muted)', 'margin-top': '4px' }}>
          {t('vault-subtitle')}
        </div>
      </div>

      {/* ── Card ────────────────────────────────────────────────────────── */}
      <div style={{
        width: '360px',
        background: 'var(--mantle)',
        'border-radius': '12px',
        border: '1px solid var(--surface0)',
        padding: '28px',
        display: 'flex',
        'flex-direction': 'column',
        gap: '12px',
      }}>

        {/* ── Home mode ─────────────────────────────────────────────────── */}
        <Show when={mode() === 'home'}>
          <button
            style={primaryStyle}
            onClick={enterNewMode}
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.opacity = '0.85')}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.opacity = '1')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              <line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>
            </svg>
            {t('vault-btn-new')}
          </button>

          <button
            style={secondaryStyle}
            disabled={loading()}
            onClick={handleOpen}
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = 'var(--surface1)')}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = 'var(--surface0)')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            {loading() ? t('vault-form-waiting') : t('vault-btn-open')}
          </button>
        </Show>

        {/* ── New vault form ─────────────────────────────────────────────── */}
        <Show when={mode() === 'new'}>
          <form onSubmit={handleCreate} style={{ display: 'flex', 'flex-direction': 'column', gap: '14px' }}>

            <div>
              <label style={labelStyle}>{t('vault-form-name-label')}</label>
              <input
                ref={nameRef}
                type="text"
                value={vaultName()}
                onInput={e => setVaultName(e.currentTarget.value)}
                placeholder={t('vault-form-name-placeholder')}
                style={inputStyle}
                onFocus={e => ((e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)')}
                onBlur={e => ((e.currentTarget as HTMLElement).style.borderColor = 'var(--surface1)')}
              />
            </div>

            <div>
              <label style={labelStyle}>{t('vault-form-folder-label')}</label>
              <div style={{ display: 'flex', gap: '8px', 'align-items': 'center' }}>
                <div style={{
                  flex: '1', padding: '8px 10px',
                  background: 'var(--surface0)',
                  border: '1px solid var(--surface1)',
                  'border-radius': 'var(--radius)',
                  'font-size': '12px',
                  color: folderPath() ? 'var(--text)' : 'var(--muted)',
                  overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap',
                  'min-width': '0',
                }}>
                  {folderPath() || t('vault-form-folder-empty')}
                </div>
                <button
                  type="button"
                  style={ghostStyle}
                  onClick={handlePickForNew}
                  onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = 'var(--surface2)')}
                  onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = 'var(--surface1)')}
                >
                  {t('vault-form-choose')}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', 'margin-top': '4px' }}>
              <button
                type="button"
                onClick={cancelNew}
                style={{ ...ghostStyle, flex: '1' }}
                onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = 'var(--surface2)')}
                onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = 'var(--surface1)')}
              >
                {t('vault-form-cancel')}
              </button>
              <button
                type="submit"
                disabled={!folderPath() || !vaultName().trim() || loading()}
                style={{
                  ...primaryStyle,
                  flex: '1',
                  opacity: !folderPath() || !vaultName().trim() || loading() ? '0.45' : '1',
                }}
              >
                {loading() ? t('vault-form-creating') : t('vault-form-create')}
              </button>
            </div>

          </form>
        </Show>

        {/* ── Error ─────────────────────────────────────────────────────── */}
        <Show when={error()}>
          <div style={{
            'font-size': '12px',
            color: 'var(--red)',
            background: 'color-mix(in srgb, var(--red) 10%, transparent)',
            padding: '9px 12px',
            'border-radius': 'var(--radius)',
            border: '1px solid color-mix(in srgb, var(--red) 30%, transparent)',
            'line-height': '1.5',
          }}>
            {error()}
          </div>
        </Show>

      </div>
    </div>
  );
}
