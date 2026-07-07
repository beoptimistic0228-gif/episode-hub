import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // 실제 git 서브프로세스(fetch/clone/push)를 쓰는 git-*.test.ts는 병렬 실행 시
  // 기본 5s를 넘길 수 있어(Windows 부하 시) 넉넉한 타임아웃을 준다.
  test: { globals: true, environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 30000, hookTimeout: 30000 },
  resolve: { alias: { '@shared': path.resolve(__dirname, './src/shared') } },
});
