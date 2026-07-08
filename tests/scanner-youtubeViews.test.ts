import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanEpisodes } from '../src/main/scanner';

function makeEp(root: string, id: string, doc: object) {
  const dir = join(root, 'output', 'episodes', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'episode.json'), JSON.stringify(doc));
}

describe('scanEpisodes youtubeViews 조인', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'hub-scan-')); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('발행 유튜브 URL의 조회수를 요약에 붙임', () => {
    makeEp(root, 'ep20260708_x', {
      schema_version: 1, title: 'T', stage: '', approvals: {},
      publications: [{ platform: 'youtube', date: '2026-07-08', url: 'https://youtu.be/aaaaaaaaaaa' }],
    });
    const videos = { aaaaaaaaaaa: { views: 32000, likes: 0, at: 'x' } };
    const eps = scanEpisodes(root, videos);
    expect(eps[0].youtubeViews).toBe(32000);
  });

  test('URL 없거나 매칭 없으면 undefined', () => {
    makeEp(root, 'ep20260708_y', { schema_version: 1, title: 'T', stage: '', approvals: {}, publications: [] });
    expect(scanEpisodes(root, {})[0].youtubeViews).toBeUndefined();
  });
});
