import { createSignal } from 'solid-js';

// Global Ctrl+P command palette (note quick-open).
export const [paletteOpen, setPaletteOpen] = createSignal(false);
export const togglePalette = () => setPaletteOpen(v => !v);
