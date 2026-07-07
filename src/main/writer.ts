import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { safeEpisodePath } from './pathGuard';

export type WriteTextResult =
  | { ok: true; mtimeMs: number }
  | { conflict: true; currentMtimeMs: number };

/** temp→rename 원자적 저장 */
function atomicWrite(full: string, data: string | Uint8Array): void {
  const tmp = `${full}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, full);
}

/** .md 텍스트 저장. expectedMtimeMs가 주어지고 디스크가 더 최신이면 저장하지 않고 conflict 반환. */
export function writeText(
  root: string,
  id: string,
  relPath: string,
  content: string,
  expectedMtimeMs?: number,
): WriteTextResult {
  if (!/\.md$/i.test(relPath)) {
    throw new Error(`md 파일만 저장 가능: ${relPath}`);
  }
  const full = safeEpisodePath(root, id, relPath);
  if (expectedMtimeMs !== undefined && existsSync(full)) {
    const cur = statSync(full).mtimeMs;
    if (cur !== expectedMtimeMs) return { conflict: true, currentMtimeMs: cur };
  }
  atomicWrite(full, content);
  return { ok: true, mtimeMs: statSync(full).mtimeMs };
}
