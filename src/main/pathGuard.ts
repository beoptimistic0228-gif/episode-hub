import { join, normalize, sep } from 'node:path';

/** episodes/<id>/ 안으로 경로 고정 — 상위 탈출 차단 */
export function safeEpisodePath(root: string, id: string, relPath: string): string {
  const base = join(root, 'output', 'episodes', id);
  const full = normalize(join(base, relPath));
  if (!full.startsWith(base + sep) && full !== base) {
    throw new Error(`경로 이탈 차단: ${relPath}`);
  }
  return full;
}
