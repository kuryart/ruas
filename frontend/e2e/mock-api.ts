/**
 * Playwright route helpers — intercept API fetch calls before they leave the
 * browser, so tests run without a real Rust API server.
 *
 * The app uses `fetch('/{cmd}', { method: 'POST', ... })` for web mode, and
 * Playwright's page.route() fires before the request reaches Astro's proxy.
 */
import type { Page } from '@playwright/test';

// ── Fixtures ──────────────────────────────────────────────────────────────────

export const MOCK_VAULT = { path: '/tmp/test-vault', name: 'Test Vault' };

export const MOCK_NOTE = {
	path: '/tmp/test-vault/notes/abc123.md',
	frontmatter: {
		uid: 'abc-123',
		title: 'Test Note',
		created: '2025-01-01T00:00:00Z',
		modified: '2025-01-01T00:00:00Z',
	},
	body: '',
};

export const MOCK_NOTE_META = {
	path: MOCK_NOTE.path,
	title: 'Test Note',
	tags: null,
	modified: '2025-01-01T00:00:00Z',
};

export const MOCK_CONTACT = {
	path: '/tmp/test-vault/contacts/def456.md',
	frontmatter: {
		uid: 'def-456',
		fn: 'Alice Smith',
		'given-name': 'Alice',
		'family-name': 'Smith',
		created: '2025-01-01T00:00:00Z',
		modified: '2025-01-01T00:00:00Z',
	},
	body: '',
};

export const MOCK_CONTACT_META = {
	path: MOCK_CONTACT.path,
	display_name: 'Alice Smith',
	initials: 'AS',
	org: null,
	primary_email: null,
	tags: null,
};

// ── Route helpers ─────────────────────────────────────────────────────────────

/** Mock the app as having an open vault (skips VaultScreen). */
export async function mockActiveVault(page: Page, vault = MOCK_VAULT) {
	await page.route(/\/get_active_vault$/, r => r.fulfill({
		status: 200, contentType: 'application/json', body: JSON.stringify(vault),
	}));
}

/** Mock the app as having NO open vault (shows VaultScreen). */
export async function mockNoActiveVault(page: Page) {
	// Use explicit body/contentType instead of { json: null } — Playwright may
	// silently skip fulfillment when json value is null, letting Astro serve the
	// index HTML page (200 OK) which httpInvoke then returns as a truthy string.
	await page.route(/\/get_active_vault$/, r => r.fulfill({
		status: 200, contentType: 'application/json', body: 'null',
	}));
}

/** Mock vault creation/selection commands. */
export async function mockVaultCommands(page: Page, vault = MOCK_VAULT) {
	await page.route('**/select_folder', r => r.fulfill({ json: vault.path }));
	await page.route('**/new_vault', r => r.fulfill({ json: vault }));
	await page.route('**/open_vault', r => r.fulfill({ json: vault }));
}

/** Mock notes module to return an empty list. */
export async function mockEmptyNotes(page: Page) {
	await page.route('**/list_notes', r => r.fulfill({ json: [] }));
	await page.route('**/list_notes_tree', r => r.fulfill({ json: [] }));
	await page.route('**/search_notes', r => r.fulfill({ json: [] }));
}

/** Mock notes module to return one note. */
export async function mockOneNote(page: Page) {
	await page.route('**/list_notes', r => r.fulfill({ json: [MOCK_NOTE_META] }));
	await page.route('**/list_notes_tree', r => r.fulfill({ json: [{ name: 'Test Note', path: MOCK_NOTE.path, is_dir: false, children: [] }] }));
	await page.route('**/search_notes', r => r.fulfill({ json: [MOCK_NOTE_META] }));
	await page.route('**/read_note', r => r.fulfill({ json: MOCK_NOTE }));
}

/** Mock note creation to return a new note. */
export async function mockCreateNote(page: Page, note = MOCK_NOTE) {
	await page.route('**/create_note', r => r.fulfill({ json: note }));
	await page.route('**/save_note', r => r.fulfill({ json: null }));
	await page.route('**/delete_note', r => r.fulfill({ json: null }));
}

/** Mock contacts module to return an empty list. */
export async function mockEmptyContacts(page: Page) {
	await page.route('**/list_contacts', r => r.fulfill({ json: [] }));
}

/** Mock contacts module to return one contact. */
export async function mockOneContact(page: Page) {
	await page.route('**/list_contacts', r => r.fulfill({ json: [MOCK_CONTACT_META] }));
	await page.route('**/read_contact', r => r.fulfill({ json: MOCK_CONTACT }));
}

/** Mock contact creation. */
export async function mockCreateContact(page: Page, contact = MOCK_CONTACT) {
	await page.route('**/create_contact', r => r.fulfill({ json: contact }));
	await page.route('**/save_contact', r => r.fulfill({ json: null }));
	await page.route('**/delete_contact', r => r.fulfill({ json: null }));
}

/** Mock appearance module (always needed — App loads themes on vault open). */
export async function mockAppearance(page: Page) {
	await page.route('**/list_appearance', r => r.fulfill({ json: [] }));
	await page.route('**/get_appearance_config', r => r.fulfill({ json: { theme: null, accent: null, font: null } }));
	await page.route('**/read_appearance_css', r => r.fulfill({ body: '' }));
	await page.route('**/set_appearance_config', r => r.fulfill({ json: null }));
}

/**
 * Force English locale and reset left-panel state before the page loads.
 * Call this before page.goto() in every test that uses translated text.
 *
 * Why needed:
 * - navigator.languages may return the OS locale (pt-BR) overriding Playwright's
 *   `locale` config when Chromium is compiled with a system locale.
 * - leftPanelModule defaults to 'notes' on first run; clicking Notes would then
 *   CLOSE the already-open panel instead of opening it.
 */
export async function resetPageState(page: Page) {
	await page.addInitScript(() => {
		// Force English so translated selectors are predictable.
		Object.defineProperty(navigator, 'language', { configurable: true, get: () => 'en-US' });
		Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['en-US'] });
		// Close the left panel so sidebar button clicks reliably OPEN it.
		try { localStorage.setItem('ruas.layout.leftPanel', 'none'); } catch { /* ignore */ }
	});
}

/** Convenience: set up mocks for a fully-loaded app ready to test Notes. */
export async function setupForNotes(page: Page) {
	await resetPageState(page);
	await mockActiveVault(page);
	await mockAppearance(page);
	await mockEmptyNotes(page);
	await mockEmptyContacts(page);
}

/** Convenience: set up mocks for a fully-loaded app ready to test Contacts. */
export async function setupForContacts(page: Page) {
	await resetPageState(page);
	await mockActiveVault(page);
	await mockAppearance(page);
	await mockEmptyNotes(page);
	await mockEmptyContacts(page);
}
