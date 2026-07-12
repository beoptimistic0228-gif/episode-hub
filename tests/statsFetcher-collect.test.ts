import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectSnapshot, statsFilePath, readStats } from '../src/main/statsFetcher';
import type { ChannelSnapshot } from '../src/shared/stats';

// 가짜 fetch — URL로 분기해 픽스처 응답을 준다.
function fakeFetch(map: Record<string, { ok?: boolean; body: string }>): typeof fetch {
  return (async (input: string | URL) => {
    const url = String(input);
    const key = Object.keys(map).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected url ${url}`);
    const { ok = true, body } = map[key];
    return { ok, status: ok ? 200 : 500, text: async () => body, json: async () => JSON.parse(body) } as Response;
  }) as typeof fetch;
}

describe('collectSnapshot', () => {
  test('유튜브+블로그 모두 성공', async () => {
    const f = fakeFetch({
      '/channels': { body: JSON.stringify({ items: [{ statistics: { subscriberCount: '12340', viewCount: '458200', videoCount: '42' } }] }) },
      '/videos': { body: JSON.stringify({ items: [{ id: 'aaaaaaaaaaa', statistics: { viewCount: '32000', likeCount: '1200' } }] }) },
      'm.blog.naver.com/api/blogs': { body: JSON.stringify({ isSuccess: true, result: { dayVisitorCount: 210, totalVisitorCount: 45100, subscriberCount: 320 } }) },
    });
    const { snapshot, videos } = await collectSnapshot({ fetchFn: f, apiKey: 'K', today: '2026-07-08', videoIds: ['aaaaaaaaaaa'] });
    expect(snapshot.youtube).toEqual({ subscribers: 12340, views: 458200, videos: 42 });
    expect(snapshot.sources.youtube).toBe('ok');
    expect(snapshot.blog).toEqual({ neighbors: 320, visitorsTotal: 45100, visitorsToday: 210 });
    expect(videos['aaaaaaaaaaa'].views).toBe(32000);
  });

  test('API 키 없음 → 유튜브 error, 블로그는 정상', async () => {
    const f = fakeFetch({ 'm.blog.naver.com/api/blogs': { body: JSON.stringify({ isSuccess: true, result: { dayVisitorCount: 210, totalVisitorCount: 45100, subscriberCount: 320 } }) } });
    const { snapshot } = await collectSnapshot({ fetchFn: f, apiKey: null, today: '2026-07-08' });
    expect(snapshot.sources.youtube).toBe('error');
    expect(snapshot.youtube).toBeNull();
    expect(snapshot.sources.blog).toBe('ok');
  });

  test('블로그 크롤 실패 → carry-forward + stale', async () => {
    const prev: ChannelSnapshot = { date: '2026-07-07', at: 'x', youtube: null, blog: { neighbors: 300, visitorsTotal: 44000, visitorsToday: 190 }, sources: { youtube: 'error', blog: 'ok' } };
    const f = fakeFetch({
      '/channels': { body: JSON.stringify({ items: [{ statistics: { subscriberCount: '1', viewCount: '1', videoCount: '1' } }] }) },
      'm.blog.naver.com/api/blogs': { ok: false, body: '' },
    });
    const { snapshot } = await collectSnapshot({ fetchFn: f, apiKey: 'K', today: '2026-07-08', prev });
    expect(snapshot.sources.blog).toBe('stale');
    expect(snapshot.blog).toEqual(prev.blog); // carry-forward
  });
});

describe('readStats', () => {
  test('파일 없으면 빈 구조', () => {
    const g = mkdtempSync(join(tmpdir(), 'hub-stats-'));
    expect(readStats(g)).toEqual({ schema_version: 1, snapshots: [], videos: {} });
    expect(statsFilePath(g).endsWith(join('orchestrator', 'data', 'channel_stats.json'))).toBe(true);
    rmSync(g, { recursive: true, force: true });
  });
});
