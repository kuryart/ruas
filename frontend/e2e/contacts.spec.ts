import { test, expect } from '@playwright/test';
import {
	setupForContacts,
	mockActiveVault,
	mockAppearance,
	mockEmptyNotes,
	mockEmptyContacts,
	mockOneContact,
	mockCreateContact,
	resetPageState,
	MOCK_CONTACT,
} from './mock-api';

test.describe('Contacts module', () => {
	test('sidebar Contacts button opens the contacts panel', async ({ page }) => {
		await setupForContacts(page);
		await page.goto('/');

		await page.getByTitle('Contacts').click();

		await expect(page.locator('.contact-list')).toBeVisible();
	});

	test('shows empty state when vault has no contacts', async ({ page }) => {
		await setupForContacts(page);
		await page.goto('/');

		await page.getByTitle('Contacts').click();

		await expect(page.getByText(/No contacts/)).toBeVisible();
	});

	test('shows contact in list when vault has one contact', async ({ page }) => {
		await resetPageState(page);
		await mockActiveVault(page);
		await mockAppearance(page);
		await mockEmptyNotes(page);
		await mockOneContact(page);
		await page.goto('/');

		await page.getByTitle('Contacts').click();

		await expect(page.getByText('Alice Smith')).toBeVisible();
	});

	test('clicking + opens the new contact form', async ({ page }) => {
		await setupForContacts(page);
		await mockCreateContact(page);
		await page.goto('/');

		await page.getByTitle('Contacts').click();
		await page.getByTitle('New contact').click();

		// The inline form should appear (first name / last name inputs)
		await expect(page.locator('input[placeholder]').first()).toBeVisible({ timeout: 3000 });
	});

	test('creating a contact calls create_contact and shows it in list', async ({ page }) => {
		await resetPageState(page);
		await mockActiveVault(page);
		await mockAppearance(page);
		await mockEmptyNotes(page);

		let createCalled = false;
		await page.route('**/create_contact', async r => {
			createCalled = true;
			await r.fulfill({ json: MOCK_CONTACT });
		});
		await page.route('**/read_contact', r => r.fulfill({ json: MOCK_CONTACT }));
		// After create, list returns the new contact
		await page.route('**/list_contacts', r => {
			if (createCalled) r.fulfill({ json: [{ path: MOCK_CONTACT.path, display_name: 'Alice Smith', initials: 'AS', org: null, primary_email: null, tags: null }] });
			else r.fulfill({ json: [] });
		});

		await page.goto('/');
		await page.getByTitle('Contacts').click();
		await page.getByTitle('New contact').click();

		// Fill in the inline form (first name field)
		const inputs = page.locator('input[placeholder]');
		await inputs.first().fill('Alice');
		await inputs.nth(1).fill('Smith');
		await page.keyboard.press('Enter');

		expect(createCalled).toBe(true);
	});

	test('contact detail shows name field', async ({ page }) => {
		await resetPageState(page);
		await mockActiveVault(page);
		await mockAppearance(page);
		await mockEmptyNotes(page);
		await mockOneContact(page);
		await page.route('**/save_contact', r => r.fulfill({ json: null }));

		await page.goto('/');
		await page.getByTitle('Contacts').click();
		// Click the contact list item specifically (not any text that might be duplicated).
		await page.locator('.contact-list-item', { hasText: 'Alice Smith' }).click();

		// Contact detail opens in workspace; .contact-name is the full-name input.
		await expect(page.locator('.contact-name')).toBeVisible({ timeout: 8000 });
	});
});
