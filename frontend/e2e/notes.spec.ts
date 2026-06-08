import { test, expect } from '@playwright/test';
import {
	setupForNotes,
	mockEmptyNotes,
	mockOneNote,
	mockCreateNote,
	mockActiveVault,
	mockAppearance,
	mockEmptyContacts,
	resetPageState,
	MOCK_NOTE,
} from './mock-api';

test.describe('Notes module', () => {
	test('sidebar Notes button opens the notes panel', async ({ page }) => {
		await setupForNotes(page);
		await page.goto('/');

		await page.getByTitle('Notes').click();

		await expect(page.locator('.note-list')).toBeVisible();
	});

	test('shows empty state when vault has no notes', async ({ page }) => {
		await setupForNotes(page);
		await page.goto('/');

		await page.getByTitle('Notes').click();

		await expect(page.getByText('No notes yet')).toBeVisible();
	});

	test('shows note in list when vault has one note', async ({ page }) => {
		await resetPageState(page);
		await mockActiveVault(page);
		await mockAppearance(page);
		await mockOneNote(page);
		await mockEmptyContacts(page);
		await page.goto('/');

		await page.getByTitle('Notes').click();

		await expect(page.getByText('Test Note')).toBeVisible();
	});

	test('clicking + creates a note and opens it', async ({ page }) => {
		await resetPageState(page);
		await mockActiveVault(page);
		await mockAppearance(page);
		await mockEmptyContacts(page);

		const newMeta = { path: MOCK_NOTE.path, title: 'Test Note', tags: null, modified: null };
		const newTree = [{ name: 'Test Note', path: MOCK_NOTE.path, is_dir: false, children: [] }];
		let created = false;

		await page.route('**/list_notes', r => {
			if (created) r.fulfill({ json: [newMeta] });
			else r.fulfill({ json: [] });
		});
		await page.route('**/list_notes_tree', r => {
			if (created) r.fulfill({ json: newTree });
			else r.fulfill({ json: [] });
		});
		await page.route('**/create_note', async r => {
			created = true;
			await r.fulfill({ json: MOCK_NOTE });
		});
		await page.route('**/read_note', r => r.fulfill({ json: MOCK_NOTE }));
		await page.route('**/get_notes_dir', r => r.fulfill({ json: '/tmp/test-vault/notes' }));

		await page.goto('/');
		await page.getByTitle('Notes').click();
		await expect(page.locator('.list-new-btn')).toBeVisible();
		await page.getByTitle('New note').click();

		// After creation, the note detail opens in the workspace.
		// The detail view renders the title in a .note-title-input field.
		await expect(page.locator('.note-title-input')).toBeVisible();
	});

	test('right-click on empty space shows context menu with New note option', async ({ page }) => {
		await setupForNotes(page);
		await mockCreateNote(page);
		await page.goto('/');

		await page.getByTitle('Notes').click();
		await page.locator('.note-list').click({ button: 'right' });

		await expect(page.locator('.ctx-menu')).toBeVisible();
		await expect(page.locator('.ctx-menu-item', { hasText: 'New note' })).toBeVisible();
		await expect(page.locator('.ctx-menu-item', { hasText: 'New folder' })).toBeVisible();
	});

	test('context menu closes on Escape', async ({ page }) => {
		await setupForNotes(page);
		await page.goto('/');

		await page.getByTitle('Notes').click();
		await page.locator('.note-list').click({ button: 'right' });
		await expect(page.locator('.ctx-menu')).toBeVisible();

		await page.keyboard.press('Escape');
		await expect(page.locator('.ctx-menu')).not.toBeVisible();
	});

	test('note tree item context menu has Open and Delete options', async ({ page }) => {
		await resetPageState(page);
		await mockActiveVault(page);
		await mockAppearance(page);
		await mockOneNote(page);
		await mockEmptyContacts(page);
		await page.goto('/');

		await page.getByTitle('Notes').click();
		// right-click the note in the tree
		await page.locator('.note-tree-item').first().click({ button: 'right' });

		await expect(page.locator('.ctx-menu')).toBeVisible();
		// Use regex anchors to avoid matching "Open in new tab" when looking for "Open".
		await expect(page.locator('.ctx-menu-item', { hasText: /^Open$/ })).toBeVisible();
		await expect(page.locator('.ctx-menu-item', { hasText: 'Open in new tab' })).toBeVisible();
		await expect(page.locator('.ctx-menu-item.danger', { hasText: /^Delete$/ })).toBeVisible();
	});
});
