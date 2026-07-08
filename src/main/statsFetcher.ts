import type { YoutubeStat, VideoStat } from '@shared/stats';

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
