import { defineConfig } from '@playwright/test';

const APP_PORT = 5301;
/** Trusted harness origin (plays the webview). */
export const HARNESS = 'http://127.0.0.1:5302';
/** Same harness on an origin the client must not trust. */
export const UNTRUSTED_HARNESS = 'http://127.0.0.1:5303';
export const APP_URL = `http://localhost:${APP_PORT}/h-app/`;

export default defineConfig({
  testDir: 'tests/page',
  fullyParallel: false,
  workers: 1,
  use: { browserName: 'chromium', headless: true },
  webServer: [
    {
      command: `npx vite --port ${APP_PORT} --strictPort`,
      cwd: 'fixtures/h-app',
      url: `${APP_URL}`,
      env: { VIBE_VISUAL_EDITOR_TRUSTED_ORIGIN: HARNESS },
      reuseExistingServer: false,
    },
    {
      command: 'node tests/harness/serve.mjs 5302 5303',
      url: `${HARNESS}/?target=x`,
      reuseExistingServer: false,
    },
  ],
});
