export type SourceStatus = 'ok' | 'stale' | 'error';

export interface YoutubeStat { subscribers: number; views: number; videos: number }
export interface BlogStat { neighbors: number; visitorsTotal: number; visitorsToday: number }

export interface ChannelSnapshot {
  date: string; // 로컬 YYYY-MM-DD (행 키)
  at: string;   // 수집 시각 ISO
  youtube: YoutubeStat | null;
  blog: BlogStat | null;
  sources: { youtube: SourceStatus; blog: SourceStatus };
}

export interface VideoStat { views: number; likes: number; at: string }

export interface ChannelStats {
  schema_version: 1;
  snapshots: ChannelSnapshot[];
  videos: Record<string, VideoStat>;
}

// main ipc.ts SNS_LINKS와 동일 채널 (단일값 — Global Constraints)
export const CHANNEL_ID = 'UCqMBCXReIpCPa4PzWiT2grw';
export const NAVER_BLOG_ID = 'be_optimistic228';

export function emptyStats(): ChannelStats {
  return { schema_version: 1, snapshots: [], videos: {} };
}

/** 같은 date면 덮어쓰기, 아니면 추가 후 date 오름차순 정렬 */
export function upsertSnapshot(stats: ChannelStats, snap: ChannelSnapshot): ChannelStats {
  const snapshots = stats.snapshots.filter((s) => s.date !== snap.date);
  snapshots.push(snap);
  snapshots.sort((a, b) => a.date.localeCompare(b.date));
  return { ...stats, snapshots };
}

export function latestSnapshot(stats: ChannelStats): ChannelSnapshot | null {
  return stats.snapshots.length ? stats.snapshots[stats.snapshots.length - 1] : null;
}

/** date 이하 스냅샷 중 가장 최근 (델타 기준선용) */
export function snapshotOnOrBefore(stats: ChannelStats, date: string): ChannelSnapshot | null {
  const eligible = stats.snapshots.filter((s) => s.date <= date);
  return eligible.length ? eligible[eligible.length - 1] : null;
}

/** youtu.be/<id> · v=<id> · /shorts/<id> · /embed/<id> (11자 ID) */
export function extractVideoId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

export interface Delta { value: number; sign: 'up' | 'down' | 'flat' }
export function computeDelta(curr: number, prev: number | undefined): Delta {
  if (prev === undefined) return { value: 0, sign: 'flat' };
  const d = curr - prev;
  return { value: d, sign: d > 0 ? 'up' : d < 0 ? 'down' : 'flat' };
}
