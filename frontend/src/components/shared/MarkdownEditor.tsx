import { Show, type JSX } from 'solid-js';
import { type Extension } from '@codemirror/state';
import EditorPane, { type EditorApi } from './EditorPane';
import ViewPane, { type ViewApi } from './ViewPane';
import { useI18n } from '../../i18n/context';

export type MarkdownMode = 'view' | 'edit' | 'raw';

/** Standalone mode-toggle bar. Use when you need to position the buttons
 *  outside the MarkdownEditor (e.g. next to a title field). */
export function MarkdownModeBar(props: {
  mode: MarkdownMode;
  onModeChange: (mode: MarkdownMode) => void;
}): JSX.Element {
  const { t } = useI18n();
  const Btn = (p: { m: MarkdownMode; labelKey: string }) => (
    <button
      class="mode-btn"
      classList={{ 'mode-active': props.mode === p.m }}
      onClick={() => props.onModeChange(p.m)}
    >
      {t(p.labelKey)}
    </button>
  );
  return (
    <div style={{ display: 'flex', gap: '2px', background: 'var(--surface0)', 'border-radius': '6px', padding: '2px' }}>
      <Btn m="view" labelKey="notes-mode-view" />
      <Btn m="edit" labelKey="notes-mode-edit" />
      <Btn m="raw"  labelKey="notes-mode-raw"  />
    </div>
  );
}

export default function MarkdownEditor(props: {
  content: string;
  onChange: (value: string) => void;

  // Controlled mode — caller owns the signal.
  mode: MarkdownMode;
  onModeChange?: (mode: MarkdownMode) => void;

  // When true, renders a three-button mode toggle above the editor.
  showModeButtons?: boolean;

  // When true the editor/view grow with content instead of filling the
  // container. Use inside scrollable detail forms (contacts, agenda, etc.).
  autoGrow?: boolean;

  // Module-specific extensions (e.g. wiki-links + block-refs for notes).
  extraExtensions?: Extension[];

  // Wiki-link click handler. Absence = links rendered as inactive spans.
  onWikiLinkClick?: (title: string, permanent: boolean, blockId?: string) => void;

  // Embed resolver for `![[note]]`. Absence = empty placeholder.
  resolveEmbed?: (el: HTMLElement, target: string) => void;

  // Block-scroll target (block-ref id without the `^`).
  scrollTarget?: string | null;

  // Callbacks to receive the inner APIs for programmatic scroll.
  onEditorReady?: (api: EditorApi) => void;
  onViewReady?: (api: ViewApi) => void;
}): JSX.Element {
  return (
    <div
      style={props.autoGrow
        ? { display: 'flex', 'flex-direction': 'column', 'box-sizing': 'border-box' }
        : { display: 'flex', 'flex-direction': 'column', height: '100%', 'box-sizing': 'border-box' }
      }
    >
      <Show when={props.showModeButtons && props.onModeChange}>
        <div style={{ display: 'flex', 'flex-shrink': '0', gap: '2px', padding: '2px 0 6px' }}>
          <MarkdownModeBar mode={props.mode} onModeChange={props.onModeChange!} />
        </div>
      </Show>

      <Show when={props.autoGrow} fallback={
        <div style={{ flex: '1 1 0', overflow: 'hidden' }}>
          <Show when={props.mode === 'view'}>
            <ViewPane
              body={props.content}
              onReady={props.onViewReady}
              onWikiLinkClick={props.onWikiLinkClick}
              resolveEmbed={props.resolveEmbed}
            />
          </Show>
          <Show when={props.mode === 'edit' || props.mode === 'raw'}>
            <EditorPane
              content={props.content}
              mode={props.mode as 'edit' | 'raw'}
              onChange={props.onChange}
              scrollTarget={props.scrollTarget}
              onReady={props.onEditorReady}
              extraExtensions={props.extraExtensions}
            />
          </Show>
        </div>
      }>
        <Show when={props.mode === 'view'}>
          <ViewPane
            body={props.content}
            onReady={props.onViewReady}
            onWikiLinkClick={props.onWikiLinkClick}
            resolveEmbed={props.resolveEmbed}
            autoGrow
          />
        </Show>
        <Show when={props.mode === 'edit' || props.mode === 'raw'}>
          <EditorPane
            content={props.content}
            mode={props.mode as 'edit' | 'raw'}
            onChange={props.onChange}
            scrollTarget={props.scrollTarget}
            onReady={props.onEditorReady}
            extraExtensions={props.extraExtensions}
            autoGrow
          />
        </Show>
      </Show>
    </div>
  );
}
