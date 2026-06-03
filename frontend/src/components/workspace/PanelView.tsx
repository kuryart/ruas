import { For, Show, Switch, Match, createSignal, type JSX } from 'solid-js';
import {
  type Tab,
  closeTab,
  firstLeaf,
  lastLeaf,
  focusPanel,
  focusedPanelId,
  panels,
  setActiveTab,
  splitPanel,
  tree,
} from './workspaceStore';
import { leftPanelModule, toggleLeftVisible, rightVisible, toggleRight } from '../../stores/layoutStore';
import { useI18n } from '../../i18n/context';
import ContactsList from '../contacts/ContactsList';
import ContactDetail from '../contacts/ContactDetail';
import NotesList from '../notes/NotesList';
import NoteDetail from '../notes/NoteDetail';

// ── Tab icons ──────────────────────────────────────────────────────────────

function tabIcon(tab: Tab): JSX.Element {
  switch (tab.content.type) {
    case 'contacts-list':
      return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
    case 'contact-detail':
      return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>;
    case 'notes-list':
    case 'note-detail':
      return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>;
    case 'placeholder':
      return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>;
  }
}

// ── Tab content renderer ───────────────────────────────────────────────────

function TabContent(props: { tab: Tab; panelId: string }) {
  return (
    <Switch fallback={<PlaceholderView module="" />}>
      <Match when={props.tab.content.type === 'contacts-list'}>
        <ContactsList />
      </Match>
      <Match when={props.tab.content.type === 'contact-detail'}>
        <ContactDetail path={(props.tab.content as { type: 'contact-detail'; contactPath: string }).contactPath} />
      </Match>
      <Match when={props.tab.content.type === 'notes-list'}>
        <NotesList />
      </Match>
      <Match when={props.tab.content.type === 'note-detail'}>
        <NoteDetail
          path={(props.tab.content as { type: 'note-detail'; notePath: string }).notePath}
          panelId={props.panelId}
        />
      </Match>
      <Match when={props.tab.content.type === 'placeholder'}>
        <PlaceholderView module={(props.tab.content as { type: 'placeholder'; module: string }).module} />
      </Match>
    </Switch>
  );
}

function PlaceholderView(props: { module: string }) {
  const { t } = useI18n();
  const moduleKey = () => props.module ? `module-${props.module}` : '';
  const name = () => moduleKey() ? t(moduleKey()) : t('module-new-tab');
  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', 'align-items': 'center', 'justify-content': 'center', height: '100%', gap: '8px', color: 'var(--muted)' }}>
      <div style={{ 'font-size': '32px', opacity: '0.3' }}>✦</div>
      <div style={{ 'font-size': '15px', color: 'var(--subtext)' }}>{name()}</div>
      <div style={{ 'font-size': '12px' }}>{t('panel-in-development')}</div>
    </div>
  );
}

// ── Split menu ─────────────────────────────────────────────────────────────

function SplitMenu(props: { panelId: string; onClose: () => void }) {
  const { t } = useI18n();
  const items = () => [
    { label: t('panel-split-right'), dir: 'row' as const },
    { label: t('panel-split-below'), dir: 'column' as const },
  ];
  return (
    <div
      style={{
        position: 'absolute', top: '100%', right: '0',
        background: 'var(--mantle)', border: '1px solid var(--surface1)',
        'border-radius': 'var(--radius)', 'z-index': '100',
        'box-shadow': '0 4px 16px rgba(0,0,0,0.4)',
        padding: '4px', 'min-width': '160px',
      }}
      onClick={e => e.stopPropagation()}
    >
      <For each={items()}>
        {item => (
          <button
            style={{
              display: 'flex', 'align-items': 'center', gap: '8px',
              width: '100%', padding: '6px 10px', 'border-radius': '4px',
              'font-size': '12px', color: 'var(--text)',
            }}
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = 'var(--surface0)')}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
            onClick={() => { splitPanel(props.panelId, item.dir); props.onClose(); }}
          >
            {item.label}
          </button>
        )}
      </For>
    </div>
  );
}

// ── PanelView ──────────────────────────────────────────────────────────────

export default function PanelView(props: { panelId: string }) {
  const { t } = useI18n();
  const [showMenu, setShowMenu] = createSignal(false);
  const panel = () => panels[props.panelId];
  const isFocused = () => focusedPanelId() === props.panelId;
  const activeTab = () => panel()?.tabs.find(t => t.id === panel()?.activeTabId);
  // The drawer toggles live once, in the leftmost / rightmost panel's tab bar.
  const isLeftmost = () => firstLeaf(tree()) === props.panelId;
  const isRightmost = () => lastLeaf(tree()) === props.panelId;

  return (
    <div
      class="panel"
      classList={{ 'panel-focused': isFocused() }}
      onClick={() => focusPanel(props.panelId)}
    >
      {/* Tab bar */}
      <div class="tabbar">
        {/* Left-drawer toggle (only on the leftmost panel) */}
        <Show when={isLeftmost()}>
          <button
            class="panel-toggle-btn tabbar-left-toggle"
            classList={{ active: !!leftPanelModule() }}
            title={t('left-panel-toggle')}
            onClick={e => { e.stopPropagation(); toggleLeftVisible(); }}
          >
            ⊞
          </button>
        </Show>

        {/* Tabs */}
        <div class="tab-list">
          <For each={panel()?.tabs ?? []}>
            {tab => {
              const isActive = () => panel()?.activeTabId === tab.id;
              return (
                <div
                  class="tab"
                  classList={{ 'tab-active': isActive(), 'tab-preview': !!tab.preview }}
                  onClick={() => setActiveTab(props.panelId, tab.id)}
                >
                  <span class="tab-icon">{tabIcon(tab)}</span>
                  <span class="truncate tab-title">{tab.title}</span>
                  <button
                    class="tab-close"
                    onClick={e => { e.stopPropagation(); closeTab(props.panelId, tab.id); }}
                  >
                    ✕
                  </button>
                </div>
              );
            }}
          </For>
        </div>

        {/* Split button */}
        <div class="panel-split">
          <button
            class="panel-split-btn"
            title={t('panel-split-title')}
            onClick={e => { e.stopPropagation(); setShowMenu(v => !v); }}
          >
            ⊞
          </button>
          <Show when={showMenu()}>
            <SplitMenu panelId={props.panelId} onClose={() => setShowMenu(false)} />
          </Show>
        </div>

        {/* Right-panel (outline / backlinks) toggle, only on the rightmost panel */}
        <Show when={isRightmost()}>
          <button
            class="panel-toggle-btn tabbar-right-toggle"
            classList={{ active: rightVisible() }}
            title={t('notes-toggle-panel')}
            onClick={e => { e.stopPropagation(); toggleRight(); }}
          >
            ⊟
          </button>
        </Show>
      </div>

      {/* Content */}
      <div style={{ flex: '1 1 0', overflow: 'hidden' }}>
        <Show when={activeTab()} fallback={<PlaceholderView module="" />}>
          {tab => <TabContent tab={tab()} panelId={props.panelId} />}
        </Show>
      </div>
    </div>
  );
}
