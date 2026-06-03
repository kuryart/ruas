import { Show, createSignal } from 'solid-js';
import { useI18n } from '../../i18n/context';
import { activeNote, activeNoteBody } from '../../stores/layoutStore';
import TableOfContents from './TableOfContents';
import BacklinksPanel from './BacklinksPanel';

type Tab = 'toc' | 'backlinks';

/** Global right sidebar: switches between the table of contents and backlinks
 *  of the focused note via a 3-dots menu. Reads the active note from
 *  layoutStore (published by the focused NoteDetail). */
export default function RightPanel() {
  const { t } = useI18n();
  const [tab, setTab] = createSignal<Tab>('toc');
  const [menu, setMenu] = createSignal(false);

  const title = () => (tab() === 'toc' ? t('notes-toc-title') : t('notes-backlinks-title'));

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
            </div>
          </Show>
        </div>
      </div>

      <div style={{ flex: '1 1 0', 'overflow-y': 'auto' }}>
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
      </div>
    </div>
  );
}
