import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';

export default {
  projectId: 'register-login-e2e',
  workers: 1,
  retries: 0,
  assertionTimeout: 15_000,
  actionTimeout: 15_000,
  video: 'retain-on-failure',
  output: '.e2e',
  targets: [
    {
      name: 'web',
      engine: web({ browser: 'chromium' }),
      app: { url: 'http://localhost:3100' },
    },
  ],
} satisfies E2EConfig;
