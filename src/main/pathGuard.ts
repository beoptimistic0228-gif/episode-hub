import { join, normalize, sep } from 'node:path';

/** 에피소드 id 규약(`ep<YYYYMMDD>_<slug>`)을 포함하는 화이트리스트 — 불일치 시 throw */
export function assertEpisodeId(id: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(`잘못된 에피소드 id: ${id}`);
  }
}

/** episodes/<id>/ 안으로 경로 고정 — 상위 탈출 차단 */
export function safeEpisodePath(root: string, id: string, relPath: string): string {
  assertEpisodeId(id);
  const base = join(root, 'output', 'episodes', id);
  const full = normalize(join(base, relPath));
  if (!full.startsWith(base + sep) && full !== base) {
    throw new Error(`경로 이탈 차단: ${relPath}`);
  }
  return full;
}

/** <imageRoot>/<id>/<relPath> 안으로 고정 — 이미지 전용(레포와 달리 output/episodes 세그먼트 없음) */
export function resolveImagePath(imageRoot: string, id: string, relPath: string): string {
  assertEpisodeId(id);
  const base = join(imageRoot, id);
  const full = normalize(join(base, relPath));
  if (!full.startsWith(base + sep) && full !== base) {
    throw new Error(`이미지 경로 이탈 차단: ${relPath}`);
  }
  return full;
}
