/** E3 제안 저장소 — Claude가 propose_edit로 제출한 수정안을 파일에 쓰지 않고 보관한다.
 *  실제 저장(applyProposals)은 부부 승인 후에만. 앱 메모리 전용(비영구 — spec §3). */

import { existsSync, readFileSync } from 'node:fs';
import { safeEpisodePath } from './pathGuard';
import { writeText } from './writer';
import { restoreIfNoTextDiff } from './git';

export type ProposalStatus = 'pending' | 'applied' | 'rejected' | 'failed';

export interface ProposalItem {
  itemId: string;
  episodeId: string;
  relPath: string;
  newContent: string;
  reason: string;
  /** 제안 시점 대상 파일 mtime — 신규 파일 제안이면 null. 적용 시 충돌 감지 기준. */
  baseMtimeMs: number | null;
  status: ProposalStatus;
}

export interface ProposalSummary {
  itemId: string;
  episodeId: string;
  relPath: string;
  reason: string;
  status: ProposalStatus;
  isNew: boolean;
}

let seq = 0;
const items = new Map<string, ProposalItem>();
let onPropose: ((s: ProposalSummary) => void) | null = null;

const toSummary = (it: ProposalItem): ProposalSummary => ({
  itemId: it.itemId, episodeId: it.episodeId, relPath: it.relPath,
  reason: it.reason, status: it.status, isNew: it.baseMtimeMs === null,
});

export function setOnPropose(cb: ((s: ProposalSummary) => void) | null): void { onPropose = cb; }

export function submitProposal(input: {
  episodeId: string; relPath: string; newContent: string; reason: string; baseMtimeMs: number | null;
}): ProposalSummary {
  const item: ProposalItem = { itemId: `p${++seq}`, status: 'pending', ...input };
  items.set(item.itemId, item);
  const s = toSummary(item);
  onPropose?.(s);
  return s;
}

export function getProposal(itemId: string): ProposalItem | null { return items.get(itemId) ?? null; }

export function listProposals(episodeId: string): ProposalSummary[] {
  return [...items.values()].filter((it) => it.episodeId === episodeId && it.status === 'pending').map(toSummary);
}

export function rejectProposals(episodeId: string, itemIds: string[]): ProposalSummary[] {
  const done: ProposalSummary[] = [];
  for (const id of itemIds) {
    const it = items.get(id);
    if (!it || it.episodeId !== episodeId || it.status !== 'pending') continue;
    it.status = 'rejected';
    done.push(toSummary(it));
  }
  return done;
}

/** 테스트 전용 — 전부 비움 */
export function clearProposals(): void { items.clear(); seq = 0; }

export type ApplyResult =
  | { itemId: string; relPath: string; ok: true }
  | { itemId: string; relPath: string; conflict: true }
  | { itemId: string; relPath: string; error: string };

/** 승인분만 저장. 경로는 적용 시 safeEpisodePath로 재검증(제출 시와 이중 — spec §5-6).
 *  충돌: 제안 이후 원본이 바뀌었으면(mtime) 저장하지 않고 conflict — UI가 "그래도 적용"(force) 제공. */
export async function applyProposals(
  root: string, episodeId: string, itemIds: string[], force = false,
): Promise<ApplyResult[]> {
  const out: ApplyResult[] = [];
  for (const itemId of itemIds) {
    const it = items.get(itemId);
    if (!it || it.episodeId !== episodeId || it.status !== 'pending') {
      out.push({ itemId, relPath: it?.relPath ?? '?', error: '적용할 수 없는 제안이에요' });
      continue;
    }
    try {
      const full = safeEpisodePath(root, it.episodeId, it.relPath); // 이중 검증
      if (!force && it.baseMtimeMs === null && existsSync(full)) {
        out.push({ itemId, relPath: it.relPath, conflict: true }); // 신규 제안인데 그새 파일이 생김
        continue;
      }
      const res = writeText(root, it.episodeId, it.relPath, it.newContent, force ? undefined : it.baseMtimeMs ?? undefined);
      if ('conflict' in res) { out.push({ itemId, relPath: it.relPath, conflict: true }); continue; }
      await restoreIfNoTextDiff(root, it.episodeId, it.relPath); // 유령 dirty(EOL) 정리 — mcpServer write_file 미러
      it.status = 'applied';
      out.push({ itemId, relPath: it.relPath, ok: true });
    } catch (e) {
      it.status = 'failed';
      out.push({ itemId, relPath: it.relPath, error: String((e as Error)?.message ?? e) });
    }
  }
  return out;
}

/** 비교 화면용 — 디스크 원문과 제안 전문. 목록 이벤트에는 요약만 싣고 전문은 이 경로로만(폭주 방지). */
export function getProposalDiff(root: string, itemId: string):
  { relPath: string; reason: string; oldText: string; newText: string } | null {
  const it = items.get(itemId);
  if (!it) return null;
  let oldText = '';
  try {
    const full = safeEpisodePath(root, it.episodeId, it.relPath);
    if (existsSync(full)) oldText = readFileSync(full, 'utf-8');
  } catch { /* 탈출 경로 등 — old는 빈 문자열로 */ }
  return { relPath: it.relPath, reason: it.reason, oldText, newText: it.newContent };
}
