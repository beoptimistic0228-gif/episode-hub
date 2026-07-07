import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeText } from '../src/main/writer';

function ep(root: string, id = 'ep20260628_t') {
  const dir = join(root, 'output', 'episodes', id, 'script');
  mkdirSync(dir, { recursive: true });
  return id;
}

describe('writeText', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'wt-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  test('신규 파일 저장 + mtime 반환', () => {
    const id = ep(root);
    const r = writeText(root, id, 'script/a.md', '# hi');
    expect(r).toMatchObject({ ok: true });
    const full = join(root, 'output', 'episodes', id, 'script', 'a.md');
    expect(readFileSync(full, 'utf-8')).toBe('# hi');
  });

  test('.md 아닌 확장자 거부', () => {
    const id = ep(root);
    expect(() => writeText(root, id, 'script/a.txt', 'x')).toThrow(/md/);
  });

  test('경로 이탈 거부', () => {
    const id = ep(root);
    expect(() => writeText(root, id, '../../data/x.md', 'x')).toThrow(/이탈/);
  });

  test('mtime 일치 시 저장, 불일치 시 conflict', () => {
    const id = ep(root);
    const full = join(root, 'output', 'episodes', id, 'script', 'a.md');
    writeFileSync(full, 'orig');
    const m = statSync(full).mtimeMs;
    const ok = writeText(root, id, 'script/a.md', 'new', m);
    expect(ok).toMatchObject({ ok: true });
    const conflict = writeText(root, id, 'script/a.md', 'newer', m); // m은 이제 stale
    expect(conflict).toMatchObject({ conflict: true });
    expect(readFileSync(full, 'utf-8')).toBe('new'); // conflict는 저장 안 함
  });
});
