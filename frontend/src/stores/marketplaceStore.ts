// ── Plugin marketplace (community plugins) ───────────────────────────────────
//
// The marketplace is a public GitHub repository (`ruas-plugins`) with an
// `index.json` at the root listing all available plugins. Each entry includes
// a `download_url` pointing to the plugin's `.wasm` and `manifest.json`.
//
// Future phases: search, install, update checking, auto-update.

import { createSignal } from 'solid-js';
import { invoke } from '../utils/api';

// ── Types ──────────────────────────────────────────────────────────────────

export interface MarketplaceEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  capabilities: string[];
  /** URL to the raw GitHub content directory for this plugin. */
  download_url: string;
  /** SHA256 of the `.wasm` file (optional, for integrity checking). */
  sha256?: string;
  /** Minimum Ruas app version. */
  min_app_version?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

/** URL to the community plugin index. */
const INDEX_URL =
  'https://raw.githubusercontent.com/ruas-org/ruas-plugins/main/index.json';

// ── Signals ─────────────────────────────────────────────────────────────────

const [marketplaceEntries, setMarketplaceEntries] = createSignal<MarketplaceEntry[]>([]);
const [marketplaceLoading, setMarketplaceLoading] = createSignal(false);
const [marketplaceError, setMarketplaceError] = createSignal<string | null>(null);

export { marketplaceEntries, marketplaceLoading, marketplaceError };

// ── Fetch ───────────────────────────────────────────────────────────────────

export async function fetchMarketplace() {
  setMarketplaceLoading(true);
  setMarketplaceError(null);
  try {
    const res = await fetch(INDEX_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: MarketplaceEntry[] = await res.json();
    if (!Array.isArray(data)) throw new Error('Invalid index format');
    setMarketplaceEntries(data);
  } catch (e) {
    setMarketplaceError(String(e));
  } finally {
    setMarketplaceLoading(false);
  }
}

// ── Install ─────────────────────────────────────────────────────────────────

export async function installPlugin(entry: MarketplaceEntry): Promise<void> {
  // Step 1: download manifest.json and plugin.wasm from the download_url
  const base = entry.download_url.replace(/\/$/, '');

  // Fetch manifest
  const mfRes = await fetch(`${base}/manifest.json`);
  if (!mfRes.ok) throw new Error(`Failed to download manifest: HTTP ${mfRes.status}`);
  const manifest = await mfRes.json();

  // Fetch wasm
  const wasmRes = await fetch(`${base}/plugin.wasm`);
  if (!wasmRes.ok) throw new Error(`Failed to download plugin: HTTP ${wasmRes.status}`);
  const wasmBytes = await wasmRes.arrayBuffer();

  // Step 2: write files to the vault's plugin directory
  // (This requires a Tauri command — placeholder until implemented)
  await invoke('install_plugin_files', {
    pluginId: entry.id,
    manifest: JSON.stringify(manifest),
    wasm: Array.from(new Uint8Array(wasmBytes)),
  });

  // Step 3: refresh the plugin list
  const { refreshPlugins } = await import('../stores/pluginsStore');
  void refreshPlugins();
}

// ── Check for updates ───────────────────────────────────────────────────────

export async function checkForUpdates(pluginId: string, currentVersion: string): Promise<MarketplaceEntry | null> {
  await fetchMarketplace();
  const entries = marketplaceEntries();
  return entries.find(
    e => e.id === pluginId && e.version !== currentVersion,
  ) ?? null;
}
