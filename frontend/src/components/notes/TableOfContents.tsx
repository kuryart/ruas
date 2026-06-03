import { For, Show, createMemo } from 'solid-js';
import { useI18n } from '../../i18n/context';
import { type Heading, extractHeadings } from './editor/toc';

/** Outline of a note's headings. Clicking a heading asks the parent to scroll
 *  the active view to it. */
export default function TableOfContents(props: { body: string; onJump: (h: Heading) => void }) {
  const { t } = useI18n();
  const headings = createMemo(() => extractHeadings(props.body));
  const minLevel = createMemo(() => Math.min(6, ...headings().map(h => h.level)));

  return (
    <Show
      when={headings().length > 0}
      fallback={
        <div style={{ padding: '16px', color: 'var(--muted)', 'font-size': '12px' }}>
          {t('notes-toc-empty')}
        </div>
      }
    >
      <div style={{ padding: '8px 4px' }}>
        <For each={headings()}>
          {h => (
            <button
              class="toc-item"
              onClick={() => props.onJump(h)}
              title={h.text}
              style={{
                'padding-left': `${8 + (h.level - minLevel()) * 12}px`,
                'font-weight': h.level <= minLevel() ? '600' : '400',
              }}
            >
              {h.text}
            </button>
          )}
        </For>
      </div>
    </Show>
  );
}
