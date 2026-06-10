import type { Component } from 'solid-js';

// ── Types ──────────────────────────────────────────────────────────────────

/** A view component that a plugin can render inside a panel tab. */
export interface PluginViewRegistration {
  pluginId: string;
  viewId: string;
  component: Component<{ payload: unknown }>;
}

/** A sidebar button registered by a plugin. */
export interface PluginSidebarButton {
  pluginId: string;
  id: string;
  title: string;
  icon: string; // SVG string
  onClick: () => void;
}

/** A slash command registered by a plugin. */
export interface PluginSlashCommand {
  pluginId: string;
  name: string;
  label: string;
  description?: string;
  run: (view: unknown) => void;
}

/** A markdown renderer registered by a plugin. */
export interface PluginMarkdownRenderer {
  pluginId: string;
  name: string;
  /** Called for fenced code blocks with matching language. Returns HTML string. */
  render: (code: string, info: string) => string | null;
}

// ── Registries ─────────────────────────────────────────────────────────────

const tabRenderers: PluginViewRegistration[] = [];

export function registerTabRenderer(reg: PluginViewRegistration) {
  // Replace existing registration from same plugin+viewId
  const idx = tabRenderers.findIndex(r => r.pluginId === reg.pluginId && r.viewId === reg.viewId);
  if (idx !== -1) tabRenderers[idx] = reg;
  else tabRenderers.push(reg);
}

export function getTabRenderer(pluginId: string, viewId: string): PluginViewRegistration | undefined {
  return tabRenderers.find(r => r.pluginId === pluginId && r.viewId === viewId);
}

const sidebarButtons: PluginSidebarButton[] = [];

export function registerSidebarButton(button: PluginSidebarButton) {
  const idx = sidebarButtons.findIndex(b => b.pluginId === button.pluginId && b.id === button.id);
  if (idx !== -1) sidebarButtons[idx] = button;
  else sidebarButtons.push(button);
}

export function getSidebarButtons(): PluginSidebarButton[] {
  return [...sidebarButtons];
}

const slashCommands: PluginSlashCommand[] = [];

export function registerSlashCommand(cmd: PluginSlashCommand) {
  const idx = slashCommands.findIndex(c => c.pluginId === cmd.pluginId && c.name === cmd.name);
  if (idx !== -1) slashCommands[idx] = cmd;
  else slashCommands.push(cmd);
}

export function getSlashCommands(): PluginSlashCommand[] {
  return [...slashCommands];
}

const markdownRenderers: PluginMarkdownRenderer[] = [];

export function registerMarkdownRenderer(renderer: PluginMarkdownRenderer) {
  const idx = markdownRenderers.findIndex(r => r.pluginId === renderer.pluginId && r.name === renderer.name);
  if (idx !== -1) markdownRenderers[idx] = renderer;
  else markdownRenderers.push(renderer);
}

/** Try each registered renderer; first non-null result wins. */
export function renderPluginMarkdown(code: string, info: string): string | null {
  for (const r of markdownRenderers) {
    const result = r.render(code, info);
    if (result !== null) return result;
  }
  return null;
}
