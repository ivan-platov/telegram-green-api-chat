import { defineConfig } from '@playwright/test'

import base from './playwright.config.ts'

export default defineConfig({
  ...base,
  testMatch: [
    'chat.spec.ts',
    'reconciliation.spec.ts',
    'storage-and-races.spec.ts',
    'ui-refinement.spec.ts',
    'max-theme.spec.ts',
    'composer.spec.ts',
    'notifications.spec.ts',
    'status-presentation.spec.ts',
  ],
  use: { ...base.use, baseURL: 'http://127.0.0.1:5189' },
  webServer: {
    command: 'npm run preview -- --port 5189 --strictPort',
    url: 'http://127.0.0.1:5189',
    reuseExistingServer: false,
    timeout: 30000,
  },
})
