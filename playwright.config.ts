import { defineConfig } from '@playwright/test'

const baseURL = 'http://127.0.0.1:5188'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  outputDir: '.artifacts/test-results',
  reporter: [['list'], ['json', { outputFile: '.artifacts/e2e-results.json' }]],
  use: {
    baseURL,
    browserName: 'chromium',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 5188',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30000,
  },
})
