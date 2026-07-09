import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateImagesToImageRoot } from '../src/main/imageMigrate';

const ID = 'ep20260709_mig';

describe('migrateImagesToImageRoot', () => {
  let root: string; let imageRoot: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mig-repo-'));
    imageRoot = mkdtempSync(join(tmpdir(), 'mig-img-'));
    const ep = join(root, 'output', 'episodes', ID, 'renders');
    mkdirSync(ep, { recursive: true });
    writeFileSync(join(ep, 'a.png'), 'x');
    writeFileSync(join(root, 'output', 'episodes', ID, 'renders', 'notes.md'), '# n'); // 비이미지 — 제외
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(imageRoot, { recursive: true, force: true });
  });

  test('레포 이미지를 imageRoot 동일 구조로 복사(비이미지 제외)', () => {
    const { copied } = migrateImagesToImageRoot(root, imageRoot);
    expect(copied).toBe(1);
    expect(existsSync(join(imageRoot, ID, 'renders', 'a.png'))).toBe(true);
    expect(existsSync(join(imageRoot, ID, 'renders', 'notes.md'))).toBe(false);
  });

  test('이미 존재하면 건너뜀(copied 0)', () => {
    migrateImagesToImageRoot(root, imageRoot);
    expect(migrateImagesToImageRoot(root, imageRoot).copied).toBe(0);
  });
});
