import { type JSX } from 'solid-js';
import { type SplitNode, type WorkspaceNode, updateSplitRatio } from './workspaceStore';
import PanelView from './PanelView';

// ── Split container with draggable divider ─────────────────────────────────

function SplitContainer(props: { node: SplitNode }) {
  let containerRef: HTMLDivElement | undefined;

  const handleMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    const startPos = props.node.direction === 'row' ? e.clientX : e.clientY;
    const startRatio = props.node.ratio;

    const onMove = (ev: MouseEvent) => {
      if (!containerRef) return;
      const rect = containerRef.getBoundingClientRect();
      const pos = props.node.direction === 'row'
        ? ev.clientX - rect.left
        : ev.clientY - rect.top;
      const size = props.node.direction === 'row' ? rect.width : rect.height;
      const ratio = Math.max(0.15, Math.min(0.85, pos / size));
      updateSplitRatio(props.node.id, ratio);
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const isRow = () => props.node.direction === 'row';
  const pct = () => `${props.node.ratio * 100}%`;

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        'flex-direction': isRow() ? 'row' : 'column',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* First panel */}
      <div style={{ [isRow() ? 'width' : 'height']: pct(), 'flex-shrink': '0', overflow: 'hidden' }}>
        <WorkspaceTree node={props.node.first} />
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          [isRow() ? 'width' : 'height']: '4px',
          [isRow() ? 'height' : 'width']: '100%',
          background: 'var(--surface0)',
          cursor: isRow() ? 'col-resize' : 'row-resize',
          'flex-shrink': '0',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => ((e.target as HTMLElement).style.background = 'var(--accent)')}
        onMouseLeave={e => ((e.target as HTMLElement).style.background = 'var(--surface0)')}
      />

      {/* Second panel */}
      <div style={{ flex: '1 1 0', overflow: 'hidden' }}>
        <WorkspaceTree node={props.node.second} />
      </div>
    </div>
  );
}

// ── Recursive tree renderer ────────────────────────────────────────────────

function WorkspaceTree(props: { node: WorkspaceNode }): JSX.Element {
  return props.node.kind === 'leaf'
    ? <PanelView panelId={props.node.panelId} />
    : <SplitContainer node={props.node} />;
}

// ── Root ───────────────────────────────────────────────────────────────────

import { tree } from './workspaceStore';

export default function Workspace() {
  return (
    <div style={{ flex: '1 1 0', overflow: 'hidden', display: 'flex' }}>
      <WorkspaceTree node={tree()} />
    </div>
  );
}
