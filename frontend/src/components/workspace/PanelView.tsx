import { For, Show, Switch, Match, createSignal, type JSX } from 'solid-js';
import {
  type Tab,
  closeTab,
  focusPanel,
  focusedPanelId,
  panels,
  setActiveTab,
  splitPanel,
} from './workspaceStore';
import ContactsList from '../contacts/ContactsList';
import ContactDetail from '../contacts/ContactDetail';

// ── Tab icons ──────────────────────────────────────────────────────────────

function tabIcon(tab: Tab): JSX.Element {
  switch (tab.content.type) {
    case 'contacts-list':
      return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
    case 'contact-detail':
      return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>;
    case 'placeholder':
      return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>;
  }
}

// ── Tab content renderer ───────────────────────────────────────────────────

function TabContent(props: { tab: Tab }) {
  return (
    <Switch fallback={<PlaceholderView module="" />}>
      <Match when={props.tab.content.type === 'contacts-list'}>
        <ContactsList />
      </Match>
      <Match when={props.tab.content.type === 'contact-detail'}>
        <ContactDetail path={(props.tab.content as { type: 'contact-detail'; contactPath: string }).contactPath} />
      </Match>
      <Match when={props.tab.content.type === 'placeholder'}>
        <PlaceholderView module={(props.tab.content as { type: 'placeholder'; module: string }).module} />
      </Match>
    </Switch>
  );
}

function PlaceholderView(props: { module: string }) {
  const labels: Record<string, string> = {
    agenda: 'Agenda',
    calendar: 'Calendar',
    notes: 'Notes',
    email: 'Email',
    projects: 'Projects',
  };
  const name = labels[props.module] ?? props.module ?? 'New tab';
  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', 'align-items': 'center', 'justify-content': 'center', height: '100%', gap: '8px', color: 'var(--muted)' }}>
      <div style={{ 'font-size': '32px', opacity: '0.3' }}>✦</div>
      <div style={{ 'font-size': '15px', color: 'var(--subtext)' }}>{name}</div>
      <div style={{ 'font-size': '12px' }}>Em desenvolvimento</div>
    </div>
  );
}

// ── Split menu ─────────────────────────────────────────────────────────────

function SplitMenu(props: { panelId: string; onClose: () => void }) {
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
      {[
        ['Dividir à direita', 'row'],
        ['Dividir abaixo', 'column'],
      ].map(([label, dir]) => (
        <button
          style={{
            display: 'flex', 'align-items': 'center', gap: '8px',
            width: '100%', padding: '6px 10px', 'border-radius': '4px',
            'font-size': '12px', color: 'var(--text)',
          }}
          onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = 'var(--surface0)')}
          onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
          onClick={() => { splitPanel(props.panelId, dir as 'row' | 'column'); props.onClose(); }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ── PanelView ──────────────────────────────────────────────────────────────

export default function PanelView(props: { panelId: string }) {
  const [showMenu, setShowMenu] = createSignal(false);
  const panel = () => panels[props.panelId];
  const isFocused = () => focusedPanelId() === props.panelId;
  const activeTab = () => panel()?.tabs.find(t => t.id === panel()?.activeTabId);

  return (
    <div
      style={{
        display: 'flex', 'flex-direction': 'column',
        width: '100%', height: '100%', overflow: 'hidden',
        border: isFocused() ? '1px solid var(--surface1)' : '1px solid transparent',
        'border-radius': 'var(--radius)',
        background: 'var(--base)',
      }}
      onClick={() => focusPanel(props.panelId)}
    >
      {/* Tab bar */}
      <div
        style={{
          display: 'flex', 'align-items': 'center',
          height: 'var(--tabbar-h)', 'flex-shrink': '0',
          background: 'var(--mantle)',
          'border-bottom': '1px solid var(--surface0)',
          overflow: 'hidden',
        }}
      >
        {/* Tabs */}
        <div style={{ display: 'flex', 'align-items': 'center', flex: '1', overflow: 'hidden', height: '100%' }}>
          <For each={panel()?.tabs ?? []}>
            {tab => {
              const isActive = () => panel()?.activeTabId === tab.id;
              return (
                <div
                  style={{
                    display: 'flex', 'align-items': 'center', gap: '6px',
                    height: '100%', padding: '0 10px',
                    background: isActive() ? 'var(--base)' : 'transparent',
                    color: isActive() ? 'var(--text)' : 'var(--muted)',
                    cursor: 'pointer', 'border-right': '1px solid var(--surface0)',
                    'max-width': '180px', 'flex-shrink': '0',
                    'font-size': '12px',
                    'border-bottom': isActive() ? '2px solid var(--accent)' : '2px solid transparent',
                  }}
                  onClick={() => setActiveTab(props.panelId, tab.id)}
                >
                  <span style={{ opacity: '0.7', 'flex-shrink': '0' }}>{tabIcon(tab)}</span>
                  <span class="truncate" style={{ flex: '1', 'font-style': tab.preview ? 'italic' : 'normal' }}>{tab.title}</span>
                  <button
                    style={{
                      opacity: '0', 'flex-shrink': '0',
                      padding: '2px', 'border-radius': '3px',
                      'line-height': '1', 'font-size': '11px',
                      color: 'var(--muted)',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; (e.currentTarget as HTMLElement).style.background = 'var(--surface1)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0'; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
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
        <div style={{ position: 'relative', 'flex-shrink': '0' }}>
          <button
            style={{ padding: '4px 8px', color: 'var(--muted)', 'font-size': '14px', opacity: '0.6' }}
            title="Dividir painel"
            onClick={e => { e.stopPropagation(); setShowMenu(v => !v); }}
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.opacity = '1')}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.opacity = '0.6')}
          >
            ⊞
          </button>
          <Show when={showMenu()}>
            <SplitMenu panelId={props.panelId} onClose={() => setShowMenu(false)} />
          </Show>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: '1 1 0', overflow: 'hidden' }}>
        <Show when={activeTab()} fallback={<PlaceholderView module="" />}>
          {tab => <TabContent tab={tab()} />}
        </Show>
      </div>
    </div>
  );
}
