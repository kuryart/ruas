import { createSignal } from 'solid-js';

export interface HistoryCommand {
  description: string;
  undo: () => Promise<void> | void;
  redo: () => Promise<void> | void;
}

const [past,   setPast]   = createSignal<HistoryCommand[]>([]);
const [future, setFuture] = createSignal<HistoryCommand[]>([]);

export const canUndo        = () => past().length > 0;
export const canRedo        = () => future().length > 0;
export const undoDescription = () => past().at(-1)?.description;
export const redoDescription = () => future()[0]?.description;

export function pushHistory(cmd: HistoryCommand) {
  setPast(p => [...p, cmd]);
  setFuture([]);
}

export async function undoLast() {
  const cmd = past().at(-1);
  if (!cmd) return;
  await cmd.undo();
  setPast(p => p.slice(0, -1));
  setFuture(f => [cmd, ...f]);
}

export async function redoNext() {
  const cmd = future()[0];
  if (!cmd) return;
  await cmd.redo();
  setFuture(f => f.slice(1));
  setPast(p => [...p, cmd]);
}
