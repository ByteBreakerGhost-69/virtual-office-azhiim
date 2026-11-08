import { defineConfig } from '@playwright/test';

const WEB = 'http://127.0.0.1:5173';
const E2E_DB = process.env.E2E_DATABASE_URL ?? 'postgresql://avo:avo_dev_password@127.0.0.1:5433/avo_e2e';
// Test-only key (not a secret): lets the e2e API encrypt integration secrets.
const E2E_KEY = 'ZTJlLXRlc3Qta2V5LW5vdC1hLXNlY3JldC0zMmJ5dGU=';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: WEB,
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // PW_CHROMIUM_PATH lets an offline machine reuse an already-installed Chromium; CI runs `playwright install chromium`.
    launchOptions: { ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: [
    {
      // fresh schema on every run, then the real API
      command: 'npx tsx scripts/apply-migrations.ts && npx tsx src/server.ts',
      cwd: '../api',
      url: 'http://127.0.0.1:8787/api/v1/health',
      reuseExistingServer: false,
      timeout: 60_000,
      env: { DATABASE_URL: E2E_DB, APP_ENCRYPTION_KEY: E2E_KEY, API_PORT: '8787', API_HOST: '127.0.0.1', CORS_ORIGINS: WEB, SIMULATION_SPEED: '25', LOG_LEVEL: 'warn' },
    },
    { command: 'npx vite --host 127.0.0.1 --port 5173 --strictPort', url: WEB, reuseExistingServer: false, timeout: 60_000 },
    {
      // TEST DOUBLE of the documented Hermes API (not a real Hermes)
      command: 'npx tsx ../../packages/adapters/src/testing/cli.ts',
      port: 8643,
      reuseExistingServer: false,
      env: { HERMES_DOUBLE_PORT: '8643', HERMES_DOUBLE_KEY: 'e2e-double-key', HERMES_DOUBLE_STEP_MS: '1200' },
    },
  ],
});
