import { createSignal } from 'solid-js';

export interface FuzzyItem {
  id: string;       // stable identifier (e.g. note path)
  label: string;    // primary text (e.g. title)
  sublabel?: string; // secondary text (e.g. filename / preview)
}

export type FuzzySource = 'wiki' | 'blockRef' | 'slash';

export interface FuzzyState {
  source: FuzzySource;
  items: FuzzyItem[];
  query: string;
  anchor: { x: number; y: number };
  onSelect: (item: FuzzyItem) => void;
  onClose: () => void;
}

const [state, setState] = createSignal<FuzzyState | null>(null);

/** Reactive accessor — `null` when no popup is open. */
export const fuzzyState = state;

export function openFuzzy(s: FuzzyState) {
  setState(s);
}

export function patchFuzzy(patch: Partial<FuzzyState>) {
  setState(prev => (prev ? { ...prev, ...patch } : prev));
}

export function closeFuzzy() {
  setState(null);
}

export function isFuzzyOpen(): boolean {
  return state() !== null;
}
