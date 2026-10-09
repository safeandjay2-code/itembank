import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:4173', launchOptions: { executablePath: process.env.PW_CHROMIUM || undefined } },
  webServer: { command: 'npm run build:demo && npm run preview', url: 'http://localhost:4173', reuseExistingServer: false, timeout: 120_000 },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
