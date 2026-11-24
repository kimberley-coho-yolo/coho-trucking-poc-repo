import { defineConfig } from '@playwright/test';
// End-to-end smoke tests run against the built app in demo mode (no database needed).
export default defineConfig({
  testDir: './e2e',
  webServer: { command: 'npm run build && npm run preview -- --port 4173 --strictPort', port: 4173, reuseExistingServer: true, timeout: 120_000 },
  use: {
    baseURL: 'http://localhost:4173/', viewport: { width: 400, height: 860 },
    // Optional: point at an already-installed Chromium instead of `npx playwright install chromium`.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
});
