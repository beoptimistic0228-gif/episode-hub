import {
  submitProposal, getProposal, listProposals, rejectProposals, setOnPropose, clearProposals,
  type ProposalSummary,
} from '../src/main/proposalStore';

describe('proposalStore — 저장·상태 전이', () => {
  beforeEach(() => { clearProposals(); setOnPropose(null); });

  const submit = (episodeId = 'ep20260101_a', relPath = 'script/콘티.md') =>
    submitProposal({ episodeId, relPath, newContent: '# 새 내용\n', reason: '톤 정리', baseMtimeMs: 123 });

  test('submitProposal — summary 반환(itemId 부여) + notifier 호출', () => {
    const seen: ProposalSummary[] = [];
    setOnPropose((s) => seen.push(s));
    const s = submit();
    expect(s.itemId).toBeTruthy();
    expect(s.status).toBe('pending');
    expect(s.isNew).toBe(false);
    expect(seen).toEqual([s]);
    expect(getProposal(s.itemId)?.newContent).toBe('# 새 내용\n');
  });

  test('baseMtimeMs=null(신규 파일)이면 isNew=true', () => {
    const s = submitProposal({ episodeId: 'ep20260101_a', relPath: 'osmu/new.md', newContent: 'x', reason: 'r', baseMtimeMs: null });
    expect(s.isNew).toBe(true);
  });

  test('listProposals — 해당 에피소드의 pending만', () => {
    const a = submit('ep20260101_a');
    submit('ep20260101_b');
    const rejected = submit('ep20260101_a', 'script/b.md');
    rejectProposals('ep20260101_a', [rejected.itemId]);
    expect(listProposals('ep20260101_a').map((s) => s.itemId)).toEqual([a.itemId]);
  });

  test('rejectProposals — pending→rejected, 남의 에피소드 id는 무시', () => {
    const a = submit('ep20260101_a');
    const done = rejectProposals('ep20260101_b', [a.itemId]); // 에피소드 불일치 — 처리 안 됨
    expect(done).toEqual([]);
    expect(getProposal(a.itemId)?.status).toBe('pending');
    rejectProposals('ep20260101_a', [a.itemId]);
    expect(getProposal(a.itemId)?.status).toBe('rejected');
  });
});
