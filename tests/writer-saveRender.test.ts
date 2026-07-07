import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveRender } from '../src/main/writer';

function ep(root: string, id = 'ep20260628_t') {
  mkdirSync(join(root, 'output', 'episodes', id), { recursive: true });
  return id;
}
const bytes = new Uint8Array([1, 2, 3]);

describe('saveRender', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'sr-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  test('규칙명 저장 — renders/<정규화 카테고리>__<row>.png', () => {
    const id = ep(root);
    const r = saveRender(root, id, '게이밍 데스크', 'row1', bytes);
    expect(r).toEqual({ ok: true, relPath: 'renders/게이밍_데스크__row1.png' });
    const full = join(root, 'output', 'episodes', id, 'renders', '게이밍_데스크__row1.png');
    expect(existsSync(full)).toBe(true);
    expect(readFileSync(full)).toEqual(Buffer.from(bytes));
  });

  test('잘못된 row 거부', () => {
    const id = ep(root);
    expect(() => saveRender(root, id, '책상', 'row3', bytes)).toThrow(/row/);
  });

  test('동일명 존재 + overwrite 미지정 → exists', () => {
    const id = ep(root);
    saveRender(root, id, '책상', 'row1', bytes);
    expect(saveRender(root, id, '책상', 'row1', bytes)).toEqual({ exists: true });
    expect(saveRender(root, id, '책상', 'row1', new Uint8Array([9]), true))
      .toMatchObject({ ok: true });
  });
});
