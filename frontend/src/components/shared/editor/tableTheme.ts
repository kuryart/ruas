/**
 * Catppuccin Mocha table theme for codemirror-markdown-tables.
 *
 * Maps our CSS custom property palette (--base, --surface0, etc.) onto the
 * library's --tbl-theme-* CSS variable naming convention so tables blend into
 * the editor's dark theme.
 */
import { TableTheme } from 'codemirror-markdown-tables';

export const catppuccinTableTheme = TableTheme.dark.with({
  // Row backgrounds — use the Catppuccin surface hierarchy
  '--tbl-theme-row-background':           'var(--base)',
  '--tbl-theme-header-row-background':    'var(--surface0)',
  '--tbl-theme-even-row-background':      'var(--base)',
  '--tbl-theme-odd-row-background':       'var(--mantle)',

  // Borders
  '--tbl-theme-border-color':             'var(--surface1)',
  '--tbl-theme-border-hover-color':       'var(--accent)',
  '--tbl-theme-border-active-color':      'var(--accent)',

  // Selection outline
  '--tbl-theme-outline-color':            'var(--accent)',

  // Text
  '--tbl-theme-text-color':               'var(--text)',

  // Context menus
  '--tbl-theme-menu-border-color':        'var(--surface1)',
  '--tbl-theme-menu-background':          'var(--surface0)',
  '--tbl-theme-menu-hover-background':    'var(--surface1)',
  '--tbl-theme-menu-text-color':          'var(--text)',
  '--tbl-theme-menu-hover-text-color':    'var(--text)',

  // Select-all overlay (match our selection color)
  '--tbl-theme-select-all-focus-overlay': 'rgba(137, 180, 250, 0.17)',
  '--tbl-theme-select-all-blur-overlay':  'rgba(137, 180, 250, 0.08)',
});
