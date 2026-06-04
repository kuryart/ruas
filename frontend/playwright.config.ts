import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? 'github' : 'list',

	use: {
		baseURL: 'http://localhost:4321',
		locale: 'en-US',
		// Collect traces on first retry to help diagnose CI failures.
		trace: 'on-first-retry',
	},

	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
	],

	// Start the Astro dev server before tests.
	// In CI, always start fresh; locally reuse if already running.
	webServer: {
		command: 'pnpm dev',
		url: 'http://localhost:4321',
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
