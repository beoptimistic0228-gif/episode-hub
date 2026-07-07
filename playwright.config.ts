import { defineConfig } from '@playwright/test';

// Electron e2e: 별도 브라우저가 아니라 빌드된 앱(out/main)을 _electron으로 띄운다.
// (interior-studio/playwright.config.ts와 동일 패턴 — testDir/testMatch로 vitest와 분리)
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
});
