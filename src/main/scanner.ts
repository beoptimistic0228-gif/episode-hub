import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { GROUP_KEYS, type GroupKey } from '@shared/groups';
import type { EpisodeDetail, EpisodeDoc, EpisodeSummary, FileEntry } from '@shared/types';
import { extractVideoId, type VideoStat } from '@shared/stats';

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

export function classifyKind(name: string): FileEntry['kind'] {
  if (/\.md$/i.test(name)) return 'md';
  if (IMAGE_EXT.test(name)) return 'image';
  if (/\.json$/i.test(name)) return 'json';
  if (/\.(mp4|mov|webm|m4v)$/i.test(name)) return 'video';
  return 'other';
}

function episodesDir(root: string): string {
  return join(root, 'output', 'episodes');
}

/** episode.json 로드 — 실패해도 throw하지 않고 (doc|null, error|undefined) 반환 (스펙 §4-6) */
function loadDoc(epDir: string): { doc: EpisodeDoc | null; error?: string } {
  const file = join(epDir, 'episode.json');
  if (!existsSync(file)) return { doc: null, error: 'episode.json 없음' };
  try {
    const doc = JSON.parse(readFileSync(file, 'utf-8')) as EpisodeDoc;
    if (doc.schema_version !== 1) {
      return { doc, error: `지원하지 않는 schema_version: ${doc.schema_version}` };
    }
    return { doc };
  } catch (e) {
    return { doc: null, error: `episode.json 파싱 실패: ${(e as Error).message}` };
  }
}

/** 그룹 폴더의 파일 목록 (하위 폴더 1단계 포함 — publish/thumbnails 등), mtime 내림차순 */
function listGroupFiles(epDir: string, group: GroupKey): FileEntry[] {
  const dir = join(epDir, group);
  if (!existsSync(dir)) return [];
  const out: FileEntry[] = [];
  const walk = (d: string, prefix: string) => {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      // 디렉토리 읽기 실패 (권한·삭제 등) — watcher 타이밍 이슈 회피 (§4-6)
      return;
    }
    for (const name of entries) {
      const full = join(d, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        // 파일 삭제/잠금 등으로 stat 실패 — 건너뜀 (watcher 레이스 가드)
        continue;
      }
      if (st.isDirectory()) {
        if (name === '_deprecated') continue; // 폐기 보관함 — 허브에 안 보임 (orchestrator 관례)
        walk(full, `${prefix}${name}/`);
      } else {
        out.push({
          name,
          relPath: `${group}/${prefix}${name}`,
          kind: classifyKind(name),
          mtimeMs: st.mtimeMs,
        });
      }
    }
  };
  walk(dir, '');
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function summarize(
  root: string,
  id: string,
  files?: Record<GroupKey, FileEntry[]>,
  videos?: Record<string, VideoStat>,
): EpisodeSummary {
  const epDir = join(episodesDir(root), id);
  const { doc, error } = loadDoc(epDir);
  const groupCounts = files
    ? Object.fromEntries(GROUP_KEYS.map((g) => [g, files[g].length]))
    : Object.fromEntries(GROUP_KEYS.map((g) => [g, listGroupFiles(epDir, g).length]));
  const pubs = doc?.publications ?? [];
  // stats.videos 주입 시 발행 유튜브/쇼츠 URL의 조회수를 합산 (Phase D+)
  let youtubeViews: number | undefined;
  if (videos) {
    for (const p of pubs) {
      if ((p.platform === 'youtube' || p.platform === 'shorts') && p.url) {
        const vid = extractVideoId(p.url);
        if (vid && videos[vid]) youtubeViews = (youtubeViews ?? 0) + videos[vid].views;
      }
    }
  }
  return {
    id,
    title: doc?.title || id,
    stage: doc?.stage || '',
    ...(error ? { error } : {}),
    groupCounts: groupCounts as Record<GroupKey, number>,
    // 대시보드용 요약 (Phase D) — 발행 기록·게이트 boolean·견적
    publications: pubs,
    approvals: Object.fromEntries(
      Object.entries(doc?.approvals ?? {}).map(([k, v]) => [k, v?.approved === true]),
    ),
    ...(doc?.total_estimate?.low !== undefined ? { estimateLow: doc.total_estimate.low } : {}),
    ...(youtubeViews !== undefined ? { youtubeViews } : {}),
  };
}

export function scanEpisodes(root: string, videos?: Record<string, VideoStat>): EpisodeSummary[] {
  const dir = episodesDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => {
      try {
        return statSync(join(dir, name)).isDirectory();
      } catch {
        // stat 실패 (파일 삭제·잠금) — watcher 레이스 가드
        return false;
      }
    })
    .sort((a, b) => b.localeCompare(a)) // ep<YYYYMMDD>_… → 최신 먼저
    .map((id) => summarize(root, id, undefined, videos));
}

export function scanEpisodeDetail(root: string, id: string): EpisodeDetail {
  const epDir = join(episodesDir(root), id);
  const files = Object.fromEntries(
    GROUP_KEYS.map((g) => [g, listGroupFiles(epDir, g)]),
  ) as Record<GroupKey, FileEntry[]>;
  const summary = summarize(root, id, files);
  const { doc } = loadDoc(epDir);
  return { ...summary, doc, files };
}
