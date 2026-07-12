import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  type YoutubeStat, type BlogStat, type VideoStat, type ChannelSnapshot,
  type ChannelStats, emptyStats, upsertSnapshot, latestSnapshot,
  CHANNEL_ID, NAVER_BLOG_ID,
} from '@shared/stats';
import { readEnvKey } from './config';

const num = (v: unknown): number => Number(v ?? 0) || 0;

export function parseYouTubeChannel(json: unknown): YoutubeStat {
  const s = (json as { items?: { statistics?: Record<string, string> }[] })?.items?.[0]?.statistics;
  if (!s) throw new Error('YouTube 채널 statistics 없음');
  return { subscribers: num(s.subscriberCount), views: num(s.viewCount), videos: num(s.videoCount) };
}

export function parseYouTubeVideos(json: unknown, at: string): Record<string, VideoStat> {
  const items = (json as { items?: { id?: string; statistics?: Record<string, string> }[] })?.items ?? [];
  const out: Record<string, VideoStat> = {};
  for (const it of items) {
    if (!it.id) continue;
    out[it.id] = { views: num(it.statistics?.viewCount), likes: num(it.statistics?.likeCount), at };
  }
  return out;
}

/** m.blog.naver.com/api/blogs/{id} JSON → BlogStat. isSuccess=false/필드부재 시 throw(호출측 carry-forward). */
export function parseNaverBlog(json: unknown): BlogStat {
  const j = json as { isSuccess?: boolean; result?: Record<string, unknown> };
  if (!j?.isSuccess || !j.result) throw new Error('네이버 블로그 응답 오류');
  const r = j.result;
  return {
    neighbors: num(r.subscriberCount),
    visitorsTotal: num(r.totalVisitorCount),
    visitorsToday: num(r.dayVisitorCount),
  };
}

const YT = 'https://www.googleapis.com/youtube/v3';
const TIMEOUT_MS = 10_000;

/** 테스트 seam — HUB_STATS_MOCK(URL 부분문자열→본문 JSON 맵) 픽스처로 네트워크 없이 응답 ($0·결정성) */
function mockFetch(fixturePath: string): typeof fetch {
  const fx = JSON.parse(readFileSync(fixturePath, 'utf-8')) as Record<string, string>;
  return (async (input: string | URL) => {
    const url = String(input);
    const key = Object.keys(fx).find((k) => url.includes(k));
    const body = key ? fx[key] : '';
    return { ok: !!key, status: key ? 200 : 500, text: async () => body, json: async () => JSON.parse(body) } as Response;
  }) as typeof fetch;
}

async function getText(fetchFn: typeof fetch, url: string, headers?: Record<string, string>): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetchFn(url, { signal: ctrl.signal, ...(headers ? { headers } : {}) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

export interface CollectDeps {
  fetchFn?: typeof fetch;
  apiKey?: string | null;
  today?: string;
  videoIds?: string[];
  prev?: ChannelSnapshot | null;
}

/** 소스별 격리 수집 — 한 소스 실패가 다른 소스·앱을 죽이지 않는다 */
export async function collectSnapshot(
  deps: CollectDeps,
): Promise<{ snapshot: ChannelSnapshot; videos: Record<string, VideoStat> }> {
  const fetchFn = deps.fetchFn ?? fetch;
  const today = deps.today ?? new Date().toISOString().slice(0, 10);
  const at = new Date().toISOString();
  const prev = deps.prev ?? null;

  // ── YouTube ──
  let youtube: YoutubeStat | null = null;
  let ytStatus: ChannelSnapshot['sources']['youtube'] = 'error';
  let videos: Record<string, VideoStat> = {};
  if (deps.apiKey) {
    try {
      const chJson = JSON.parse(await getText(fetchFn, `${YT}/channels?part=statistics&id=${CHANNEL_ID}&key=${deps.apiKey}`));
      youtube = parseYouTubeChannel(chJson);
      ytStatus = 'ok';
      const ids = (deps.videoIds ?? []).slice(0, 50);
      if (ids.length) {
        try {
          const vJson = JSON.parse(await getText(fetchFn, `${YT}/videos?part=statistics&id=${ids.join(',')}&key=${deps.apiKey}`));
          videos = parseYouTubeVideos(vJson, at);
        } catch { /* 영상 배치만 실패 — 채널 통계는 유지 */ }
      }
    } catch {
      if (prev?.youtube) { youtube = prev.youtube; ytStatus = 'stale'; }
      else { youtube = null; ytStatus = 'error'; }
    }
  } else if (prev?.youtube) { youtube = prev.youtube; ytStatus = 'stale'; }

  // ── Naver Blog ──
  let blog: BlogStat | null = null;
  let blogStatus: ChannelSnapshot['sources']['blog'] = 'error';
  try {
    const url = `https://m.blog.naver.com/api/blogs/${NAVER_BLOG_ID}`;
    const body = await getText(fetchFn, url, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': `https://m.blog.naver.com/${NAVER_BLOG_ID}`,
    });
    blog = parseNaverBlog(JSON.parse(body));
    blogStatus = 'ok';
  } catch {
    if (prev?.blog) { blog = prev.blog; blogStatus = 'stale'; }
    else { blog = null; blogStatus = 'error'; }
  }

  return {
    snapshot: { date: today, at, youtube, blog, sources: { youtube: ytStatus, blog: blogStatus } },
    videos,
  };
}

export function statsFilePath(gitRoot: string): string {
  // 2026-07-10 통계 경로 이전(콘텐츠 레포 e3a2464)의 앱 측 반영 — 옛 루트 episode-hub/data는 폐지.
  return join(gitRoot, 'orchestrator', 'data', 'channel_stats.json');
}

export function readStats(gitRoot: string): ChannelStats {
  try {
    const s = JSON.parse(readFileSync(statsFilePath(gitRoot), 'utf-8')) as ChannelStats;
    if (s.schema_version !== 1) return emptyStats();
    return { schema_version: 1, snapshots: s.snapshots ?? [], videos: s.videos ?? {} };
  } catch { return emptyStats(); }
}

function writeStats(gitRoot: string, stats: ChannelStats): void {
  const file = statsFilePath(gitRoot);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(stats, null, 2) + '\n', 'utf-8');
}

/** 수집 → upsert → 파일 기록. 커밋/푸시는 호출측(ipc)이 commitStats로. */
export async function refreshStats(
  gitRoot: string, orchestratorRoot: string, videoIds: string[],
): Promise<ChannelStats> {
  const apiKey = process.env.YOUTUBE_API_KEY || readEnvKey(orchestratorRoot, 'YOUTUBE_API_KEY');
  const mock = process.env.HUB_STATS_MOCK;
  const fetchFn = mock ? mockFetch(mock) : undefined;
  const prev = latestSnapshot(readStats(gitRoot));
  const { snapshot, videos } = await collectSnapshot({ fetchFn, apiKey, videoIds, prev });
  const cur = readStats(gitRoot);
  const merged: ChannelStats = { ...upsertSnapshot(cur, snapshot), videos: { ...cur.videos, ...videos } };
  writeStats(gitRoot, merged);
  return merged;
}
