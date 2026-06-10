import { Show, createSignal } from 'solid-js';
import { Portal } from 'solid-js/web';
import { For } from 'solid-js';
import type { PluginEntry } from '../../stores/pluginsStore';
import { capabilityLabel, capabilityDescription } from '../../stores/pluginsStore';

// ── Shared state (module-level, no Solid primitives) ────────────────────────

let pending: {
  plugin: PluginEntry;
  onApprove: (approved: string[]) => void;
  onReject: () => void;
} | null = null;

let notify: (() => void) | null = null;

/**
 * Open the permission dialog for a plugin.
 * Resolves with the list of approved capabilities, or rejects.
 */
export function requestPluginPermissions(
  plugin: PluginEntry,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    pending = {
      plugin,
      onApprove: (approved) => {
        pending = null;
        resolve(approved);
        notify?.();
      },
      onReject: () => {
        pending = null;
        reject(new Error('User rejected plugin permissions'));
        notify?.();
      },
    };
    notify?.();
  });
}

// ── Component ──────────────────────────────────────────────────────────────

export default function PermissionDialog() {
  const [tick, setTick] = createSignal(0);
  notify = () => setTick(t => t + 1);

  const plugin = () => pending?.plugin ?? null;
  const isOpen = () => pending !== null;

  const [selected, setSelected] = createSignal<Set<string>>(new Set());

  function initSelection() {
    if (isOpen() && pending) {
      setSelected(new Set(pending.plugin.approved));
    }
  }

  function toggle(cap: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(cap)) next.delete(cap);
      else next.add(cap);
      return next;
    });
  }

  function approve() {
    if (pending) {
      pending.onApprove([...selected()]);
    }
  }

  function reject() {
    if (pending) {
      pending.onReject();
    }
  }

  // Initialize selection when dialog opens.
  // We track tick() so that the effect re-runs when the dialog is re-opened.
  void tick;
  if (isOpen()) {
    initSelection();
  }

  return (
    <Show when={isOpen()}>
      <Portal>
        <div
          class="settings-backdrop"
          style={{ 'z-index': '300' }}
          onClick={reject}
        >
          <div
            class="permission-dialog"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div class="permission-header">
              <div>
                <div class="permission-title">
                  {plugin()?.name}
                </div>
                <div class="permission-subtitle">
                  This plugin requests the following permissions.
                  Select which ones to grant.
                </div>
              </div>
              <button class="settings-close" onClick={reject}>✕</button>
            </div>

            {/* Capability list */}
            <div class="permission-list">
              <For each={plugin()?.capabilities ?? []}>
                {cap => {
                  const checked = () => selected().has(cap);
                  return (
                    <label
                      class="permission-item"
                      classList={{ checked: checked() }}
                      onClick={() => toggle(cap)}
                    >
                      <input
                        type="checkbox"
                        checked={checked()}
                        style={{
                          width: '16px', height: '16px',
                          'flex-shrink': '0',
                          'accent-color': 'var(--accent)',
                          cursor: 'pointer',
                        }}
                      />
                      <div style={{ flex: '1', 'min-width': '0' }}>
                        <div style={{
                          'font-size': '13px', 'font-weight': '500',
                          color: 'var(--text)', 'margin-bottom': '2px',
                        }}>
                          {capabilityLabel(cap)}
                        </div>
                        <div style={{
                          'font-size': '11px', color: 'var(--muted)',
                          'line-height': '1.5',
                        }}>
                          {capabilityDescription(cap)}
                        </div>
                      </div>
                    </label>
                  );
                }}
              </For>
            </div>

            {/* Footer */}
            <div class="permission-footer">
              <button class="confirm-btn" onClick={reject}>
                Cancel
              </button>
              <button
                class="confirm-btn"
                style={{
                  background: 'var(--accent)',
                  color: 'var(--crust)',
                  'border-color': 'var(--accent)',
                }}
                onClick={approve}
                disabled={selected().size === 0}
              >
                Grant &amp; Enable
              </button>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
