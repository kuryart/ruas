import { createRoot, createSignal } from 'solid-js';
import { invoke } from '../utils/api';

// ── Types ──────────────────────────────────────────────────────────────────

export interface PluginEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  trust: 'core' | 'native' | 'plugin';
  kind: 'wasm' | 'tool';
  capabilities: string[];
  approved: string[];
  enabled: boolean;
}

// ── Lazy store (wrapped in createRoot for clean disposal) ──────────────────

/**
 * Internal state. All reactive primitives live inside a single createRoot
 * so the store can be imported at module level without leaking subscriptions.
 */
const {
  plugins,
  refreshPlugins,
} = createRoot(() => {
  const [items, setItems] = createSignal<PluginEntry[]>([]);
  const [loading, setLoading] = createSignal(false);
  let fetched = false;

  async function doFetch() {
    if (loading()) return;
    setLoading(true);
    try {
      const result = await invoke<PluginEntry[]>('list_plugins');
      setItems(result ?? []);
    } catch (e) {
      console.error('[pluginsStore] list_plugins failed:', e);
    } finally {
      setLoading(false);
      fetched = true;
    }
  }

  function refresh(): void {
    void doFetch();
  }

  // Auto-fetch on first access, but only once.
  // Each call to plugins() will trigger the fetch if it hasn't happened yet.
  const accessor = () => {
    if (!fetched && !loading()) void doFetch();
    return items();
  };

  return {
    plugins: accessor,
    refreshPlugins: refresh,
  };
});

export { plugins, refreshPlugins };

// ── Actions ─────────────────────────────────────────────────────────────────

export async function enablePlugin(id: string): Promise<void> {
  await invoke('enable_plugin', { pluginId: id });
  refreshPlugins();
}

export async function disablePlugin(id: string): Promise<void> {
  await invoke('disable_plugin', { pluginId: id });
  refreshPlugins();
}

export async function uninstallPlugin(id: string): Promise<void> {
  await invoke('uninstall_plugin', { pluginId: id });
  refreshPlugins();
}

// ── Capability helpers ──────────────────────────────────────────────────────

export function capabilityLabel(cap: string): string {
  const map: Record<string, string> = {
    VaultRead: 'Vault Read',
    VaultWrite: 'Vault Write',
    IndexRead: 'Index Read',
    IndexWrite: 'Index Write',
    CrossModuleRead: 'Cross-Module Read',
    Network: 'Network',
  };
  return map[cap] ?? cap;
}

export function capabilityDescription(cap: string): string {
  const map: Record<string, string> = {
    VaultRead: 'Read .md files and vault metadata.',
    VaultWrite: 'Write .md files and vault metadata.',
    IndexRead: 'Query the SQLite full-text search index (read-only).',
    IndexWrite: 'Rebuild or modify the SQLite index.',
    CrossModuleRead: 'Read data published by other modules.',
    Network: 'Outbound network access — always requires explicit user approval.',
  };
  return map[cap] ?? '';
}
