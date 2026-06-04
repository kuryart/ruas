import { createSignal } from 'solid-js';

// Increment to signal ContactsList to refetch after any contact mutation.
const [version, setVersion] = createSignal(0);
export const contactsVersion = version;
export function invalidateContacts() { setVersion(v => v + 1); }
