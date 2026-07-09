import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanEpisodeDetail } from '../src/main/scanner';

const ID = 'ep20260709_img';
const GOOD_DOC = JSON.stringify({ schema_version: 1, title: 'T', stage: '', approvals: {} });

function makeEp(root: string) {
  const ep = join(root, 'output', 'episodes', ID);
  mkdirSync(join(ep, 'renders'), { recursive: true });
  writeFileSync(join(ep, 'episode.json'), GOOD_DOC);
  return ep;
}

describe('scanEpisodeDetail — imageRoot 병합', () => {
  let root: string; let imageRoot: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'scan-repo-'));
    imageRoot = mkdtempSync(join(tmpdir(), 'scan-img-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(imageRoot, { recursive: true, force: true });
  });

  test('imageRoot 설정 시 이미지는 imageRoot에서, 레포 이미지는 제외', () => {
    const ep = makeEp(root);
    writeFileSync(join(ep, 'renders', 'repo_old.png'), 'x'); // 레포 잔여 이미지 — 제외돼야
    writeFileSync(join(ep, 'renders', 'notes.md'), '# n');   // 레포 텍스트 — 유지
    mkdirSync(join(imageRoot, ID, 'renders'), { recursive: true });
    writeFileSync(join(imageRoot, ID, 'renders', 'synced.png'), 'y'); // imageRoot 이미지 — 표시

    const d = scanEpisodeDetail(root, ID, imageRoot);
    const names = d.files.renders.map((f) => f.name).sort();
    expect(names).toEqual(['notes.md', 'synced.png']); // repo_old.png 없음
    expect(d.files.renders.find((f) => f.kind === 'image')?.name).toBe('synced.png');
  });

  test('imageRoot 미설정 시 레포 이미지 유지(하위호환)', () => {
    const ep = makeEp(root);
    writeFileSync(join(ep, 'renders', 'repo_old.png'), 'x');
    const d = scanEpisodeDetail(root, ID); // imageRoot 없음
    expect(d.files.renders.map((f) => f.name)).toEqual(['repo_old.png']);
  });

  test('imageRoot 폴더 자체가 없어도 크래시 없이 레포 텍스트만', () => {
    const ep = makeEp(root);
    writeFileSync(join(ep, 'renders', 'notes.md'), '# n');
    const missing = join(imageRoot, 'nope');
    const d = scanEpisodeDetail(root, ID, missing);
    expect(d.files.renders.map((f) => f.name)).toEqual(['notes.md']);
  });
});
