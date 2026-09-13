import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './e2e', testMatch: '*.spec.js', workers: 1, timeout: 40000,
  use: { baseURL: 'http://127.0.0.1:3187', headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure',
    ...(process.env.E2E_CHROME ? { channel: 'chrome' } : {}) },
  webServer: { command: 'node e2e/server.mjs', url: 'http://127.0.0.1:3187', reuseExistingServer: !process.env.CI, timeout: 30000 } });
