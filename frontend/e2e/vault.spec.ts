import { test, expect } from '@playwright/test';
import {
	mockNoActiveVault,
	mockVaultCommands,
	mockAppearance,
	mockEmptyNotes,
	mockEmptyContacts,
	resetPageState,
	MOCK_VAULT,
} from './mock-api';

test.describe('Vault screen', () => {
	test('shows vault screen when no vault is open', async ({ page }) => {
		await resetPageState(page);
		await mockNoActiveVault(page);
		await page.goto('/');

		await expect(page.getByText('Ruas')).toBeVisible();
		await expect(page.getByRole('button', { name: 'New Vault' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Open Vault' })).toBeVisible();
	});

	test('clicking New Vault shows the creation form', async ({ page }) => {
		await resetPageState(page);
		await mockNoActiveVault(page);
		await page.goto('/');

		await page.getByRole('button', { name: 'New Vault' }).click();

		await expect(page.getByText('Vault name')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Create' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
	});

	test('cancelling the form returns to the home screen', async ({ page }) => {
		await resetPageState(page);
		await mockNoActiveVault(page);
		await page.goto('/');

		await page.getByRole('button', { name: 'New Vault' }).click();
		await page.getByRole('button', { name: 'Cancel' }).click();

		await expect(page.getByRole('button', { name: 'New Vault' })).toBeVisible();
	});

	test('completing vault creation enters the main app', async ({ page }) => {
		await resetPageState(page);
		await mockNoActiveVault(page);
		await mockVaultCommands(page, MOCK_VAULT);
		await mockAppearance(page);
		await mockEmptyNotes(page);
		await mockEmptyContacts(page);
		await page.goto('/');

		await page.getByRole('button', { name: 'New Vault' }).click();

		// Fill in the vault name
		await page.getByPlaceholder('My Vault').fill('My Test Vault');

		// Pick a folder (mocked to return the vault path immediately)
		await page.getByRole('button', { name: 'Choose' }).click();

		// Submit
		await page.getByRole('button', { name: 'Create' }).click();

		// Should now show the main app (sidebar visible)
		await expect(page.locator('.app-shell')).toBeVisible({ timeout: 5000 });
	});
});
