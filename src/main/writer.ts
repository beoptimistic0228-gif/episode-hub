import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { safeEpisodePath } from './pathGuard';
import { normCategory, RENDER_ROWS, STAGES } from '@shared/episode';
import type { EpisodeDoc } from '@shared/types';

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

export type SaveRenderResult = { ok: true; relPath: string } | { exists: true };

/** 드롭된 SKU 렌더 이미지를 renders/<정규화 카테고리>__<row>.png 로 저장 */
export function saveRender(
  root: string,
  id: string,
  category: string,
  row: string,
  bytes: Uint8Array,
  overwrite?: boolean,
): SaveRenderResult {
  if (!RENDER_ROWS.includes(row as (typeof RENDER_ROWS)[number])) {
    throw new Error(`잘못된 row: ${row}`);
  }
  const relPath = `renders/${normCategory(category)}__${row}.png`;
  const full = safeEpisodePath(root, id, relPath);
  if (existsSync(full) && overwrite !== true) return { exists: true };
  mkdirSync(dirname(full), { recursive: true });
  atomicWrite(full, bytes);
  return { ok: true, relPath };
}

export interface EpisodePatch {
  approve?: { key: string };
  unapprove?: { key: string };
  stage?: string;
}

/** episode.json 부분 병합(read-modify-write). schema_version 가드. 파일 없으면 골격 생성. */
export function patchEpisode(
  root: string,
  id: string,
  patch: EpisodePatch,
): { ok: true; doc: EpisodeDoc } {
  const full = safeEpisodePath(root, id, 'episode.json');
  let doc: EpisodeDoc;
  if (existsSync(full)) {
    doc = JSON.parse(readFileSync(full, 'utf-8')) as EpisodeDoc;
    if (doc.schema_version !== 1) {
      throw new Error(`지원하지 않는 schema_version: ${doc.schema_version}`);
    }
    if (!doc.approvals) doc.approvals = {};
  } else {
    doc = { schema_version: 1, title: id, stage: '', approvals: {} };
  }

  if (patch.approve) {
    doc.approvals[patch.approve.key] = { approved: true, by: 'owner', at: new Date().toISOString() };
  }
  if (patch.unapprove) {
    delete doc.approvals[patch.unapprove.key];
  }
  if (patch.stage !== undefined) {
    if (!STAGES.includes(patch.stage as (typeof STAGES)[number])) {
      throw new Error(`잘못된 stage: ${patch.stage}`);
    }
    doc.stage = patch.stage;
  }

  atomicWrite(full, JSON.stringify(doc, null, 2));
  return { ok: true, doc };
}
