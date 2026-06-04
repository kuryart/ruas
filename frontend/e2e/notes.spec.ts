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

		// Before: empty
		await mockEmptyNotes(page);
		// After create: list includes new note
		let createCalled = false;
		await page.route('**/create_note', async r => {
			createCalled = true;
			await r.fulfill({ json: MOCK_NOTE });
		});
		await page.route('**/list_notes', r => {
			if (createCalled) r.fulfill({ json: [{ path: MOCK_NOTE.path, title: 'Test Note', tags: null, modified: null }] });
			else r.fulfill({ json: [] });
		});
		await page.route('**/list_notes_tree', r => r.fulfill({ json: [] }));
		await page.route('**/read_note', r => r.fulfill({ json: MOCK_NOTE }));

		await page.goto('/');
		await page.getByTitle('Notes').click();
		await page.getByTitle('New note').click();

		// create_note was called
		expect(createCalled).toBe(true);
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
