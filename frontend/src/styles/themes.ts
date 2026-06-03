// Built-in themes. A theme is just a set of CSS-variable values; switching one
// in re-colors the whole app because every component reads `var(--*)`.
// The four Catppuccin flavours: Mocha/Macchiato/Frappé (dark) and Latte (light).

export interface ThemeDef {
  id: string;
  name: string;
  dark: boolean;
  /** Variable name (without `--`) → value. Mirrors the :root block in global.css. */
  palette: Record<string, string>;
}

const mocha: ThemeDef = {
  id: 'mocha', name: 'Catppuccin Mocha', dark: true,
  palette: {
    crust: '#11111b', mantle: '#181825', base: '#1e1e2e',
    surface0: '#313244', surface1: '#45475a', surface2: '#585b70',
    overlay0: '#6c7086', overlay1: '#7f849c',
    text: '#cdd6f4', subtext: '#a6adc8', muted: '#6c7086',
    accent: '#89b4fa', accent2: '#b4befe', blue: '#89b4fa', lavender: '#b4befe',
    green: '#a6e3a1', red: '#f38ba8', yellow: '#f9e2af', teal: '#94e2d5',
    pink: '#f5c2e7', mauve: '#cba6f7', peach: '#fab387',
  },
};

const macchiato: ThemeDef = {
  id: 'macchiato', name: 'Catppuccin Macchiato', dark: true,
  palette: {
    crust: '#181926', mantle: '#1e2030', base: '#24273a',
    surface0: '#363a4f', surface1: '#494d64', surface2: '#5b6078',
    overlay0: '#6e738d', overlay1: '#8087a2',
    text: '#cad3f5', subtext: '#a5adcb', muted: '#6e738d',
    accent: '#8aadf4', accent2: '#b7bdf8', blue: '#8aadf4', lavender: '#b7bdf8',
    green: '#a6da95', red: '#ed8796', yellow: '#eed49f', teal: '#8bd5ca',
    pink: '#f5bde6', mauve: '#c6a0f6', peach: '#f5a97f',
  },
};

const frappe: ThemeDef = {
  id: 'frappe', name: 'Catppuccin Frappé', dark: true,
  palette: {
    crust: '#232634', mantle: '#292c3c', base: '#303446',
    surface0: '#414559', surface1: '#51576d', surface2: '#626880',
    overlay0: '#737994', overlay1: '#838ba7',
    text: '#c6d0f5', subtext: '#a5adce', muted: '#737994',
    accent: '#8caaee', accent2: '#babbf1', blue: '#8caaee', lavender: '#babbf1',
    green: '#a6d189', red: '#e78284', yellow: '#e5c890', teal: '#81c8be',
    pink: '#f4b8e4', mauve: '#ca9ee6', peach: '#ef9f76',
  },
};

const latte: ThemeDef = {
  id: 'latte', name: 'Catppuccin Latte', dark: false,
  palette: {
    crust: '#dce0e8', mantle: '#e6e9ef', base: '#eff1f5',
    surface0: '#ccd0da', surface1: '#bcc0cc', surface2: '#acb0be',
    overlay0: '#9ca0b0', overlay1: '#8c8fa1',
    text: '#4c4f69', subtext: '#6c6f85', muted: '#8c8fa1',
    accent: '#1e66f5', accent2: '#7287fd', blue: '#1e66f5', lavender: '#7287fd',
    green: '#40a02b', red: '#d20f39', yellow: '#df8e1d', teal: '#179299',
    pink: '#ea76cb', mauve: '#8839ef', peach: '#fe640b',
  },
};

export const THEMES: ThemeDef[] = [mocha, macchiato, frappe, latte];

/** Accent options: each maps to a palette key. `default` keeps the theme's own. */
export const ACCENTS = ['default', 'mauve', 'lavender', 'pink', 'peach', 'red', 'yellow', 'green', 'teal'] as const;
export type AccentId = (typeof ACCENTS)[number];

export interface FontDef { id: string; label: string; stack: string }
export const FONTS: FontDef[] = [
  { id: 'system', label: 'System', stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif" },
  { id: 'inter', label: 'Inter / Sans', stack: "'Inter', 'Segoe UI', system-ui, sans-serif" },
  { id: 'serif', label: 'Serif', stack: "Georgia, 'Times New Roman', serif" },
  { id: 'mono', label: 'Monospace', stack: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace" },
];
