import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readEnvKey } from '../src/main/config';

describe('readEnvKey — orchestrator/.env 파싱', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'hub-env-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  test('키 반환 (따옴표·주석·공백 처리)', () => {
    writeFileSync(join(root, '.env'), '# c\nYOUTUBE_API_KEY = "AIzaABC"\nNAVER_ID=x\n');
    expect(readEnvKey(root, 'YOUTUBE_API_KEY')).toBe('AIzaABC');
  });
  test('플레이스홀더는 null', () => {
    writeFileSync(join(root, '.env'), 'YOUTUBE_API_KEY=YOUR_KEY_HERE\n');
    expect(readEnvKey(root, 'YOUTUBE_API_KEY')).toBeNull();
  });
  test('파일 없음 → null', () => {
    expect(readEnvKey(root, 'YOUTUBE_API_KEY')).toBeNull();
  });
  test('없는 키 → null', () => {
    writeFileSync(join(root, '.env'), 'OTHER=1\n');
    expect(readEnvKey(root, 'YOUTUBE_API_KEY')).toBeNull();
  });
});
