import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { patchEpisode } from '../src/main/writer';

function ep(root: string, doc?: object, id = 'ep20260628_t') {
  const dir = join(root, 'output', 'episodes', id);
  mkdirSync(dir, { recursive: true });
  if (doc) writeFileSync(join(dir, 'episode.json'), JSON.stringify(doc), 'utf-8');
  return id;
}
const BASE = { schema_version: 1, title: 'T', stage: '렌더', approvals: {} };

describe('patchEpisode', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'pe-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  test('approve → approvals[key].approved=true + by/at', () => {
    const id = ep(root, BASE);
    const { doc } = patchEpisode(root, id, { approve: { key: 'moodboard' } });
    expect(doc.approvals.moodboard.approved).toBe(true);
    expect(doc.approvals.moodboard.by).toBe('owner');
    expect(typeof doc.approvals.moodboard.at).toBe('string');
  });

  test('unapprove → 키 삭제 (멱등)', () => {
    const id = ep(root, { ...BASE, approvals: { moodboard: { approved: true } } });
    expect(patchEpisode(root, id, { unapprove: { key: 'moodboard' } }).doc.approvals.moodboard)
      .toBeUndefined();
    expect(patchEpisode(root, id, { unapprove: { key: 'moodboard' } }).doc.approvals.moodboard)
      .toBeUndefined(); // 두 번 해도 안전
  });

  test('stage 화이트리스트 — 허용값 저장, 그 외 throw', () => {
    const id = ep(root, BASE);
    expect(patchEpisode(root, id, { stage: '검수' }).doc.stage).toBe('검수');
    expect(() => patchEpisode(root, id, { stage: 'bogus' })).toThrow(/stage/);
  });

  test('schema_version ≠ 1 → throw', () => {
    const id = ep(root, { ...BASE, schema_version: 2 });
    expect(() => patchEpisode(root, id, { stage: '검수' })).toThrow(/schema_version/);
  });

  test('episode.json 부재 → 골격 생성 후 패치', () => {
    const id = ep(root); // 파일 없음
    const { doc } = patchEpisode(root, id, { approve: { key: 'script_final' } });
    expect(doc.schema_version).toBe(1);
    expect(doc.title).toBe(id);
    expect(doc.approvals.script_final.approved).toBe(true);
    const onDisk = JSON.parse(readFileSync(join(root, 'output', 'episodes', id, 'episode.json'), 'utf-8'));
    expect(onDisk.approvals.script_final.approved).toBe(true);
  });
});
