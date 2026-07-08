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

/** 네이버 방문자 AJAX(NVisitorgp4Ajax) XML: <visitorcnt id="YYYYMMDD" cnt="N"/> 반복 */
export function parseNaverVisitors(xml: string): { today: number; total: number } {
  const matches = [...xml.matchAll(/<visitorcnt\b[^>]*\bcnt="(\d+)"/g)].map((m) => Number(m[1]));
  if (matches.length === 0) throw new Error('방문자 데이터 없음');
  const total = matches.reduce((a, b) => a + b, 0);
  return { today: matches[matches.length - 1], total };
}

/** 이웃수 best-effort — 프로필 HTML에서 '이웃 N' 패턴. 실패 시 throw(호출측 carry-forward) */
export function parseNaverNeighbors(html: string): number {
  const m = html.match(/이웃[^0-9]{0,10}([0-9,]+)/);
  if (!m) throw new Error('이웃수 파싱 실패');
  return Number(m[1].replace(/,/g, ''));
}

const YT = 'https://www.googleapis.com/youtube/v3';
const TIMEOUT_MS = 10_000;

async function getText(fetchFn: typeof fetch, url: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetchFn(url, { signal: ctrl.signal });
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
        const vJson = JSON.parse(await getText(fetchFn, `${YT}/videos?part=statistics&id=${ids.join(',')}&key=${deps.apiKey}`));
        videos = parseYouTubeVideos(vJson, at);
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
    const vx = await getText(fetchFn, `https://blog.naver.com/NVisitorgp4Ajax.naver?blogId=${NAVER_BLOG_ID}`);
    const { today: vToday, total: vTotal } = parseNaverVisitors(vx);
    let neighbors = prev?.blog?.neighbors ?? 0;
    try {
      const html = await getText(fetchFn, `https://blog.naver.com/${NAVER_BLOG_ID}`);
      neighbors = parseNaverNeighbors(html);
    } catch { /* 이웃수만 실패 — 방문자는 유지 */ }
    blog = { neighbors, visitorsTotal: vTotal, visitorsToday: vToday };
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
  return join(gitRoot, 'episode-hub', 'data', 'channel_stats.json');
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
  const prev = latestSnapshot(readStats(gitRoot));
  const { snapshot, videos } = await collectSnapshot({ apiKey, videoIds, prev });
  const cur = readStats(gitRoot);
  const merged: ChannelStats = { ...upsertSnapshot(cur, snapshot), videos: { ...cur.videos, ...videos } };
  writeStats(gitRoot, merged);
  return merged;
}
