import { For, Show, createResource } from 'solid-js';
import { useI18n } from '../../i18n/context';
import { invoke } from '../../utils/api';
import { navigateToNote } from '../workspace/workspaceStore';

interface BacklinkMeta {
  source_path: string;
  source_title: string;
  context: string;
}

/** Notes that link to the current note. Clicking one opens it. */
export default function BacklinksPanel(props: { path: string }) {
  const { t } = useI18n();
  const [links] = createResource(() => props.path, path =>
    invoke<BacklinkMeta[]>('get_backlinks', { path }),
  );

  return (
    <Show
      when={!links.loading}
      fallback={<div style={{ padding: '16px', color: 'var(--muted)', 'font-size': '12px' }}>{t('notes-loading')}</div>}
    >
      <Show
        when={(links() ?? []).length > 0}
        fallback={<div style={{ padding: '16px', color: 'var(--muted)', 'font-size': '12px' }}>{t('notes-backlinks-empty')}</div>}
      >
        <div style={{ padding: '8px 4px' }}>
          <For each={links()}>
            {link => (
              <button
                class="backlink-item"
                onClick={() => navigateToNote(link.source_path, link.source_title)}
              >
                <div class="truncate" style={{ 'font-size': '12px', 'font-weight': '500', color: 'var(--text)' }}>
                  {link.source_title}
                </div>
                <Show when={link.context}>
                  <div style={{
                    'font-size': '11px', color: 'var(--muted)', 'margin-top': '2px',
                    display: '-webkit-box', '-webkit-line-clamp': '2', '-webkit-box-orient': 'vertical', overflow: 'hidden',
                  }}>
                    {link.context}
                  </div>
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
    </Show>
  );
}
