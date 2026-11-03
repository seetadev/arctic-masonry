import { defineConfig, devices } from '@playwright/test';

const port = process.env.E2E_PORT || '8899';
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${port}`, viewport: { width: 1280, height: 800 } },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } } },
  ],
  // E2E_NO_SERVER=1: test an already running server (the Docker container in CI) instead of starting run.py.
  webServer: process.env.E2E_NO_SERVER ? undefined : {
    command: `${process.env.PYTHON || 'python'} run.py ${port}`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
