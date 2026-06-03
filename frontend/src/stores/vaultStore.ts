import { createSignal } from 'solid-js';

export interface VaultInfo {
  path: string;
  name: string;
}

// Active vault for the whole app. `null` → the VaultScreen is shown.
const [activeVault, setActiveVault] = createSignal<VaultInfo | null>(null);

export { activeVault, setActiveVault };

/** Return to the vault picker (e.g. the "Change Vault" action). */
export function clearVault() {
  setActiveVault(null);
}
