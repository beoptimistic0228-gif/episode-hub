import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanEpisodes, scanEpisodeDetail, classifyKind } from '../src/main/scanner';

function makeEpisode(root: string, id: string, doc: object | string): string {
  const ep = join(root, 'output', 'episodes', id);
  mkdirSync(join(ep, 'prompts'), { recursive: true });
  mkdirSync(join(ep, 'products'), { recursive: true });
  writeFileSync(join(ep, 'episode.json'),
    typeof doc === 'string' ? doc : JSON.stringify(doc), 'utf-8');
  return ep;
}

const GOOD_DOC = {
  schema_version: 1, title: '코지 룸', stage: '렌더',
  approvals: { moodboard: { approved: true } },
  total_estimate: { low: 667250, high: 667250, label: '60만원대' },
  products: [{ phase: 1, category: '책상', model: 'X', qty: 2, price_lowest: 104800 }],
};

describe('scanEpisodes', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'scan-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  test('정상 EP — 요약·그룹 카운트', () => {
    const ep = makeEpisode(root, 'ep20260628_test', GOOD_DOC);
    writeFileSync(join(ep, 'prompts', 'master_sheets_prompts.md'), '# x');
    writeFileSync(join(ep, 'products', 'p1.jpg'), '');
    const list = scanEpisodes(root);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('ep20260628_test');
    expect(list[0].title).toBe('코지 룸');
    expect(list[0].stage).toBe('렌더');
    expect(list[0].error).toBeUndefined();
    expect(list[0].groupCounts.prompts).toBe(1);
    expect(list[0].groupCounts.products).toBe(1);
    expect(list[0].groupCounts.renders).toBe(0);
  });

  test('episode.json 깨짐 → error 배지, throw 안 함', () => {
    makeEpisode(root, 'ep20260601_bad', '{not json');
    const list = scanEpisodes(root);
    expect(list[0].error).toMatch(/파싱/);
    expect(list[0].title).toBe('ep20260601_bad'); // 폴백 = 폴더명
  });

  test('schema_version ≠ 1 → error 배지', () => {
    makeEpisode(root, 'ep20260602_v2', { ...GOOD_DOC, schema_version: 2 });
    expect(scanEpisodes(root)[0].error).toMatch(/schema_version/);
  });

  test('episode.json 자체가 없으면 폴더명 폴백 + error', () => {
    mkdirSync(join(root, 'output', 'episodes', 'ep20260603_noJson', 'script'), { recursive: true });
    const list = scanEpisodes(root);
    expect(list[0].id).toBe('ep20260603_noJson');
    expect(list[0].error).toBeTruthy();
  });

  test('id 역순(최신 먼저) 정렬', () => {
    makeEpisode(root, 'ep20260601_a', GOOD_DOC);
    makeEpisode(root, 'ep20260628_b', GOOD_DOC);
    expect(scanEpisodes(root).map((e) => e.id)).toEqual(['ep20260628_b', 'ep20260601_a']);
  });
});

test('scanEpisodeDetail — 그룹별 FileEntry + mtime 내림차순 + doc 포함', () => {
  const root = mkdtempSync(join(tmpdir(), 'scan-d-'));
  const ep = makeEpisode(root, 'ep20260628_test', GOOD_DOC);
  writeFileSync(join(ep, 'prompts', 'a.md'), '# a');
  writeFileSync(join(ep, 'products', 'p1.jpg'), '');
  const d = scanEpisodeDetail(root, 'ep20260628_test');
  expect(d.doc?.total_estimate?.low).toBe(667250);
  expect(d.files.prompts[0]).toMatchObject({ name: 'a.md', kind: 'md', relPath: 'prompts/a.md' });
  expect(d.files.products[0].kind).toBe('image');
  expect(d.files.renders).toEqual([]);
  rmSync(root, { recursive: true, force: true });
});

test('classifyKind', () => {
  expect(classifyKind('a.md')).toBe('md');
  expect(classifyKind('B.PNG')).toBe('image');
  expect(classifyKind('c.json')).toBe('json');
  expect(classifyKind('d.txt')).toBe('other');
});
