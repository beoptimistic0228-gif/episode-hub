import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  submitProposal, getProposal, applyProposals, getProposalDiff, clearProposals, setOnPropose,
} from '../src/main/proposalStore';

const EP = 'ep20260101_apply';

function makeRoot() {
  const base = mkdtempSync(join(tmpdir(), 'prop-apply-'));
  const epDir = join(base, 'output', 'episodes', EP, 'script');
  mkdirSync(epDir, { recursive: true });
  writeFileSync(join(epDir, '콘티.md'), '# 콘티\n\n원본\n');
  return base;
}
const contPath = (root: string) => join(root, 'output', 'episodes', EP, 'script', '콘티.md');

describe('applyProposals — 승인 후 저장', () => {
  let root: string;
  beforeEach(() => { clearProposals(); setOnPropose(null); root = makeRoot(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  const submitFor = (over: Partial<{ relPath: string; baseMtimeMs: number | null }> = {}) =>
    submitProposal({
      episodeId: EP, relPath: over.relPath ?? 'script/콘티.md',
      newContent: '# 콘티\n\n제안본\n', reason: 'r',
      baseMtimeMs: over.baseMtimeMs !== undefined ? over.baseMtimeMs : statSync(contPath(root)).mtimeMs,
    });

  test('정상 적용 — 파일 저장 + status=applied', async () => {
    const s = submitFor();
    const rs = await applyProposals(root, EP, [s.itemId]);
    expect(rs).toEqual([{ itemId: s.itemId, relPath: 'script/콘티.md', ok: true }]);
    expect(readFileSync(contPath(root), 'utf-8')).toBe('# 콘티\n\n제안본\n');
    expect(getProposal(s.itemId)?.status).toBe('applied');
  });

  test('mtime 충돌 — conflict 반환 + pending 유지, force=true면 적용', async () => {
    const s = submitFor({ baseMtimeMs: 1 }); // 디스크 mtime과 확실히 다름
    const rs = await applyProposals(root, EP, [s.itemId]);
    expect(rs).toEqual([{ itemId: s.itemId, relPath: 'script/콘티.md', conflict: true }]);
    expect(getProposal(s.itemId)?.status).toBe('pending');
    const forced = await applyProposals(root, EP, [s.itemId], true);
    expect(forced[0]).toEqual({ itemId: s.itemId, relPath: 'script/콘티.md', ok: true });
  });

  test('신규 파일 제안(baseMtimeMs=null)인데 그새 파일이 생겼으면 conflict', async () => {
    const s = submitFor({ relPath: 'script/new.md', baseMtimeMs: null });
    writeFileSync(join(root, 'output', 'episodes', EP, 'script', 'new.md'), '누가 먼저 만듦');
    const rs = await applyProposals(root, EP, [s.itemId]);
    expect(rs[0]).toEqual({ itemId: s.itemId, relPath: 'script/new.md', conflict: true });
  });

  test('신규 파일 제안 정상 적용 — 파일 생성', async () => {
    const s = submitFor({ relPath: 'script/new.md', baseMtimeMs: null });
    const rs = await applyProposals(root, EP, [s.itemId]);
    expect(rs[0]).toEqual({ itemId: s.itemId, relPath: 'script/new.md', ok: true });
    expect(existsSync(join(root, 'output', 'episodes', EP, 'script', 'new.md'))).toBe(true);
  });

  test('경로 탈출 제안은 적용 시 재검증에서 error + status=failed', async () => {
    // 제출 검증(mcpServer)을 우회해 store에 직접 심어도 적용 시 safeEpisodePath가 막는다(이중 검증).
    const s = submitProposal({ episodeId: EP, relPath: '../../탈출.md', newContent: 'x', reason: 'r', baseMtimeMs: null });
    const rs = await applyProposals(root, EP, [s.itemId]);
    expect(rs[0]).toHaveProperty('error');
    expect(getProposal(s.itemId)?.status).toBe('failed');
  });

  test('에피소드 불일치·비pending은 error 항목으로 보고', async () => {
    const s = submitFor();
    const rs = await applyProposals(root, 'ep20260101_other', [s.itemId, 'p없음']);
    expect(rs).toHaveLength(2);
    expect(rs[0]).toHaveProperty('error');
    expect(rs[1]).toHaveProperty('error');
    expect(getProposal(s.itemId)?.status).toBe('pending'); // 원본 무손상
  });

  test('getProposalDiff — 디스크 원문(old)과 제안(new) 반환, 신규 파일은 old=""', async () => {
    const s = submitFor();
    const d = getProposalDiff(root, s.itemId);
    expect(d).toEqual({ relPath: 'script/콘티.md', reason: 'r', oldText: '# 콘티\n\n원본\n', newText: '# 콘티\n\n제안본\n' });
    const n = submitFor({ relPath: 'script/new.md', baseMtimeMs: null });
    expect(getProposalDiff(root, n.itemId)?.oldText).toBe('');
    expect(getProposalDiff(root, 'p없음')).toBeNull();
  });
});
