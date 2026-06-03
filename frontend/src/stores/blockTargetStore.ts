import { createSignal } from 'solid-js';

// Cross-component hand-off for "open note X and scroll to block ^id".
// The clicked block-ref sets this; the matching NoteDetail consumes and clears it.
export interface BlockTarget {
  path: string;
  blockId: string;
}

export const [pendingBlock, setPendingBlock] = createSignal<BlockTarget | null>(null);
