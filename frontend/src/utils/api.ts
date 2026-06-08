import { invoke as tauriInvoke } from '@tauri-apps/api/core';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function httpInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/${cmd}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args ?? {}),
    });
  } catch (e) {
    throw new Error(`${cmd}: API server unreachable — run "cargo run -p ruas_api"`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const hint = body.includes('proxy') ? ' (API server not running?)' : body ? ` — ${body}` : '';
    throw new Error(`${cmd} failed: HTTP ${res.status}${hint}`);
  }
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) return res.json() as Promise<T>;
  return res.text() as unknown as Promise<T>;
}

export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) return tauriInvoke<T>(cmd, args);
  return httpInvoke<T>(cmd, args);
}

/** Open an external URL in the user's default browser (desktop) or a new tab (web). */
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    try {
      await tauriInvoke('plugin:opener|open_url', { url });
      return;
    } catch (e) {
      console.error('openExternal: opener plugin failed, falling back:', e);
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
