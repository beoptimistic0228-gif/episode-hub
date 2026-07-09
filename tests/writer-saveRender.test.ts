import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveRender } from '../src/main/writer';

const bytes = new Uint8Array([1, 2, 3]);
const ID = 'ep20260628_t';

describe('saveRender — imageRoot에 저장', () => {
  let imageRoot: string;
  beforeEach(() => { imageRoot = mkdtempSync(join(tmpdir(), 'sr-img-')); });
  afterEach(() => { rmSync(imageRoot, { recursive: true, force: true }); });

  test('규칙명 저장 — <imageRoot>/<id>/renders/<정규화 카테고리>__<row>.png', () => {
    const r = saveRender(imageRoot, ID, '게이밍 데스크', 'row1', bytes);
    expect(r).toEqual({ ok: true, relPath: 'renders/게이밍_데스크__row1.png' });
    const full = join(imageRoot, ID, 'renders', '게이밍_데스크__row1.png');
    expect(existsSync(full)).toBe(true);
    expect(readFileSync(full)).toEqual(Buffer.from(bytes));
  });

  test('잘못된 row 거부', () => {
    expect(() => saveRender(imageRoot, ID, '책상', 'row3', bytes)).toThrow(/row/);
  });

  test('동일명 존재 + overwrite 미지정 → exists', () => {
    saveRender(imageRoot, ID, '책상', 'row1', bytes);
    expect(saveRender(imageRoot, ID, '책상', 'row1', bytes)).toEqual({ exists: true });
    expect(saveRender(imageRoot, ID, '책상', 'row1', new Uint8Array([9]), true))
      .toMatchObject({ ok: true });
  });
});
