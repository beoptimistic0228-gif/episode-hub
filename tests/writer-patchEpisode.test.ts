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

  test('schema_version ≠ 1 → throw', () => {
    const id = ep(root, { ...BASE, schema_version: 2 });
    expect(() => patchEpisode(root, id, { approve: { key: 'moodboard' } })).toThrow(/schema_version/);
  });

  test('addPublication → publications 배열에 누적, removePublication → 해당 index 삭제', () => {
    const id = ep(root, BASE);
    const r1 = patchEpisode(root, id, { addPublication: { platform: 'youtube', date: '2026-07-08', url: 'https://youtu.be/x' } });
    expect(r1.doc.publications).toHaveLength(1);
    expect(r1.doc.publications?.[0]).toMatchObject({ platform: 'youtube', date: '2026-07-08', url: 'https://youtu.be/x' });
    const r2 = patchEpisode(root, id, { addPublication: { platform: 'blog', date: '2026-07-09' } });
    expect(r2.doc.publications).toHaveLength(2);
    const r3 = patchEpisode(root, id, { removePublication: { index: 0 } });
    expect(r3.doc.publications).toHaveLength(1);
    expect(r3.doc.publications?.[0].platform).toBe('blog');
  });

  test('addPublication — 잘못된 platform·날짜 형식은 throw', () => {
    const id = ep(root, BASE);
    expect(() => patchEpisode(root, id, { addPublication: { platform: 'tiktok', date: '2026-07-08' } as never })).toThrow(/platform/);
    expect(() => patchEpisode(root, id, { addPublication: { platform: 'blog', date: '07/08' } })).toThrow(/date/);
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
