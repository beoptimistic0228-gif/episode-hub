import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { GROUP_KEYS, type GroupKey } from '@shared/groups';
import type { EpisodeDetail, EpisodeDoc, EpisodeSummary, FileEntry } from '@shared/types';

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

export function classifyKind(name: string): FileEntry['kind'] {
  if (/\.md$/i.test(name)) return 'md';
  if (IMAGE_EXT.test(name)) return 'image';
  if (/\.json$/i.test(name)) return 'json';
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
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) {
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

function summarize(root: string, id: string): EpisodeSummary {
  const epDir = join(episodesDir(root), id);
  const { doc, error } = loadDoc(epDir);
  const groupCounts = Object.fromEntries(
    GROUP_KEYS.map((g) => [g, listGroupFiles(epDir, g).length]),
  ) as Record<GroupKey, number>;
  return {
    id,
    title: doc?.title || id,
    stage: doc?.stage || '',
    ...(error ? { error } : {}),
    groupCounts,
  };
}

export function scanEpisodes(root: string): EpisodeSummary[] {
  const dir = episodesDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .sort((a, b) => b.localeCompare(a)) // ep<YYYYMMDD>_… → 최신 먼저
    .map((id) => summarize(root, id));
}

export function scanEpisodeDetail(root: string, id: string): EpisodeDetail {
  const epDir = join(episodesDir(root), id);
  const summary = summarize(root, id);
  const { doc } = loadDoc(epDir);
  const files = Object.fromEntries(
    GROUP_KEYS.map((g) => [g, listGroupFiles(epDir, g)]),
  ) as Record<GroupKey, FileEntry[]>;
  return { ...summary, doc, files };
}
